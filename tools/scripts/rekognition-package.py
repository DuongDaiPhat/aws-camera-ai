"""Package the verified report with a content hash manifest and no runtime secrets."""

import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/test/REKOGNITION_2026-11-22"


def main():
    audit = json.loads((REPORT / "data/completion-audit.json").read_text())
    if audit["status"] != "passed":
        raise RuntimeError("The evidence audit must pass before packaging")
    target = ROOT / "outputs/rekognition-2026-11-22-evidence.zip"
    target.parent.mkdir(exist_ok=True)
    manifest = []
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(REPORT.rglob("*")):
            if not path.is_file():
                continue
            data = path.read_bytes()
            relative = path.relative_to(REPORT).as_posix()
            manifest.append(
                {
                    "path": relative,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
            bundle.writestr(REPORT.name + "/" + relative, data)
        bundle.writestr(
            REPORT.name + "/MANIFEST_SHA256.json",
            json.dumps(manifest, indent=2).encode(),
        )
    with zipfile.ZipFile(target) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError("ZIP integrity check failed")
        for row in manifest:
            data = bundle.read(REPORT.name + "/" + row["path"])
            if hashlib.sha256(data).hexdigest() != row["sha256"]:
                raise RuntimeError("Packaged content differs from manifest")
    print(
        json.dumps(
            {
                "archive": str(target),
                "files": len(manifest),
                "bytes": target.stat().st_size,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
