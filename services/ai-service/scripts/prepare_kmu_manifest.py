"""Stage the frozen KMU follow-up from locally downloaded official archives.

Download the archive URLs recorded in the manifest's source page first; academic
research terms apply. No network call, inference or existing-file replacement.
"""

import argparse
import shutil
import zipfile
from pathlib import Path

from scripts.evaluate_fire_manifest import REPOSITORY_ROOT, VideoManifest, verified_inputs
from scripts.evaluate_fire_videos import checksum


def stage(manifest_path: Path, archives_dir: Path) -> None:
    manifest = VideoManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    root = (REPOSITORY_ROOT / manifest.dataset_root).resolve()
    if not root.is_relative_to(REPOSITORY_ROOT):
        raise ValueError("Dataset must stay inside the repository")
    for positive, filename, key in (
        (True, "flame.zip", "flameArchiveSha256"),
        (False, "hard-negatives.zip", "negativeArchiveSha256"),
    ):
        archive_path = archives_dir / filename
        if checksum(archive_path) != manifest.provenance[key]:
            raise ValueError(f"Official archive bytes differ from the frozen manifest: {filename}")
        with zipfile.ZipFile(archive_path) as source:
            for clip in manifest.clips:
                if clip.expected_fire != positive:
                    continue
                destination = (root / clip.path).resolve()
                if not destination.is_relative_to(root):
                    raise ValueError("Video path escapes dataset root")
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    with source.open(clip.source_entry) as stream, destination.open("xb") as output:
                        shutil.copyfileobj(stream, output)
                if checksum(destination) != clip.sha256:
                    raise ValueError(f"Staged video checksum mismatch: {clip.path}")
    verified_inputs(manifest, REPOSITORY_ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--archives-dir", type=Path, required=True)
    args = parser.parse_args()
    stage(args.manifest, args.archives_dir)


if __name__ == "__main__":
    main()
