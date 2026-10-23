variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "aws_profile" {
  type    = string
  default = "sales-ai"
}

variable "cluster_name" {
  type    = string
  default = "sales-ai-eks"
}

variable "kubernetes_version" {
  type    = string
  default = "1.36"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "admin_cidr" {
  description = "Your current public IPv4 address followed by /32."
  type        = string
  validation {
    condition     = can(cidrnetmask(var.admin_cidr)) && endswith(var.admin_cidr, "/32")
    error_message = "Use one public IPv4 address with /32; the EKS API is not open to all internet addresses."
  }
}

variable "worker_instance_type" {
  type    = string
  default = "m7i-flex.large"
}

variable "admin_principal_arn" {
  description = "Optional IAM user/role ARN for cluster administration. Defaults to this profile's caller ARN."
  type        = string
  default     = null
}
