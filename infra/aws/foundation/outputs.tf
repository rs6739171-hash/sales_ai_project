output "cluster_summary" {
  value = {
    name               = aws_eks_cluster.this.name
    kubernetes_version = aws_eks_cluster.this.version
    region             = var.aws_region
    availability_zones = keys(local.zones)
    worker_instance    = var.worker_instance_type
    initial_workers    = 2
    maximum_workers    = 4
    node_groups        = { for zone, group in aws_eks_node_group.workers : zone => group.node_group_name }
    api_allowed_cidr   = var.admin_cidr
    automatic_scaling  = "Node limits prepared; install Cluster Autoscaler and HPA in the platform step."
  }
}

output "platform_context" {
  value = {
    cluster_name              = aws_eks_cluster.this.name
    region                    = var.aws_region
    vpc_id                    = aws_vpc.this.id
    public_subnet_ids         = [for subnet in aws_subnet.public : subnet.id]
    private_subnet_ids        = [for subnet in aws_subnet.private : subnet.id]
    cluster_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
    oidc_provider_arn         = aws_iam_openid_connect_provider.cluster.arn
    oidc_host                 = local.oidc_host
  }
}

output "eks_connection" {
  sensitive = true
  value = {
    cluster_name = aws_eks_cluster.this.name
    region       = var.aws_region
    endpoint     = aws_eks_cluster.this.endpoint
    ca_data      = aws_eks_cluster.this.certificate_authority[0].data
  }
}
