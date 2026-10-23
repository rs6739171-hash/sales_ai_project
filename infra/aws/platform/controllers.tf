resource "helm_release" "load_balancer" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "3.6.1"
  timeout    = 600
  wait       = true

  values = [yamlencode({
    clusterName  = local.platform.cluster_name
    region       = var.aws_region
    vpcId        = local.platform.vpc_id
    replicaCount = 2
    serviceAccount = {
      create = true
      name   = local.service_accounts.load_balancer
      annotations = {
        "eks.amazonaws.com/role-arn"               = aws_iam_role.controllers["load_balancer"].arn
        "eks.amazonaws.com/sts-regional-endpoints" = "true"
      }
    }
    controllerConfig = {
      featureGates = {
        ALBGatewayAPI      = false
        NLBGatewayAPI      = false
        GatewayListenerSet = false
      }
    }
    enableServiceMutatorWebhook = false
    resources = {
      requests = { cpu = "100m", memory = "128Mi" }
      limits   = { cpu = "500m", memory = "512Mi" }
    }
    podDisruptionBudget = { maxUnavailable = 1 }
  })]
  depends_on = [aws_iam_role_policy_attachment.load_balancer]
}

resource "helm_release" "autoscaler" {
  name       = "cluster-autoscaler"
  namespace  = "kube-system"
  repository = "https://kubernetes.github.io/autoscaler"
  chart      = "cluster-autoscaler"
  version    = "9.59.0"
  timeout    = 600
  wait       = true

  values = [yamlencode({
    fullnameOverride = "cluster-autoscaler"
    cloudProvider    = "aws"
    awsRegion        = var.aws_region
    replicaCount     = 1
    autoDiscovery = {
      clusterName = local.platform.cluster_name
    }
    image = {
      repository = "registry.k8s.io/autoscaling/cluster-autoscaler"
      tag        = "v1.36.0"
    }
    rbac = {
      create = true
      serviceAccount = {
        create = true
        name   = local.service_accounts.autoscaler
        annotations = {
          "eks.amazonaws.com/role-arn" = aws_iam_role.controllers["autoscaler"].arn
          # This chart emits annotation values directly; preserve YAML string quotes.
          "eks.amazonaws.com/sts-regional-endpoints" = jsonencode("true")
        }
      }
    }
    extraArgs = {
      "balance-similar-node-groups" = "true"
      "expander"                    = "least-waste"
      "scan-interval"               = "20s"
      "scale-down-delay-after-add"  = "10m"
      "scale-down-unneeded-time"    = "10m"
      "skip-nodes-with-system-pods" = "false"
    }
    resources = {
      requests = { cpu = "100m", memory = "256Mi" }
      limits   = { cpu = "500m", memory = "512Mi" }
    }
  })]
  depends_on = [aws_iam_role_policy.autoscaler]

  lifecycle {
    precondition {
      condition     = data.aws_eks_cluster.current.version == "1.36"
      error_message = "This package pins Cluster Autoscaler v1.36.0. Match the autoscaler image to the EKS minor version before proceeding."
    }
  }
}

data "aws_eks_addon_version" "metrics_server" {
  addon_name         = "metrics-server"
  kubernetes_version = data.aws_eks_cluster.current.version
  most_recent        = false
}

resource "aws_eks_addon" "metrics_server" {
  cluster_name                = local.platform.cluster_name
  addon_name                  = "metrics-server"
  addon_version               = data.aws_eks_addon_version.metrics_server.version
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"
}

resource "kubernetes_storage_class_v1" "gp3" {
  metadata {
    name = "gp3"
  }
  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Delete"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true
  parameters = {
    type                        = "gp3"
    encrypted                   = "true"
    "csi.storage.k8s.io/fstype" = "ext4"
  }
}
