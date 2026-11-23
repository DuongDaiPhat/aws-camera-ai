"""Prepare explicitly requested model artifacts; verify every download against the manifest."""

import argparse
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path


def _extract_member(content: bytes, member_name: str) -> bytes:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for candidate in archive.namelist():
            if candidate == member_name or candidate.endswith(f"/{member_name}"):
                return archive.read(candidate)
    raise FileNotFoundError(f"Archive member not found: {member_name}")


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
        if item.get("archiveMember"):
            content = _extract_member(content, item["archiveMember"])
        if hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise ValueError(f"Model checksum mismatch: {item['name']}")
        path.write_bytes(content)
        print(f"Verified {item['name']}: {item['sha256']}")


if __name__ == "__main__":
    main()
