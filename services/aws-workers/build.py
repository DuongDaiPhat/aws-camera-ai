"""Build the Linux x86_64 Python 3.12 face Lambda ZIP from any host."""

import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parent
    output = root / ".build" / "face"
    output.mkdir(parents=True, exist_ok=False)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--requirement",
            str(root / "face/requirements.txt"),
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
    for name in ("handler.py", "queue-v1.schema.json"):
        (output / name).write_bytes((root / "face" / name).read_bytes())
    archive = output.parent / "face.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        for item in sorted(output.rglob("*")):
            if item.is_file() and "__pycache__" not in item.parts:
                bundle.write(item, item.relative_to(output).as_posix())
    print(archive)


if __name__ == "__main__":
    main()
