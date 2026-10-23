"""Emit a short-lived EKS ExecCredential for kubectl or Terraform providers.

Uses the AWS SDK for authentication. It does not provision AWS resources.
Normal output is consumed by the calling client and includes a bearer token.
"""

import argparse
import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import boto3
from botocore.config import Config
from botocore.signers import RequestSigner


def create_exec_credential(cluster_name: str, region: str, profile: str | None) -> dict:
    session = boto3.Session(profile_name=profile, region_name=region)
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("No AWS credentials were found for the selected profile.")

    sts = session.client("sts", region_name=region, config=Config(signature_version="v4"))
    identity_url = sts.meta.endpoint_url.rstrip("/") + "/?" + urlencode(
        {"Action": "GetCallerIdentity", "Version": "2011-06-15"}
    )
    signer = RequestSigner(
        service_id=sts.meta.service_model.service_id,
        region_name=region,
        signing_name="sts",
        signature_version="v4",
        credentials=credentials,
        event_emitter=sts.meta.events,
    )
    request = {
        "method": "GET",
        "url": identity_url,
        "body": b"",
        "headers": {"x-k8s-aws-id": cluster_name},
        "context": {},
    }
    signed_url = signer.generate_presigned_url(
        request_dict=request, operation_name="", expires_in=60
    )
    encoded = base64.urlsafe_b64encode(signed_url.encode("utf-8")).decode("ascii").rstrip("=")
    expiry = datetime.now(timezone.utc) + timedelta(minutes=14)
    return {
        "apiVersion": "client.authentication.k8s.io/v1beta1",
        "kind": "ExecCredential",
        "status": {
            "expirationTimestamp": expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "token": "k8s-aws-v1." + encoded,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an EKS authentication token for a client.")
    parser.add_argument("--cluster", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--profile", default=None)
    args = parser.parse_args()
    result = create_exec_credential(args.cluster, args.region, args.profile)
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"EKS authentication failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
