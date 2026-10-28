"""Set up the isolated Windows YOLO26 export environment inside artifacts/m3."""

import argparse
import hashlib
import json
import logging
import os
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

LOGGER = logging.getLogger(__name__)
UV_URL = "https://files.pythonhosted.org/packages/38/82/94f08992eeb193dc3d5baac437d1867cd37f040f34c7b1a4b1bde2bc4b4b/uv-0.8.22-py3-none-win_amd64.whl"
UV_SHA256 = "cda349c9ea53644d8d9ceae30db71616b733eb5330375ab4259765aef494b74e"


def prepare_uv(workspace: Path) -> Path:
    bootstrap = workspace / "bootstrap"
    bootstrap.mkdir(parents=True, exist_ok=True)
    wheel = bootstrap / "uv-0.8.22-py3-none-win_amd64.whl"
    if not wheel.exists():
        LOGGER.info("Downloading pinned uv bootstrap wheel")
        urllib.request.urlretrieve(UV_URL, wheel)
    with wheel.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != UV_SHA256:
        raise RuntimeError("uv wheel SHA-256 does not match the pinned source")
    executable = bootstrap / "uv.exe"
    with zipfile.ZipFile(wheel) as archive:
        member = next(name for name in archive.namelist() if name.endswith("/uv.exe"))
        executable.write_bytes(archive.read(member))
    (bootstrap / "source.json").write_text(
        json.dumps({"url": UV_URL, "sha256": digest}, indent=2) + "\n", encoding="utf-8"
    )
    return executable


def run(command: list[str], environment: dict[str, str], root: Path) -> None:
    subprocess.run(command, env=environment, cwd=root, check=True)


def prepare_venv(
    uv: Path, base: Path, directory: Path, environment: dict[str, str], root: Path
) -> Path:
    executable = directory / "Scripts" / "python.exe"
    if not executable.exists():
        run(
            [
                str(uv),
                "venv",
                str(directory),
                "--python",
                str(base),
                "--no-python-downloads",
                "--no-config",
                "--no-progress",
            ],
            environment,
            root,
        )
    version = subprocess.check_output(
        [str(executable), "-c", "import platform; print(platform.python_version())"],
        env=environment,
        cwd=root,
        text=True,
    ).strip()
    if version != "3.11.13":
        raise RuntimeError(
            f"Keep the existing environment unchanged: expected 3.11.13, got {version}"
        )
    return executable


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--resolve-lock",
        action="store_true",
        help="Regenerate this candidate's Windows lock using pip-tools",
    )
    args = parser.parse_args()
    if sys.platform != "win32" or sys.maxsize <= 2**32:
        raise RuntimeError("This candidate setup targets Windows x64 only")
    directory = Path(__file__).resolve().parent
    root = directory.parents[3]
    workspace = root / "artifacts" / "m3"
    uv = prepare_uv(workspace)
    environment = os.environ.copy()
    environment.update(
        {
            "UV_CACHE_DIR": str(workspace / "cache" / "uv"),
            "PIP_CACHE_DIR": str(workspace / "cache" / "pip"),
            "PIP_CONFIG_FILE": os.devnull,
            "PYTHONNOUSERSITE": "1",
            "CUSTOM_COMPILE_COMMAND": "python services/ai-service/training/yolo26/setup_export.py --resolve-lock",
        }
    )
    run(
        [
            str(uv),
            "python",
            "install",
            "3.11.13",
            "--install-dir",
            str(workspace / "python"),
            "--no-bin",
            "--no-registry",
            "--no-config",
            "--no-progress",
        ],
        environment,
        root,
    )
    base = workspace / "python" / "cpython-3.11.13-windows-x86_64-none" / "python.exe"
    export_python = prepare_venv(uv, base, workspace / "export-env", environment, root)
    lockfile = directory / "requirements-export-windows.lock"
    if args.resolve_lock:
        lock_python = prepare_venv(uv, base, workspace / "lock-env", environment, root)
        run(
            [
                str(uv),
                "pip",
                "sync",
                "--python",
                str(lock_python),
                "--require-hashes",
                str(directory.parent.parent / "requirements-lock-tools.lock"),
                "--index-url",
                "https://pypi.org/simple",
                "--no-config",
                "--no-progress",
            ],
            environment,
            root,
        )
        run(
            [
                str(lock_python),
                "-m",
                "piptools",
                "compile",
                "--generate-hashes",
                "--strip-extras",
                "--allow-unsafe",
                "--no-emit-index-url",
                "--output-file",
                str(lockfile),
                str(directory / "requirements-export-windows.in"),
            ],
            environment,
            root,
        )
    if not lockfile.exists():
        raise FileNotFoundError("Generate and review the export lock with --resolve-lock first")
    run(
        [
            str(uv),
            "pip",
            "sync",
            "--python",
            str(export_python),
            "--require-hashes",
            str(lockfile),
            "--index-url",
            "https://pypi.org/simple",
            "--no-config",
            "--no-progress",
        ],
        environment,
        root,
    )
    run([str(uv), "pip", "check", "--python", str(export_python), "--no-config"], environment, root)
    LOGGER.info("Export interpreter ready: %s", export_python)


if __name__ == "__main__":
    main()
