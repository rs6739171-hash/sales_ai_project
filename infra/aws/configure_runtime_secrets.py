"""Import only Databricks settings and a GHCR pull credential into EKS.

Run locally after the first application Terraform apply creates the namespace.
Secrets go to kubectl over stdin, never into arguments, files, or Terraform.
"""

import argparse
import base64
import getpass
import json
import subprocess
import warnings
from pathlib import Path

ALLOWED_KEYS = (
    "DATABRICKS_SERVER_HOSTNAME", "DATABRICKS_HTTP_PATH", "DATABRICKS_TOKEN",
    "DATABRICKS_HOST", "DATABRICKS_JOB_ID", "DATABRICKS_VOLUME_INCOMING_PATH",
)
REQUIRED_KEYS = tuple(k for k in ALLOWED_KEYS if k != "DATABRICKS_HOST")


def read_databricks(path: Path) -> dict[str, str]:
    try:
        from dotenv import dotenv_values
    except ImportError:
        raise SystemExit("Activate your project environment, which contains python-dotenv.") from None
    values = dotenv_values(path, encoding="utf-8-sig")
    data = {key: str(values[key]).strip() for key in ALLOWED_KEYS if values.get(key)}
    missing = [key for key in REQUIRED_KEYS if not data.get(key)]
    if missing:
        raise SystemExit("Missing required Databricks settings: " + ", ".join(missing))
    return data


def registry_secret(username: str, token: str) -> dict:
    auth = base64.b64encode(f"{username}:{token}".encode()).decode()
    docker_config = json.dumps({"auths": {"ghcr.io": {"auth": auth}}})
    return {
        "apiVersion": "v1", "kind": "Secret",
        "metadata": {"name": "ghcr-pull", "namespace": "sales-ai"},
        "type": "kubernetes.io/dockerconfigjson",
        "data": {".dockerconfigjson": base64.b64encode(docker_config.encode()).decode()},
    }


def apply_secret(kubeconfig: Path, document: dict) -> None:
    command = ["kubectl", f"--kubeconfig={kubeconfig}", "--context=eks-sales-ai",
               "apply", "--server-side", "--field-manager=sales-ai-runtime-secrets", "-f", "-"]
    result = subprocess.run(command, input=json.dumps(document), capture_output=True, text=True)
    name = document["metadata"]["name"]
    if result.returncode:
        # Kubernetes errors can echo submitted values. Never print those errors.
        raise SystemExit(f"Unable to apply Secret {name}. Check EKS access, namespace existence, and Secret field ownership. No Secret values were printed.")
    print(f"Configured Secret: sales-ai/{name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--github-user", default="rs6739171-hash")
    args = parser.parse_args()
    path = args.env_file.resolve()
    if not path.is_file():
        raise SystemExit("The selected .env file does not exist.")
    data = read_databricks(path)
    root = Path(__file__).resolve().parent
    kubeconfig = root / "eks-kubeconfig.yaml"
    if not kubeconfig.is_file():
        raise SystemExit("First run configure_kubeconfig.py to create the separate EKS kubeconfig.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            token = getpass.getpass("GitHub PAT (classic, read:packages; input hidden): ").strip()
        except getpass.GetPassWarning:
            raise SystemExit("Run this script in an interactive CMD terminal so the token stays hidden.") from None
    if not token:
        raise SystemExit("A GHCR pull token is required for private images.")
    apply_secret(kubeconfig, registry_secret(args.github_user, token))
    apply_secret(kubeconfig, {
        "apiVersion": "v1", "kind": "Secret",
        "metadata": {"name": "sales-ai-backend-env", "namespace": "sales-ai"},
        "type": "Opaque",
        "data": {key: base64.b64encode(value.encode()).decode() for key, value in data.items()},
    })
    print("Only allowlisted Databricks settings were imported from the selected .env file.")
    print("AWS credentials and old cloud-provider credentials were not imported.")


if __name__ == "__main__":
    main()
