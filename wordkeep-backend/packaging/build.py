"""Assemble the backend, models, configuration and release licenses."""

import argparse
import compileall
import hashlib
import importlib.metadata
import json
import os
import platform
import py_compile
import runpy
import shutil
import subprocess
import sys
import sysconfig
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
DIST = ROOT / "dist"
RESOURCES = DIST / "wordkeep-backend"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def checked_path(root: Path, relative: str) -> Path:
    target = root / relative
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"resource escapes its directory: {relative}")
    return target


def prepare_models() -> None:
    downloader = runpy.run_path(
        str(Path(__file__).resolve().parents[1] / "data/download_models.py")
    )
    downloader["prepare_models"](
        ROOT / "data/model-manifest.json",
        RESOURCES / "data/hanlp",
        BUILD / "downloads",
        source=ROOT / "data/hanlp",
    )
    shutil.copyfile(
        ROOT / "data/model-manifest.json", RESOURCES / "data/model-manifest.json"
    )


def bundled_distributions() -> list[importlib.metadata.Distribution]:
    """Select owners of files actually shipped by PyInstaller, plus its bootloader."""
    bundle = RESOURCES / "_internal"
    if not bundle.is_dir():
        raise RuntimeError("Build the backend before collecting its licenses")
    shipped = {
        path.relative_to(bundle).as_posix()
        for path in bundle.rglob("*")
        if path.is_file()
    }

    def included(dist: importlib.metadata.Distribution) -> bool:
        if dist.metadata["Name"].lower() == "pyinstaller":
            return True  # The executable contains PyInstaller's bootloader.
        for name in dist.files or []:
            if ".." in name.parts:
                continue
            if name.as_posix() in shipped:
                return True
            # noarchive=True installs Python modules as loose .pyc files.
            if name.suffix == ".py" and name.with_suffix(".pyc").as_posix() in shipped:
                return True
        return False

    return [dist for dist in importlib.metadata.distributions() if included(dist)]


