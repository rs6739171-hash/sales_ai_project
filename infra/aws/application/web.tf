locals {
  web = var.deploy_web ? {
    backend = {
      name        = "sales-ai-backend", image = var.backend_image, port = 8000
      request_cpu = "250m", request_memory = "512Mi", limit_cpu = "1000m", limit_memory = "2Gi"
      probe_path  = "/openapi.json", max_replicas = 6, target_cpu = 60
    }
    frontend = {
      name        = "sales-ai-frontend", image = var.frontend_image, port = 80
      request_cpu = "100m", request_memory = "128Mi", limit_cpu = "500m", limit_memory = "256Mi"
      probe_path  = "/", max_replicas = 4, target_cpu = 70
    }
  } : {}
  backend_env = {
    OLLAMA_BASE_URL         = "http://ollama:11434"
    OLLAMA_MODEL            = "qwen3:4b"
    OLLAMA_NUM_CTX          = "4096"
    OLLAMA_NUM_PREDICT      = "2048"
    OLLAMA_TIMEOUT_SECONDS  = "240"
    OLLAMA_MAX_RETRIES      = "0"
    PYTHONUNBUFFERED        = "1"
    PYTHONDONTWRITEBYTECODE = "1"
  }
}

resource "kubernetes_service_v1" "web" {
  for_each = local.web
  metadata {
    name      = each.value.name
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
  }
  spec {
    type     = "ClusterIP"
    selector = { "app.kubernetes.io/name" = each.value.name }
    port {
      name        = "http"
      port        = each.value.port
      target_port = "http"
    }
  }
}

resource "kubernetes_deployment_v1" "web" {
  for_each = local.web
  metadata {
    name      = each.value.name
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
    annotations = {
      "sales-ai/source-commit" = "f363ace672a60b4d77a66f43971aa49f010b08f1"
    }
  }
  spec {
    replicas                  = 2
    revision_history_limit    = 3
    min_ready_seconds         = 10
    progress_deadline_seconds = 1200
    strategy {
      type = "RollingUpdate"
      rolling_update {
        max_surge       = "1"
        max_unavailable = "0"
      }
    }
    selector { match_labels = { "app.kubernetes.io/name" = each.value.name } }
    template {
      metadata {
        labels = merge(local.common_labels, { "app.kubernetes.io/name" = each.value.name })
      }
      spec {
        service_account_name             = kubernetes_service_account_v1.runtime.metadata[0].name
        automount_service_account_token  = false
        termination_grace_period_seconds = 300
        node_selector = {
          "salesiq.io/node-pool" = "applications"
          "kubernetes.io/arch"   = "amd64"
        }
        image_pull_secrets { name = "ghcr-pull" }
        security_context {
          seccomp_profile { type = "RuntimeDefault" }
        }
        topology_spread_constraint {
          max_skew           = 1
          topology_key       = "kubernetes.io/hostname"
          when_unsatisfiable = "DoNotSchedule"
          label_selector { match_labels = { "app.kubernetes.io/name" = each.value.name } }
        }
        topology_spread_constraint {
          max_skew           = 1
          topology_key       = "topology.kubernetes.io/zone"
          when_unsatisfiable = "ScheduleAnyway"
          label_selector { match_labels = { "app.kubernetes.io/name" = each.value.name } }
        }
        container {
          name              = each.key
          image             = each.value.image
          image_pull_policy = "IfNotPresent"
          port {
            name           = "http"
            container_port = each.value.port
          }
          dynamic "env_from" {
            for_each = each.key == "backend" ? [1] : []
            content {
              secret_ref { name = "sales-ai-backend-env" }
            }
          }
          # Explicit env overrides any old laptop Ollama URL in imported data.
          dynamic "env" {
            for_each = each.key == "backend" ? local.backend_env : {}
            content {
              name  = env.key
              value = env.value
            }
          }
          resources {
            requests = { cpu = each.value.request_cpu, memory = each.value.request_memory }
            limits   = { cpu = each.value.limit_cpu, memory = each.value.limit_memory }
          }
          security_context {
            allow_privilege_escalation = false
            capabilities {
              drop = ["ALL"]
              # Standard Nginx prepares its cache, binds port 80, and changes
              # worker identities. These exceptions apply only to frontend.
              add = each.key == "frontend" ? ["CHOWN", "SETGID", "SETUID", "NET_BIND_SERVICE"] : []
            }
          }
          startup_probe {
            http_get {
              path = each.value.probe_path
              port = "http"
            }
            period_seconds    = 5
            timeout_seconds   = 3
            failure_threshold = 120
          }
          readiness_probe {
            http_get {
              path = each.value.probe_path
              port = "http"
            }
            period_seconds  = 10
            timeout_seconds = 3
          }
          liveness_probe {
            http_get {
              path = each.value.probe_path
              port = "http"
            }
            period_seconds    = 30
            timeout_seconds   = 5
            failure_threshold = 5
          }
        }
      }
    }
  }
  lifecycle {
    # HPA owns replica counts once the first two replicas have been created.
    ignore_changes = [spec[0].replicas]
  }
  # Nginx resolves the backend Service when it starts.
  depends_on = [kubernetes_service_v1.web]
  timeouts {
    create = "25m"
    update = "25m"
  }
}

resource "kubernetes_pod_disruption_budget_v1" "web" {
  for_each = local.web
  metadata {
    name      = each.value.name
    namespace = kubernetes_namespace_v1.application.metadata[0].name
  }
  spec {
    min_available = "1"
    selector { match_labels = { "app.kubernetes.io/name" = each.value.name } }
  }
}

resource "kubernetes_horizontal_pod_autoscaler_v2" "web" {
  for_each = local.web
  metadata {
    name      = each.value.name
    namespace = kubernetes_namespace_v1.application.metadata[0].name
  }
  spec {
    min_replicas = 2
    max_replicas = each.value.max_replicas
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.web[each.key].metadata[0].name
    }
    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = each.value.target_cpu
        }
      }
    }
    behavior {
      scale_up {
        stabilization_window_seconds = 30
        select_policy                = "Max"
        policy {
          type           = "Pods"
          value          = 2
          period_seconds = 60
        }
      }
      scale_down {
        stabilization_window_seconds = 300
        select_policy                = "Min"
        policy {
          type           = "Pods"
          value          = 1
          period_seconds = 60
        }
      }
    }
  }
}
