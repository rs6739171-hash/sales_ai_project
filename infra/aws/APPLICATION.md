# Application on EKS: first deployment stage

This package adds deployment configuration to your existing Git-backed project.
It does not modify the application source, Dockerfiles, Jenkinsfile, foundation,
or platform configuration. Extract its `infra` directory into your project root.

## What this stage does

- Uses a separate remote state key: `application/terraform.tfstate`.
- Creates the `sales-ai` namespace and a runtime ServiceAccount without an API token.
- Starts one internal Ollama server with a 20 GiB encrypted gp3 model cache.
- Downloads `qwen3:4b` in an init container before starting the server.
- Runs Ollama as UID/GID 1000, with dropped capabilities and a read-only root filesystem.
- Pins official Ollama 0.40.9 to its verified linux/amd64 Docker Hub manifest digest.
- Records both Jenkins image digests from commit `4dfe4ff075d382c7444ef5b69bdda6ec984afa59`.
- Keeps `deploy_web = false` until runtime Secrets are configured.

## Run from Windows CMD in the activated project environment

```cmd
cd /d "C:\Users\RISHABH\Downloads\Project\sales_ai_project"
python infra\aws\configure_application.py
terraform -chdir=infra/aws/application init -backend-config=backend.hcl
terraform -chdir=infra/aws/application validate
terraform -chdir=infra/aws/application plan -out=application-ollama.tfplan
terraform -chdir=infra/aws/application apply application-ollama.tfplan
```

The helper reads your existing bootstrap outputs and records your current Python
interpreter and EKS authentication script. It does not store AWS access keys.
`init` connects this root to S3 state and installs the Kubernetes provider.
`validate` checks the provider configuration. `plan` shows exactly what will be
created. `apply` creates the namespace, account, volume claim, Service, and Ollama
Deployment; it waits for the Deployment to become ready.

Image pulling and the first model download can take several minutes. In another
CMD window, run from the same project root:

```cmd
kubectl --kubeconfig=infra/aws/eks-kubeconfig.yaml --context=eks-sales-ai -n sales-ai get pods,pvc
kubectl --kubeconfig=infra/aws/eks-kubeconfig.yaml --context=eks-sales-ai -n sales-ai logs deployment/ollama -c download-model --tail=20
```

`Init:0/1` is expected while downloading the model. The second command shows
download progress after the container has started. At first it may report that
the Pod/container is not yet available while the image is being pulled. Use
`kubectl ... describe pod POD_NAME` to inspect image pull or scheduling events.

After apply finishes:

```cmd
kubectl --kubeconfig=infra/aws/eks-kubeconfig.yaml --context=eks-sales-ai -n sales-ai get pods,pvc
python infra\aws\check_eks_ollama.py
```

The check helper starts a temporary tunnel on localhost port 11435, verifies the
model exists on EKS, requests a short response with thinking disabled, reports
the duration, then closes the tunnel. It does not use your laptop's Ollama.
It verifies inference, not only that the process is running.

## Files prepared for the following stage

`web.tf` contains the digest-pinned backend and frontend, internal Services,
two replicas per application component, startup/readiness/liveness probes,
resource requests and limits, node/zone spreading, disruption budgets, and CPU
HPAs. The backend points to `http://ollama:11434`. The HPA ranges are backend
2–6 and frontend 2–4; Terraform ignores subsequent Deployment replica changes.
The existing Cluster Autoscaler adds workers when Pods cannot fit on existing
workers, within the foundation's total 2–4 worker range and available quota.

The next stage uses `configure_runtime_secrets.py` with your existing .env file
and a hidden GHCR PAT prompt, then `configure_application.py --enable-web`.
Do not enable the web workloads until the Ollama check passes and the Secrets
have been configured. The helper preserves web enablement on later reruns.

The Secrets helper imports only the six allowlisted Databricks variables,
requires SQL credentials plus the pipeline job/volume settings, and sends
Secret documents to kubectl over stdin using server-side apply. It avoids
Secret-bearing arguments, temporary files, last-applied annotations, and
Terraform state. Kubernetes stores and serves the Secrets under its own access
controls; they are not external vault references. Rotate credentials through
the helper and restart backend Pods when Secret values change.

## Current deployment limits

The workers are CPU instances. A working inference check does not establish
acceptable latency for long analytics prompts or concurrent chat sessions.
One Ollama replica accepts one inference request at a time with a bounded queue.
More backend replicas do not increase Ollama's inference capacity. CPU HPA is
a starting policy; I/O-bound traffic requires further metrics and load testing.

The model cache is a single-AZ EBS volume. Rescheduling within that AZ retains
the cache; losing the AZ requires cache recreation and a fresh model download.
The Ollama update strategy is Recreate, so updating it interrupts inference.
Deleting this PVC deletes its backing EBS volume under the gp3 StorageClass's
Delete reclaim policy. Model tags can change upstream: the first download
resolves qwen3:4b, and later starts reuse the cache. Record/pin the model manifest
as part of a later model release process.

There is no public application endpoint in this stage. The ALB and access/TLS
configuration follow verification of the private application. The application
images are reused as built; backend/frontend container users and writable image
filesystems still require a future image-hardening release. Do not describe this
first deployment as fully production ready.

The existing infra/aws/.gitignore excludes generated terraform.tfvars,
backend.hcl, *.tfplan, state and .terraform caches. Keep application .env files
and registry tokens out of Git. Commit the provider lockfile after init.
