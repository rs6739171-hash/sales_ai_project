# Terraform declares this Ingress. The AWS Load Balancer Controller owns and
# reconciles its ALB, target group, listener, and security group resources.
variable "enable_public_ingress" {
  description = "Create an internet-facing ALB for the existing application."
  type        = bool
  default     = false
}

variable "public_app_allowed_cidrs" {
  description = "IPv4 networks allowed to reach the application ALB. Separate from the EKS API allowlist."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for cidr in var.public_app_allowed_cidrs : can(cidrnetmask(cidr))])
    error_message = "Provide valid IPv4 CIDRs, for example your public IPv4 followed by /32."
  }
}

resource "kubernetes_ingress_v1" "public" {
  count                  = var.enable_public_ingress ? 1 : 0
  wait_for_load_balancer = true

  metadata {
    name      = "sales-ai-public"
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
    annotations = {
      "alb.ingress.kubernetes.io/load-balancer-name" = "sales-ai-public"
      "alb.ingress.kubernetes.io/scheme"             = "internet-facing"
      "alb.ingress.kubernetes.io/ip-address-type"    = "ipv4"
      # The foundation already routes these public subnets through its IGW.
      "alb.ingress.kubernetes.io/subnets" = join(",", local.platform.public_subnet_ids)
      # Register private Pod IPs through the existing VPC CNI and ClusterIP Service.
      "alb.ingress.kubernetes.io/target-type"      = "ip"
      "alb.ingress.kubernetes.io/backend-protocol" = "HTTP"
      "alb.ingress.kubernetes.io/listen-ports"     = jsonencode([{ HTTP = 80 }])
      "alb.ingress.kubernetes.io/inbound-cidrs"    = join(",", var.public_app_allowed_cidrs)
      # All paths reach Nginx. Nginx preserves the existing /api/ proxy behavior.
      "alb.ingress.kubernetes.io/healthcheck-path"             = "/"
      "alb.ingress.kubernetes.io/healthcheck-port"             = "traffic-port"
      "alb.ingress.kubernetes.io/healthcheck-protocol"         = "HTTP"
      "alb.ingress.kubernetes.io/success-codes"                = "200"
      "alb.ingress.kubernetes.io/healthcheck-interval-seconds" = "15"
      "alb.ingress.kubernetes.io/healthcheck-timeout-seconds"  = "5"
      "alb.ingress.kubernetes.io/healthy-threshold-count"      = "2"
      "alb.ingress.kubernetes.io/unhealthy-threshold-count"    = "3"
      # Match Nginx's long API timeout; drain in-flight requests during rollouts.
      "alb.ingress.kubernetes.io/load-balancer-attributes" = join(",", [
        "idle_timeout.timeout_seconds=300",
        "routing.http.drop_invalid_header_fields.enabled=true",
      ])
      "alb.ingress.kubernetes.io/target-group-attributes" = join(",", [
        "deregistration_delay.timeout_seconds=300",
        "load_balancing.algorithm.type=least_outstanding_requests",
      ])
      "alb.ingress.kubernetes.io/tags" = "Project=sales-ai,Environment=learning,ManagedBy=aws-load-balancer-controller"
    }
  }

  spec {
    ingress_class_name = "alb"
    rule {
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = "sales-ai-frontend"
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.deploy_web
      error_message = "Enable the existing web workloads before creating their public Ingress."
    }
    precondition {
      condition     = length(var.public_app_allowed_cidrs) > 0
      error_message = "Set public_app_allowed_cidrs explicitly before enabling the ALB."
    }
    precondition {
      condition     = length(local.platform.public_subnet_ids) >= 2
      error_message = "This ALB requires public subnets in at least two Availability Zones."
    }
  }

  depends_on = [kubernetes_deployment_v1.web]
  timeouts {
    create = "20m"
    delete = "20m"
  }
}

output "public_application_url" {
  description = "Initial HTTP test endpoint. Add a domain and HTTPS before wider access."
  value       = try("http://${kubernetes_ingress_v1.public[0].status[0].load_balancer[0].ingress[0].hostname}", null)
}
