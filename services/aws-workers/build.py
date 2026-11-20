"""Build Linux x86_64 Python 3.12 Lambda ZIP packages from any host."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

WORKERS = ("face", "deadline")


def build_worker(root: Path, name: str) -> Path:
    output = root / ".build" / name
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--requirement",
            str(root / name / "requirements.txt"),
            "--target",
            str(output),
            "--platform",
            "manylinux2014_x86_64",
            "--implementation",
            "cp",
            "--python-version",
            "3.12",
            "--abi",
            "cp312",
            "--only-binary=:all:",
        ],
        check=True,
    )
    for asset in ("handler.py", "queue-v1.schema.json"):
        (output / asset).write_bytes((root / name / asset).read_bytes())
    archive = output.parent / f"{name}.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        for item in sorted(output.rglob("*")):
            if item.is_file() and "__pycache__" not in item.parts:
                bundle.write(item, item.relative_to(output).as_posix())
    print(archive)
    return archive


def main():
    parser = argparse.ArgumentParser(description="Build AWS worker ZIP bundles.")
    parser.add_argument(
        "--worker",
        choices=(*WORKERS, "all"),
        default="all",
        help="Worker package to build (default: all)",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    targets = WORKERS if args.worker == "all" else (args.worker,)
    for target in targets:
        build_worker(root, target)


if __name__ == "__main__":
    main()
