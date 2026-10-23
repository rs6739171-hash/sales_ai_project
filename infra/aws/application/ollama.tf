resource "kubernetes_persistent_volume_claim_v1" "ollama" {
  metadata {
    name      = "ollama-models"
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
  }
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "gp3"
    resources {
      requests = { storage = "20Gi" }
    }
  }
  # gp3 uses WaitForFirstConsumer: the Pod must exist before EBS can bind.
  wait_until_bound = false
}

resource "kubernetes_service_v1" "ollama" {
  metadata {
    name      = "ollama"
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
  }
  spec {
    type     = "ClusterIP"
    selector = { "app.kubernetes.io/name" = "ollama" }
    port {
      name        = "http"
      port        = 11434
      target_port = "http"
    }
  }
}

resource "kubernetes_deployment_v1" "ollama" {
  metadata {
    name      = "ollama"
    namespace = kubernetes_namespace_v1.application.metadata[0].name
    labels    = local.common_labels
  }
  spec {
    replicas                  = 1
    revision_history_limit    = 3
    progress_deadline_seconds = 1800
    # One model cache volume: never run old and new replicas simultaneously.
    strategy { type = "Recreate" }
    selector { match_labels = { "app.kubernetes.io/name" = "ollama" } }
    template {
      metadata {
        labels = merge(local.common_labels, { "app.kubernetes.io/name" = "ollama" })
      }
      spec {
        service_account_name             = kubernetes_service_account_v1.runtime.metadata[0].name
        automount_service_account_token  = false
        termination_grace_period_seconds = 60
        node_selector = {
          "salesiq.io/node-pool" = "applications"
          "kubernetes.io/arch"   = "amd64"
        }
        security_context {
          run_as_non_root        = true
          run_as_user            = 1000
          run_as_group           = 1000
          fs_group               = 1000
          fs_group_change_policy = "OnRootMismatch"
          seccomp_profile { type = "RuntimeDefault" }
        }
        volume {
          name = "models"
          persistent_volume_claim { claim_name = kubernetes_persistent_volume_claim_v1.ollama.metadata[0].name }
        }
        volume {
          name = "tmp"
          empty_dir { size_limit = "512Mi" }
        }
        init_container {
          name              = "download-model"
          image             = var.ollama_image
          image_pull_policy = "IfNotPresent"
          command           = ["/bin/sh", "-ec"]
          args = [<<-SCRIPT
            export OLLAMA_HOST=127.0.0.1:11434
            ollama serve >/tmp/ollama-init.log 2>&1 &
            server_pid=$!
            trap 'kill "$server_pid" 2>/dev/null || true' EXIT
            ready=0
            for attempt in $(seq 1 60); do
              if ollama list >/dev/null 2>&1; then ready=1; break; fi
              sleep 2
            done
            if [ "$ready" != 1 ]; then cat /tmp/ollama-init.log; exit 1; fi
            if ollama show "$OLLAMA_MODEL" >/dev/null 2>&1; then
              echo "Model already present in the persistent cache."
            else
              ollama pull "$OLLAMA_MODEL"
            fi
            ollama list
            kill "$server_pid"
            wait "$server_pid" || true
          SCRIPT
          ]
          dynamic "env" {
            for_each = local.ollama_env
            content {
              name  = env.key
              value = env.value
            }
          }
          resources {
            requests = { cpu = "250m", memory = "512Mi" }
            limits   = { cpu = "1000m", memory = "1Gi" }
          }
          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities { drop = ["ALL"] }
          }
          volume_mount {
            name       = "models"
            mount_path = "/data"
          }
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }
        }
        container {
          name              = "ollama"
          image             = var.ollama_image
          image_pull_policy = "IfNotPresent"
          command           = ["/bin/ollama"]
          args              = ["serve"]
          port {
            name           = "http"
            container_port = 11434
          }
          dynamic "env" {
            for_each = local.ollama_env
            content {
              name  = env.key
              value = env.value
            }
          }
          resources {
            requests = { cpu = "1000m", memory = "4Gi" }
            limits   = { cpu = "2000m", memory = "5Gi" }
          }
          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities { drop = ["ALL"] }
          }
          volume_mount {
            name       = "models"
            mount_path = "/data"
          }
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }
          startup_probe {
            http_get {
              path = "/api/version"
              port = "http"
            }
            period_seconds    = 5
            timeout_seconds   = 3
            failure_threshold = 60
          }
          readiness_probe {
            http_get {
              path = "/api/tags"
              port = "http"
            }
            period_seconds  = 10
            timeout_seconds = 3
          }
          liveness_probe {
            http_get {
              path = "/api/version"
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
  timeouts {
    create = "35m"
    update = "35m"
  }
}
