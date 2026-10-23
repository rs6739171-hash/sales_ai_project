terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "aws_region" {
  description = "AWS region for the deployment."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "Local AWS shared-credentials profile used by Terraform."
  type        = string
  default     = "sales-ai"
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}

data "aws_servicequotas_service_quota" "standard_vcpus" {
  service_code = "ec2"
  quota_code   = "L-1216C47A"
}

output "aws_readiness" {
  description = "Read-only account, region and quota checks. The quota is a limit, not unused capacity."
  value = {
    account_id                   = data.aws_caller_identity.current.account_id
    caller_arn                   = data.aws_caller_identity.current.arn
    region                       = var.aws_region
    available_zones              = data.aws_availability_zones.available.names
    standard_on_demand_vcpus     = data.aws_servicequotas_service_quota.standard_vcpus.value
    initial_worker_vcpus_needed  = 4
    maximum_worker_count         = 4
    maximum_worker_vcpus_needed  = 8
    quota_covers_maximum_workers = data.aws_servicequotas_service_quota.standard_vcpus.value >= 8
  }

  precondition {
    condition     = length(data.aws_availability_zones.available.names) >= 2
    error_message = "This deployment needs at least two available Availability Zones."
  }

  precondition {
    condition     = data.aws_servicequotas_service_quota.standard_vcpus.value >= 4
    error_message = "The initial two workers need a Standard On-Demand EC2 quota of at least four vCPUs."
  }
}
