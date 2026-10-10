"""Prepare explicitly requested model artifacts; verify every download against the manifest."""

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((Path(__file__).parents[1] / "model-manifest.json").read_text())
    for item in manifest["models"]:
        path = args.output_dir / item["filename"]
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]:
            continue
        with urllib.request.urlopen(item["url"], timeout=120) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise ValueError(f"Model checksum mismatch: {item['name']}")
        path.write_bytes(content)
        print(f"Verified {item['name']}: {item['sha256']}")


if __name__ == "__main__":
    main()
