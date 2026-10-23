# Sales AI AWS foundation

Region: ap-south-1. Existing local AWS profile: sales-ai.

This stage provisions the network and Kubernetes foundation. Application deployment,
the load balancer controller, Cluster Autoscaler, metrics and HPA follow separately.
The worker limits alone do not enable automatic scaling.

## Contents

- bootstrap: versioned, encrypted, private S3 state bucket with HTTPS-only access.
- configure_foundation.py: generates state configuration and a single-IP EKS API allowlist.
- foundation: VPC, Internet Gateway, two public and two private subnets, one NAT Gateway
  per zone, EKS 1.36, two managed node groups, workload IAM roles, managed networking
  and EBS CSI add-ons, audit logs, and autoscaler discovery tags.

Each node group starts with one m7i.large worker and can grow to two.
There are two workers initially and a maximum of four across two zones.
Each worker has 2 vCPUs and 8 GiB RAM. Extra EC2 usage also consumes account quota.
Terraform ignores the controller-managed desired worker count.

## Run from Windows CMD at the project root

1. terraform -chdir=infra/aws/bootstrap init
2. terraform -chdir=infra/aws/bootstrap validate
3. terraform -chdir=infra/aws/bootstrap plan -out=bootstrap.tfplan
4. Review the plan, then: terraform -chdir=infra/aws/bootstrap apply bootstrap.tfplan
5. python infra\aws\configure_foundation.py
6. terraform -chdir=infra/aws/bootstrap init -migrate-state -backend-config=backend.hcl
   Answer yes when asked to copy the existing bootstrap state into S3.
7. terraform -chdir=infra/aws/foundation init -backend-config=backend.hcl
8. terraform -chdir=infra/aws/foundation validate
9. terraform -chdir=infra/aws/foundation plan -out=foundation.tfplan
10. Review the plan, then: terraform -chdir=infra/aws/foundation apply foundation.tfplan

Run the commands in order. Stop on an error and retain the error output.
Do not delete Terraform state or lock files to resolve a failed apply.
Do not interrupt a running apply just because EKS creation takes time.

The helper creates ignored backend.hcl and terraform.tfvars files. They contain
deployment settings, not access keys. AWS access keys remain in the local profile.
The generated bootstrap/backend.tf declares the migrated S3 backend.
Keep .terraform.lock.hcl files in Git; they pin provider selections.

If your public IP changes later, re-run configure_foundation.py and review/apply the
foundation plan to update the API allowlist. If the API times out, check that first.

## Validation and scope

Source formatting has been checked with Terraform. The helper was exercised with
mock outputs and a mock public IP. Provider schema validation must complete on your
Windows machine before applying: the preparation environment blocks the local Unix
socket used by Terraform's AWS provider. No AWS resources were created by preparation.

## Cost and teardown

EKS, EC2 workers, both NAT Gateways, Elastic IPs, EBS and logs incur charges.
The four-node maximum is a capacity ceiling, not a spending limit.
After the project is finished, delete application-created load balancers and volumes
through their owning manifests/controllers before destroying the foundation.
The state bucket is protected against destruction and must be retained until all
managed infrastructure has been removed and state retention is addressed explicitly.
