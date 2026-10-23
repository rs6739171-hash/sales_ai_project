"""Test actual CPU inference in EKS through a temporary localhost tunnel."""

import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    command = ["kubectl", f"--kubeconfig={root / 'eks-kubeconfig.yaml'}", "--context=eks-sales-ai",
               "-n", "sales-ai", "port-forward", "service/ollama", "11435:11434", "--address=127.0.0.1"]
    base = "http://127.0.0.1:11435"
    tunnel = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        available = False
        for attempt in range(60):
            if tunnel.poll() is not None:
                raise SystemExit("Port-forward exited. Check EKS access and whether localhost port 11435 is already in use.")
            try:
                with urllib.request.urlopen(base + "/api/tags", timeout=2) as response:
                    models = json.load(response).get("models", [])
                available = True
                break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(1)
        if not available:
            raise SystemExit("Ollama is not ready. Check its Pod and download-model init-container logs.")
        if not any(m.get("name") == "qwen3:4b" for m in models):
            raise SystemExit("qwen3:4b is not in the EKS model cache.")
        print("Model cache: qwen3:4b found in EKS.")
        print("Testing inference on the AWS worker CPU; first use includes model loading.", flush=True)
        body = {"model": "qwen3:4b", "prompt": "Reply with only this word: READY",
                "think": False, "stream": False, "keep_alive": "5m",
                "options": {"num_ctx": 4096, "num_predict": 16, "temperature": 0}}
        request = urllib.request.Request(base + "/api/generate", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                result = json.load(response)
        except (urllib.error.URLError, TimeoutError):
            raise SystemExit("Inference failed or exceeded 240 seconds. Inspect the Ollama Pod logs and resource usage.") from None
        reply = result.get("response", "").strip()
        if result.get("error") or not result.get("done") or not reply:
            raise SystemExit("Ollama did not return a completed, non-empty response.")
        print("Reply:", reply)
        print(f"Elapsed seconds: {time.monotonic() - started:.1f}")
        print("PASS: EKS model download and CPU inference work.")
    finally:
        tunnel.terminate()
        try:
            tunnel.wait(timeout=10)
        except subprocess.TimeoutExpired:
            tunnel.kill()
            tunnel.wait()


if __name__ == "__main__":
    main()
