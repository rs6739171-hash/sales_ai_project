"""Configure application state and a matched, digest-pinned Jenkins release.

No credentials are written here. Existing web enablement is preserved on reruns.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

COMMIT = "f363ace672a60b4d77a66f43971aa49f010b08f1"
BACKEND = "ghcr.io/rs6739171-hash/sales-ai-backend@sha256:2865d36d1f5de1cdeffeb58ef8aa9e19296fa8e8a0b7869dfae1095f78eac22b"
FRONTEND = "ghcr.io/rs6739171-hash/sales-ai-frontend@sha256:ab8006d0a962019b1eb11e0a3102d3f76dbdefcd4f8c797cd7715ad4973ee0d2"
# Official Ollama 0.40.9, linux/amd64 manifest verified against Docker Hub.
OLLAMA = "docker.io/ollama/ollama@sha256:1914dade358389ce67f527f8d54914f0872fdafdc7a95980096ad0ff6a381196"


def web_enabled(path: Path, requested: bool) -> bool:
    if requested:
        return True
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    return bool(re.search(r"^deploy_web\s*=\s*true\s*$", text, re.MULTILINE))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enable-web", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    target = root / "application"
    result = subprocess.run(
        ["terraform", f"-chdir={root / 'bootstrap'}", "output", "-json"],
        check=True, capture_output=True, text=True,
    )
    outputs = json.loads(result.stdout)
    bucket = outputs["state_bucket"]["value"]
    region = outputs["aws_region"]["value"]
    profile = outputs["aws_profile"]["value"]
    enabled = web_enabled(target / "terraform.tfvars", args.enable_web)
    if args.enable_web:
        # Check Secret existence, without reading Secret values into Terraform.
        for name in ("ghcr-pull", "sales-ai-backend-env"):
            check = subprocess.run(
                ["kubectl", f"--kubeconfig={root / 'eks-kubeconfig.yaml'}", "--context=eks-sales-ai",
                 "-n", "sales-ai", "get", "secret", name, "-o", "name"],
                capture_output=True, text=True,
            )
            if check.returncode:
                raise SystemExit(f"Cannot confirm Secret {name}. Configure runtime Secrets before enabling web workloads.")
    (target / "backend.hcl").write_text(
        f'bucket = {json.dumps(bucket)}\nkey = "application/terraform.tfstate"\n'
        f'region = {json.dumps(region)}\nprofile = {json.dumps(profile)}\n'
        'encrypt = true\nuse_lockfile = true\n', encoding="utf-8",
    )
    values = {
        "state_bucket": bucket, "aws_region": region, "aws_profile": profile,
        "python_executable": sys.executable, "auth_script": str(root / "eks_auth.py"),
        "deploy_web": enabled, "backend_image": BACKEND, "frontend_image": FRONTEND,
        "ollama_image": OLLAMA,
    }
    (target / "terraform.tfvars").write_text(
        "".join(f"{key} = {json.dumps(value)}\n" for key, value in values.items()), encoding="utf-8",
    )
    print(f"Matched application release: {COMMIT}")
    print(f"Web workloads enabled: {enabled}")
    print("Remote state key: application/terraform.tfstate")
    print("Application backend and SDK authentication paths are ready.")


if __name__ == "__main__":
    main()