def collect_licenses() -> None:
    target = RESOURCES / "licenses"
    shutil.copytree(ROOT / "packaging/licenses", target)
    shutil.copyfile(
        ROOT / "packaging/THIRD_PARTY_NOTICES.md", target / "THIRD_PARTY_NOTICES.md"
    )
    shutil.copyfile(ROOT / "LICENSE", target / "Wordkeep-LICENSE.txt")
    packages = []
    for dist in sorted(
        bundled_distributions(),
        key=lambda item: item.metadata["Name"].lower(),
    ):
        name = dist.metadata["Name"]
        if name == "wordkeep-backend":
            continue
        license_paths = []
        for file in dist.files or []:
            if not file.name.lower().startswith(
                ("license", "licence", "copying", "notice", "copyright")
            ):
                continue
            source = Path(dist.locate_file(file))
            if not source.is_file():
                continue
            safe_name = str(file).replace("../", "").replace("..\\", "")
            destination = checked_path(target / "python" / name, safe_name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            license_paths.append(str(destination.relative_to(target)))
        if not license_paths:
            headers = []
            for file in dist.files or []:
                if file.suffix != ".py":
                    continue
                source = Path(dist.locate_file(file))
                if not source.is_file():
                    continue
                lines = []
                for line in source.read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines():
                    if line.startswith("#") or not line.strip():
                        lines.append(line)
                    else:
                        break
                if any("copyright" in line.lower() for line in lines):
                    headers.append(str(file) + "\n" + "\n".join(lines))
            notice = target / "python" / name / "NOTICE.txt"
            notice.parent.mkdir(parents=True, exist_ok=True)
            author = dist.metadata.get("Author") or dist.metadata.get(
                "Author-email", ""
            )
            license_name = dist.metadata.get("License-Expression") or dist.metadata.get(
                "License", ""
            )
            notice.write_text(
                f"{name} {dist.version}\nAuthor: {author}\nLicense: {license_name}\n"
                + "\n".join(headers),
                encoding="utf-8",
            )
            license_paths.append(str(notice.relative_to(target)))
            declarations = (
                " ".join(dist.metadata.get_all("Classifier", []))
                + str(dist.metadata.get("License", ""))
                + str(dist.metadata.get("License-Expression", ""))
            )
            if "apache" in declarations.lower():
                license_paths.append("Apache-2.0.txt")
            elif name.lower() != "nvidia-ml-py":
                raise RuntimeError(
                    f"Missing license text for {name}; "
                    "add its upstream license before distribution"
                )
        packages.append(
            {
                "name": name,
                "version": dist.version,
                "license": dist.metadata.get("License-Expression")
                or dist.metadata.get("License", "See upstream metadata"),
                "license_files": license_paths,
                "project_urls": dist.metadata.get_all("Project-URL", []),
            }
        )
    (target / "packages.json").write_text(
        json.dumps(packages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # python-build-standalone includes notices for its embedded native libraries.
    for prefix in {Path(sys.base_prefix), Path(sysconfig.get_path("stdlib"))}:
        for source in prefix.glob("*LICENSE*"):
            if source.is_file():
                shutil.copyfile(source, target / f"CPython-{source.name}")
        if (prefix / "licenses").is_dir():
            shutil.copytree(
                prefix / "licenses", target / "cpython-libraries", dirs_exist_ok=True
            )


def verify_expanded_backend(executable: Path) -> None:
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(str(executable))
    if any(entry[3] for entry in archive.toc.values()):
        raise ValueError("backend executable contains compressed bootstrap entries")
    for name, entry in archive.toc.items():
        if entry[4] == "z" and archive.open_embedded_archive(name).toc:
            raise ValueError("backend contains compressed PYZ modules")
    for path in RESOURCES.rglob("*.zip"):
        with zipfile.ZipFile(path) as zipped:
            if any(
                item.compress_type != zipfile.ZIP_STORED for item in zipped.infolist()
            ):
                raise ValueError(f"compressed runtime archive: {path}")
    for path in (RESOURCES / "data/hanlp").rglob("*.pt"):
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as zipped:
                if any(
                    item.compress_type != zipfile.ZIP_STORED
                    for item in zipped.infolist()
                ):
                    raise ValueError(f"compressed runtime model: {path}")


def build_resources(architecture: str) -> None:
    prepare_models()
    defaults = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    defaults["analysis"].update(
        hanlp_home="data/hanlp", dictionary_path="", stopwords_path=""
    )
    defaults["wordcloud"]["font_path"] = ""
    defaults["runtime"] = {"log_level": "WARNING"}
    (RESOURCES / "config.json").write_text(
        json.dumps(defaults, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--distpath",
            str(BUILD / "frozen"),
            "--workpath",
            str(BUILD / "pyinstaller"),
            str(ROOT / "packaging/backend.spec"),
        ],
        cwd=ROOT,
        check=True,
        env={
            **os.environ,
            "WORDKEEP_BUILD_RESOURCES": str(RESOURCES),
            "PYINSTALLER_CONFIG_DIR": str(BUILD / "pyinstaller-cache"),
        },
    )
    shutil.copytree(
        BUILD / "frozen/wordkeep-backend", RESOURCES, dirs_exist_ok=True, symlinks=True
    )
    # Precompile source files retained for inspect and JIT.
    if not compileall.compile_dir(
        RESOURCES / "_internal",
        quiet=1,
        invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,
    ):
        raise RuntimeError("failed to precompile runtime modules")
    executable = RESOURCES / (
        "wordkeep-backend.exe" if os.name == "nt" else "wordkeep-backend"
    )
    verify_expanded_backend(executable)
    collect_licenses()
    (RESOURCES / "build-manifest.json").write_text(
        json.dumps(
            {
                "platform": sys.platform,
                "arch": architecture,
                "python": platform.python_version(),
                "mode": "onedir",
                "runtime_compression": False,
                "pyinstaller": importlib.metadata.version("pyinstaller"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def architecture() -> str:
    value = {
        "arm64": "arm64",
        "aarch64": "arm64",
        "amd64": "x64",
        "x86_64": "x64",
    }.get(platform.machine().lower())
    if (sys.platform, value) not in {("darwin", "arm64"), ("win32", "x64")}:
        raise RuntimeError("Build on macOS arm64 or Windows x64")
    return value


def fingerprint() -> str:
    """Identify source, configuration, toolchain and pinned model inputs."""
    files = [
        ROOT / name
        for name in (
            "pyproject.toml",
            "uv.lock",
            ".python-version",
            "config.json",
            "LICENSE",
            "data/model-manifest.json",
            "data/download_models.py",
        )
    ]
    for directory in ("src", "packaging"):
        files.extend(
            path
            for path in (ROOT / directory).rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.name != ".DS_Store"
            and path.suffix != ".pyc"
        )
    state = hashlib.sha256()
    state.update(f"{sys.platform}:{platform.machine().lower()}".encode())
    for path in sorted(files):
        state.update(path.relative_to(ROOT).as_posix().encode())
        state.update(bytes.fromhex(digest(path)))
    return state.hexdigest()


def reusable(signature: str) -> bool:
    try:
        stamp = json.loads(
            (RESOURCES / "build-manifest.json").read_text(encoding="utf-8")
        )
        files = stamp["files"]
        return (
            stamp["fingerprint"] == signature
            and bool(files)
            and all(
                checked_path(RESOURCES, name).is_file()
                and checked_path(RESOURCES, name).stat().st_size == size
                for name, size in files.items()
            )
        )
    except OSError, ValueError, KeyError, TypeError, AttributeError:
        return False


def build_environment() -> Path:
    """Synchronize only runtime and packaging dependencies into build/venv."""
    uv = shutil.which("uv")
    if not uv:
        raise RuntimeError("Install uv before building")
    environment = os.environ.copy()
    environment.pop("VIRTUAL_ENV", None)
    environment.update(
        UV_PROJECT_ENVIRONMENT=str(BUILD / "venv"),
        UV_CACHE_DIR=str(BUILD / "uv-cache"),
    )
    subprocess.run(
        [
            uv,
            "sync",
            "--project",
            str(ROOT),
            "--locked",
            "--managed-python",
            "--python",
            (ROOT / ".python-version").read_text(encoding="utf-8").strip(),
            "--no-default-groups",
            "--group",
            "packaging",
            "--no-editable",
        ],
        cwd=ROOT,
        env=environment,
        check=True,
    )
    return BUILD / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def recover_release() -> None:
    previous = DIST / "wordkeep-backend.previous"
    if not RESOURCES.exists() and previous.exists():
        previous.replace(RESOURCES)


def publish(arch: str, signature: str) -> None:
    global RESOURCES
    BUILD.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(parents=True, exist_ok=True)
    recover_release()
    destination = RESOURCES
    staging = DIST / "wordkeep-backend.partial"
    previous = DIST / "wordkeep-backend.previous"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir()
    RESOURCES = staging
    try:
        build_resources(arch)
        manifest_path = staging / "build-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update(
            fingerprint=signature,
            files={
                path.relative_to(staging).as_posix(): path.stat().st_size
                for path in sorted(staging.rglob("*"))
                if path.is_file() and path != manifest_path
            },
        )
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        shutil.rmtree(previous, ignore_errors=True)
        if destination.exists():
            destination.replace(previous)
        try:
            staging.replace(destination)
        except OSError:
            if previous.exists():
                previous.replace(destination)
            raise
        shutil.rmtree(previous, ignore_errors=True)
    finally:
        RESOURCES = destination
    print(f"Prepared {RESOURCES}")


def clean(*, all_outputs: bool = False) -> None:
    recover_release()
    for directory in ("src", "tests", "packaging", "data"):
        for cache in (ROOT / directory).rglob("__pycache__"):
            shutil.rmtree(cache)
    for name in (".pytest_cache", ".ruff_cache", ".mypy_cache", "htmlcov"):
        shutil.rmtree(ROOT / name, ignore_errors=True)
    (ROOT / ".coverage").unlink(missing_ok=True)
    if all_outputs:
        shutil.rmtree(BUILD, ignore_errors=True)
        shutil.rmtree(DIST, ignore_errors=True)
    else:
        for name in (
            "pyinstaller",
            "pyinstaller-cache",
            "frozen",
            "downloads",
            "uv-cache",
        ):
            shutil.rmtree(BUILD / name, ignore_errors=True)
        for name in ("wordkeep-backend.partial", "wordkeep-backend.previous"):
            shutil.rmtree(DIST / name, ignore_errors=True)
    print("Removed build outputs and caches" if all_outputs else "Removed caches")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Build the standalone Wordkeep backend"
    )
    commands = parser.add_subparsers(dest="command")
    build = commands.add_parser("build", help="Build or reuse the standalone backend")
    build.add_argument("--force", action="store_true", help="Force a clean rebuild")
    build.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    cleanup = commands.add_parser("clean", help="Remove project caches")
    cleanup.add_argument(
        "--all", action="store_true", help="Also remove build/venv and dist"
    )
    args = parser.parse_args(argv)
    if args.command == "clean":
        clean(all_outputs=args.all)
        return
    arch = architecture()
    recover_release()
    signature = fingerprint()
    force = getattr(args, "force", False)
    if not force and reusable(signature):
        print(f"Reusing {RESOURCES}")
        return
    if not getattr(args, "worker", False):
        python = build_environment()
        command = [str(python), str(Path(__file__).resolve()), "build", "--worker"]
        if force:
            command.append("--force")
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        environment["PYTHONNOUSERSITE"] = "1"
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
        return
    if Path(sys.prefix).resolve() != (BUILD / "venv").resolve():
        raise RuntimeError("Packaging requires the isolated build/venv environment")
    if sys.version_info[:2] != (3, 14):
        raise RuntimeError("Release builds require CPython 3.14")
    if force:
        shutil.rmtree(BUILD / "pyinstaller", ignore_errors=True)
        shutil.rmtree(BUILD / "frozen", ignore_errors=True)
    publish(arch, signature)


if __name__ == "__main__":
    main()
