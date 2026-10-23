"""Check or refresh local kind endpoints for external Docker CI services.

Default: read-only inspection. Add --apply to update stale EndpointSlices.
Uses only the local kind-sales-ai context and jenkins-agents namespace.
"""

import argparse
import ipaddress
import json
import subprocess

KUBE = ["kubectl", "--context=kind-sales-ai", "--request-timeout=15s", "-n", "jenkins-agents"]
TARGETS = (
    ("sales-ai-jenkins", "jenkins-controller", "jenkins-controller-external", 8080),
    ("sales-ai-buildkit", "buildkitd", "buildkitd-external", 1234),
)


def run(arguments: list[str]) -> str:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=45)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(f"Could not run {arguments[0]}: {exc}") from None
    if result.returncode:
        raise SystemExit(result.stderr.strip() or f"Command failed: {arguments[0]}")
    return result.stdout.strip()


def inspect_target(container: str, service: str, name: str, port: int) -> dict:
    if run(["docker", "inspect", "--format={{.State.Running}}", container]) != "true":
        raise SystemExit(f"Container {container} is stopped. Start it with: docker start {container}")
    networks = json.loads(run([
        "docker", "inspect", "--format={{json .NetworkSettings.Networks}}", container,
    ]))
    address = networks.get("kind", {}).get("IPAddress", "")
    try:
        address = str(ipaddress.IPv4Address(address))
    except ipaddress.AddressValueError:
        raise SystemExit(f"Container {container} has no IPv4 address on Docker network kind.") from None
    service_data = json.loads(run(KUBE + ["get", "service", service, "-o", "json"]))
    if service_data.get("spec", {}).get("selector"):
        raise SystemExit(f"Service {service} has a Pod selector; manual external endpoint updates are inappropriate.")
    if not any(p.get("port") == port for p in service_data.get("spec", {}).get("ports", [])):
        raise SystemExit(f"Service {service} is not configured for expected port {port}.")
    endpoint = json.loads(run(KUBE + ["get", "endpointslice", name, "-o", "json"]))
    metadata = endpoint.get("metadata", {})
    labels = metadata.get("labels", {})
    if metadata.get("namespace") != "jenkins-agents" or labels.get("kubernetes.io/service-name") != service:
        raise SystemExit(f"EndpointSlice {name} does not belong to the expected local Service.")
    if endpoint.get("addressType") != "IPv4" or not any(p.get("port") == port for p in endpoint.get("ports", [])):
        raise SystemExit(f"EndpointSlice {name} has an unexpected address type or port.")
    current = [a for e in endpoint.get("endpoints", []) for a in e.get("addresses", [])]
    ready = all(e.get("conditions", {}).get("ready") is not False for e in endpoint.get("endpoints", []))
    return {"container": container, "service": service, "name": name, "address": address,
            "current": current, "changed": current != [address] or not ready}


def synchronize(apply: bool = False) -> int:
    # Inspect every target before changing any resource.
    targets = [inspect_target(*target) for target in TARGETS]
    changes = 0
    for target in targets:
        print(f"{target['service']}: Kubernetes={','.join(target['current']) or '(none)'} "
              f"Docker={target['address']} "
              f"{'UPDATE NEEDED' if target['changed'] else 'MATCH'}")
        if target["changed"]:
            changes += 1
            if apply:
                patch = {"endpoints": [{"addresses": [target["address"]], "conditions": {"ready": True}}]}
                # Python passes JSON as one argument, including on Windows CMD.
                # Only addresses/readiness change; ports and metadata are retained.
                run(KUBE + ["patch", "endpointslice", target["name"], "--type=merge", "--patch=" + json.dumps(patch)])
                print(f"Updated: {target['name']}")
    if not changes:
        print("Both endpoint addresses already match Docker. Inspect the jnlp logs for the connection error.")
    elif not apply:
        print("Read-only check complete. Run this script with --apply to synchronize these local addresses.")
    else:
        print("Local CI endpoints synchronized. The waiting agent can retry its connection.")
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Update stale local EndpointSlice addresses")
    args = parser.parse_args()
    synchronize(args.apply)


if __name__ == "__main__":
    main()
