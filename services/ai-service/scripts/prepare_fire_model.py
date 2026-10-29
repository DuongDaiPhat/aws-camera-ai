"""Stage the registered local candidate without downloading or replacing another model."""

import argparse
import hashlib
import json
import logging
import shutil
from pathlib import Path

LOGGER = logging.getLogger(__name__)


def checksum(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    service_dir = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=service_dir / "models")
    parser.add_argument(
        "--artifact-version", help="Select a recorded historical artifact for rollback"
    )
    args = parser.parse_args()
    manifest = json.loads((service_dir / "model-manifest.json").read_text(encoding="utf-8"))
    artifact = manifest["fire"]["artifact"]
    if args.artifact_version and args.artifact_version != artifact["modelVersion"]:
        matches = [
            item
            for item in manifest["fire"].get("previousArtifacts", [])
            if item["modelVersion"] == args.artifact_version
        ]
        if len(matches) != 1:
            raise ValueError("Unknown or ambiguous historical fire artifact version")
        artifact = matches[0]
    if args.source.stat().st_size != artifact["sizeBytes"]:
        raise ValueError("Fire model size does not match the registered candidate")
    if checksum(args.source) != artifact["sha256"]:
        raise ValueError("Fire model checksum does not match the registered candidate")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    destination = args.output_dir / artifact["filename"]
    contract_path = destination.with_suffix(".contract.json")
    contract = {
        "modelSha256": artifact["sha256"],
        "predictionMode": artifact["predictionMode"],
        "outputConfidenceFloor": artifact["outputConfidenceFloor"],
    }
    if contract_path.exists() and json.loads(contract_path.read_text(encoding="utf-8")) != contract:
        raise FileExistsError("A different deployment contract already exists")
    if destination.exists():
        if checksum(destination) != artifact["sha256"]:
            raise FileExistsError("A different fire model already exists; choose another directory")
    else:
        # Exclusive creation avoids overwriting an artifact staged by another process.
        with destination.open("xb") as output, args.source.open("rb") as source:
            shutil.copyfileobj(source, output)
    if checksum(destination) != artifact["sha256"]:
        raise ValueError("Staged fire model checksum verification failed")
    if not contract_path.exists():
        with contract_path.open("x", encoding="utf-8") as output:
            output.write(json.dumps(contract, indent=2) + "\n")
    LOGGER.info("Verified fire candidate: %s (%s)", destination, artifact["sha256"])


if __name__ == "__main__":
    main()
