"""Prepare the platform Terraform backend and local SDK authentication paths."""

import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    aws_root = Path(__file__).resolve().parent
    platform = aws_root / "platform"
    result = subprocess.run(
        ["terraform", f"-chdir={aws_root / 'bootstrap'}", "output", "-json"],
        check=True, capture_output=True, text=True,
    )
    outputs = json.loads(result.stdout)
    bucket = outputs["state_bucket"]["value"]
    region = outputs["aws_region"]["value"]
    profile = outputs["aws_profile"]["value"]
    (platform / "backend.hcl").write_text(
        f'bucket       = {json.dumps(bucket)}\n'
        'key          = "platform/terraform.tfstate"\n'
        f'region       = {json.dumps(region)}\n'
        f'profile      = {json.dumps(profile)}\n'
        'encrypt      = true\n'
        'use_lockfile = true\n',
        encoding="utf-8",
    )
    values = {
        "state_bucket": bucket,
        "aws_region": region,
        "aws_profile": profile,
        "python_executable": sys.executable,
        "auth_script": str(aws_root / "eks_auth.py"),
    }
    (platform / "terraform.tfvars").write_text(
        "".join(f"{key} = {json.dumps(value)}\n" for key, value in values.items()),
        encoding="utf-8",
    )
    print(f"Platform state bucket: {bucket}")
    print("Platform state key: platform/terraform.tfstate")
    print(f"Region: {region}")
    print("Platform backend and SDK authentication paths are ready.")


if __name__ == "__main__":
    main()
