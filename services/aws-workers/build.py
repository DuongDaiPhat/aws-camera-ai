"""Build Linux x86_64 Python 3.12 Lambda ZIPs from any host."""

import argparse
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

WORKERS = ("face", "sender")


def build_worker(source, build_dir):
    archive = build_dir / f"{source.name}.zip"
    with TemporaryDirectory(prefix=f"{source.name}-", dir=build_dir) as temporary:
        scratch = Path(temporary)
        package = scratch / "package"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--requirement",
                str(source / "requirements.txt"),
                "--target",
                str(package),
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
        for name in ("handler.py", "queue-v1.schema.json"):
            (package / name).write_bytes((source / name).read_bytes())
        temporary_archive = scratch / archive.name
        with ZipFile(temporary_archive, "w", ZIP_DEFLATED) as bundle:
            for item in sorted(package.rglob("*")):
                if item.is_file() and "__pycache__" not in item.parts:
                    bundle.write(item, item.relative_to(package).as_posix())
        temporary_archive.replace(archive)
    print(archive)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", choices=WORKERS, help="Build only this worker")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    build_dir = root / ".build"
    build_dir.mkdir(exist_ok=True)
    if build_dir.resolve() != build_dir:
        raise ValueError("Lambda build directory must stay inside services/aws-workers")
    for worker in (args.worker,) if args.worker else WORKERS:
        build_worker(root / worker, build_dir)


if __name__ == "__main__":
    main()
