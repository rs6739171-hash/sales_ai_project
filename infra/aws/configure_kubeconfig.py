"""Create a separate kubeconfig using Terraform outputs and an SDK exec helper."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def build_kubeconfig(connection: dict, profile: str, python_command: str, auth_script: str) -> dict:
    cluster = connection["cluster_name"]
    return {
        "apiVersion": "v1",
        "kind": "Config",
        "clusters": [
            {
                "name": cluster,
                "cluster": {
                    "server": connection["endpoint"],
                    "certificate-authority-data": connection["ca_data"],
                },
            }
        ],
        "users": [
            {
                "name": cluster + "-sdk",
                "user": {
                    "exec": {
                        "apiVersion": "client.authentication.k8s.io/v1beta1",
                        "command": python_command,
                        "args": [
                            auth_script,
                            "--cluster", cluster,
                            "--region", connection["region"],
                            "--profile", profile,
                        ],
                        "interactiveMode": "Never",
                        "provideClusterInfo": False,
                    }
                },
            }
        ],
        "contexts": [
            {
                "name": "eks-sales-ai",
                "context": {
                    "cluster": cluster,
                    "user": cluster + "-sdk",
                },
            }
        ],
        "current-context": "eks-sales-ai",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the Sales AI EKS kubeconfig.")
    parser.add_argument("--profile", default="sales-ai")
    args = parser.parse_args()
    aws_root = Path(__file__).resolve().parent
    result = subprocess.run(
        [
            "terraform",
            f"-chdir={aws_root / 'foundation'}",
            "output", "-json", "eks_connection",
        ],
        check=True, capture_output=True, text=True,
    )
    connection = json.loads(result.stdout)
    config = build_kubeconfig(
        connection,
        args.profile,
        sys.executable,
        str(aws_root / "eks_auth.py"),
    )
    destination = aws_root / "eks-kubeconfig.yaml"
    destination.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Created kubeconfig: {destination}")
    print("Context: eks-sales-ai")
    print(f"Cluster: {connection['cluster_name']}")
    print(f"Region: {connection['region']}")
    print("AWS profile: " + args.profile)
    print("Authentication tokens will be generated automatically when requested by the client.")


if __name__ == "__main__":
    main()
