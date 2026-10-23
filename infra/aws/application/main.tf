variable "state_bucket" { type = string }
variable "aws_region" { type = string }
variable "aws_profile" { type = string }
variable "python_executable" { type = string }
variable "auth_script" { type = string }

variable "deploy_web" {
  description = "Enable after the runtime Secrets have been configured. Leave enabled for later releases."
  type        = bool
  default     = false
}

variable "backend_image" {
  type = string
  validation {
    condition     = can(regex("^ghcr\\.io/rs6739171-hash/sales-ai-backend@sha256:[0-9a-f]{64}$", var.backend_image))
    error_message = "Use the backend digest reference archived by Jenkins."
  }
}

variable "frontend_image" {
  type = string
  validation {
    condition     = can(regex("^ghcr\\.io/rs6739171-hash/sales-ai-frontend@sha256:[0-9a-f]{64}$", var.frontend_image))
    error_message = "Use the frontend digest reference archived by Jenkins."
  }
}

variable "ollama_image" {
  type = string
  validation {
    condition     = can(regex("^docker\\.io/ollama/ollama@sha256:[0-9a-f]{64}$", var.ollama_image))
    error_message = "Pin the official Ollama linux/amd64 image by digest."
  }
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
  connection = data.terraform_remote_state.foundation.outputs.eks_connection
  platform   = data.terraform_remote_state.foundation.outputs.platform_context
  common_labels = {
    "app.kubernetes.io/part-of"    = "sales-ai"
    "app.kubernetes.io/managed-by" = "Terraform"
  }
  ollama_env = {
    HOME                     = "/data"
    OLLAMA_HOST              = "0.0.0.0:11434"
    OLLAMA_MODELS            = "/data/models"
    OLLAMA_MODEL             = "qwen3:4b"
    OLLAMA_CONTEXT_LENGTH    = "4096"
    OLLAMA_NUM_PARALLEL      = "1"
    OLLAMA_MAX_LOADED_MODELS = "1"
    OLLAMA_MAX_QUEUE         = "8"
    OLLAMA_KEEP_ALIVE        = "10m"
    OLLAMA_VULKAN            = "0"
    OLLAMA_NO_CLOUD          = "1"
  }
}

provider "kubernetes" {
  host                   = local.connection.endpoint
  cluster_ca_certificate = base64decode(local.connection.ca_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = var.python_executable
    args = [var.auth_script, "--cluster", local.platform.cluster_name,
    "--region", var.aws_region, "--profile", var.aws_profile]
  }
}

resource "kubernetes_namespace_v1" "application" {
  metadata {
    name   = "sales-ai"
    labels = local.common_labels
  }
}

resource "kubernetes_service_account_v1" "runtime" {
  metadata {
    name      = "sales-ai-runtime"
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
  }
  automount_service_account_token = false
}

output "application_summary" {
  value = {
    namespace      = kubernetes_namespace_v1.application.metadata[0].name
    ollama_url     = "http://ollama:11434"
    model          = "qwen3:4b"
    web_enabled    = var.deploy_web
    backend_image  = var.backend_image
    frontend_image = var.frontend_image
    next_step      = var.deploy_web ? "Verify the private application before configuring ALB access." : "Configure runtime Secrets, then enable the web workloads."
  }
}
