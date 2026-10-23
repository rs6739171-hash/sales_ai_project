"""Prepare Terraform backend files and restrict EKS API access to this computer's public IPv4."""

import ipaddress
import json
import subprocess
import urllib.request
from pathlib import Path


def backend_config(bucket: str, key: str, region: str, profile: str) -> str:
    return (
        f'bucket       = {json.dumps(bucket)}\n'
        f'key          = {json.dumps(key)}\n'
        f'region       = {json.dumps(region)}\n'
        f'profile      = {json.dumps(profile)}\n'
        'encrypt      = true\n'
        'use_lockfile = true\n'
    )


def main() -> None:
    aws_root = Path(__file__).resolve().parent
    bootstrap = aws_root / "bootstrap"
    foundation = aws_root / "foundation"
    result = subprocess.run(
        ["terraform", f"-chdir={bootstrap}", "output", "-json"],
        check=True,
        capture_output=True,
        text=True,
    )
    values = json.loads(result.stdout)
    bucket = values["state_bucket"]["value"]
    region = values["aws_region"]["value"]
    profile = values["aws_profile"]["value"]

    with urllib.request.urlopen("https://checkip.amazonaws.com", timeout=20) as response:
        public_ip = ipaddress.IPv4Address(response.read().decode().strip())
    admin_cidr = f"{public_ip}/32"

    (bootstrap / "backend.hcl").write_text(
        backend_config(bucket, "bootstrap/terraform.tfstate", region, profile), encoding="utf-8"
    )
    (bootstrap / "backend.tf").write_text(
        'terraform {\n  backend "s3" {}\n}\n', encoding="utf-8"
    )
    (foundation / "backend.hcl").write_text(
        backend_config(bucket, "foundation/terraform.tfstate", region, profile), encoding="utf-8"
    )
    (foundation / "terraform.tfvars").write_text(
        f'aws_region  = {json.dumps(region)}\n'
        f'aws_profile = {json.dumps(profile)}\n'
        f'admin_cidr  = {json.dumps(admin_cidr)}\n',
        encoding="utf-8",
    )
    print(f"Region: {region}")
    print(f"Remote state bucket: {bucket}")
    print(f"EKS API allowed source: {admin_cidr}")
    print("Backend configuration files and foundation/terraform.tfvars are ready.")
    print("Next migrate bootstrap state, then initialize the foundation backend.")


if __name__ == "__main__":
    main()
