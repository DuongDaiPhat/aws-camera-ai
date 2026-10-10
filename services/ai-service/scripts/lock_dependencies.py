"""Regenerate hash locks with the separately installed, pinned pip-tools toolchain."""

import argparse
import importlib.metadata as metadata
import os
import platform
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--training", action="store_true")
    parser.add_argument("--tools", action="store_true")
    args = parser.parse_args()
    if platform.python_version() != "3.11.13" or metadata.version("pip-tools") != "7.4.1":
        raise RuntimeError("Lock generation requires Python 3.11.13 and pip-tools 7.4.1")
    root = Path(__file__).parents[1]
    suffix = "-windows" if sys.platform == "win32" else ""
    common = [
        sys.executable,
        "-m",
        "piptools",
        "compile",
        "--generate-hashes",
        "--strip-extras",
        "--allow-unsafe",
        "--no-emit-index-url",
        "--quiet",
    ]
    os.environ["CUSTOM_COMPILE_COMMAND"] = "python scripts/lock_dependencies.py" + (
        " --training" if args.training else " --tools" if args.tools else ""
    )
    os.environ.setdefault("PIP_DEFAULT_TIMEOUT", "180")
    if args.tools:
        subprocess.run(
            common + ["requirements-lock-tools.in", "-o", "requirements-lock-tools.lock"],
            cwd=root,
            check=True,
        )
    elif args.training:
        if sys.platform != "linux" or platform.machine() != "x86_64":
            raise RuntimeError("The training baseline targets Linux x86_64 CPU")
        subprocess.run(
            common + ["training/requirements.in", "-o", "training/requirements-cpu-linux.lock"],
            cwd=root,
            check=True,
        )
    else:
        runtime = f"requirements-runtime{suffix}.lock"
        dev = f"requirements-dev{suffix}.lock"
        extras = ["--extra=m2a", "--extra=m3"]
        subprocess.run(common + extras + ["pyproject.toml", "-o", runtime], cwd=root, check=True)
        subprocess.run(
            common
            + extras
            + ["--extra=dev", f"--constraint={runtime}", "pyproject.toml", "-o", dev],
            cwd=root,
            check=True,
        )


if __name__ == "__main__":
    main()
