resource "aws_cloudwatch_log_group" "cluster" {
  name              = format("/aws/eks/%s/cluster", var.cluster_name)
  retention_in_days = 14
}

resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  version  = var.kubernetes_version
  role_arn = aws_iam_role.cluster.arn
  enabled_cluster_log_types = [
    "api", "audit", "authenticator", "controllerManager", "scheduler",
  ]

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }

  upgrade_policy {
    support_type = "STANDARD"
  }

  vpc_config {
    subnet_ids              = [for subnet in aws_subnet.private : subnet.id]
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = [var.admin_cidr]
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster,
    aws_cloudwatch_log_group.cluster,
  ]

  lifecycle {
    precondition {
      condition = alltrue([
        for zone in keys(local.zones) : contains(data.aws_ec2_instance_type_offerings.workers.locations, zone)
      ])
      error_message = "The selected instance type is not offered in both selected Availability Zones."
    }
  }
}

resource "aws_eks_access_entry" "administrator" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = local.admin_principal
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "administrator" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_eks_access_entry.administrator.principal_arn
  policy_arn    = format("arn:%s:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy", data.aws_partition.current.partition)
  access_scope {
    type = "cluster"
  }
}

resource "aws_launch_template" "workers" {
  name_prefix            = format("%s-workers-", var.cluster_name)
  update_default_version = true
  vpc_security_group_ids = [aws_eks_cluster.this.vpc_config[0].cluster_security_group_id]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 30
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = format("%s-worker", var.cluster_name)
      Project = "sales-ai"
    }
  }
}

resource "aws_eks_node_group" "workers" {
  for_each        = local.zones
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = format("applications-%s", each.key)
  node_role_arn   = aws_iam_role.workers.arn
  subnet_ids      = [aws_subnet.private[each.key].id]
  version         = var.kubernetes_version
  ami_type        = "AL2023_x86_64_STANDARD"
  capacity_type   = "ON_DEMAND"
  instance_types  = [var.worker_instance_type]

  scaling_config {
    desired_size = 1
    min_size     = 1
    max_size     = 2
  }

  update_config {
    max_unavailable = 1
  }

  node_repair_config {
    enabled = true
  }

  launch_template {
    id      = aws_launch_template.workers.id
    version = aws_launch_template.workers.latest_version
  }

  labels = {
    "salesiq.io/node-pool" = "applications"
  }

  depends_on = [
    aws_iam_role_policy_attachment.workers,
    aws_route.private_internet,
    aws_route.public_internet,
    aws_eks_addon.vpc_cni,
  ]

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

resource "aws_autoscaling_group_tag" "autoscaler_enabled" {
  for_each               = aws_eks_node_group.workers
  autoscaling_group_name = each.value.resources[0].autoscaling_groups[0].name
  tag {
    key                 = "k8s.io/cluster-autoscaler/enabled"
    value               = "true"
    propagate_at_launch = false
  }
}

resource "aws_autoscaling_group_tag" "autoscaler_cluster" {
  for_each               = aws_eks_node_group.workers
  autoscaling_group_name = each.value.resources[0].autoscaling_groups[0].name
  tag {
    key                 = format("k8s.io/cluster-autoscaler/%s", var.cluster_name)
    value               = "owned"
    propagate_at_launch = false
  }
}
