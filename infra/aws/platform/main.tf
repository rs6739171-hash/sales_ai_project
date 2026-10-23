variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "aws_profile" {
  type    = string
  default = "sales-ai"
}

variable "state_bucket" {
  type = string
}

variable "python_executable" {
  type = string
}

variable "auth_script" {
  type = string
}

data "terraform_remote_state" "foundation" {
  backend = "s3"
  config = {
    bucket  = var.state_bucket
    key     = "foundation/terraform.tfstate"
    region  = var.aws_region
    profile = var.aws_profile
  }
}

locals {
  platform   = data.terraform_remote_state.foundation.outputs.platform_context
  connection = data.terraform_remote_state.foundation.outputs.eks_connection
  auth_args = [
    var.auth_script,
    "--cluster", local.platform.cluster_name,
    "--region", var.aws_region,
    "--profile", var.aws_profile,
  ]
  service_accounts = {
    load_balancer = "aws-load-balancer-controller"
    autoscaler    = "cluster-autoscaler"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags {
    tags = {
      Project   = "sales-ai"
      ManagedBy = "Terraform"
    }
  }
}

data "aws_eks_cluster" "current" {
  name = local.platform.cluster_name
}

provider "helm" {
  kubernetes = {
    host                   = local.connection.endpoint
    cluster_ca_certificate = base64decode(local.connection.ca_data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = var.python_executable
      args        = local.auth_args
    }
  }
}

provider "kubernetes" {
  host                   = local.connection.endpoint
  cluster_ca_certificate = base64decode(local.connection.ca_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = var.python_executable
    args        = local.auth_args
  }
}

output "platform_summary" {
  value = {
    load_balancer_controller = helm_release.load_balancer.name
    cluster_autoscaler       = helm_release.autoscaler.name
    metrics_server           = aws_eks_addon.metrics_server.addon_name
    storage_class            = kubernetes_storage_class_v1.gp3.metadata[0].name
    node_range               = "2 to 4 workers, subject to capacity and quota"
    next_step                = "Deploy application workloads and their HPA resources."
  }
}
