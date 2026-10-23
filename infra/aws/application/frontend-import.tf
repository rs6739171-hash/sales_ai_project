# Recovery for the frontend Deployment whose first rollout failed before the
# old provider populated its identity. Keep this block as an adoption record.
# Use only with deploy_web=true and after removing the broken frontend binding.
import {
  to = kubernetes_deployment_v1.web["frontend"]
  id = "sales-ai/sales-ai-frontend"
}
