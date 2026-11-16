"""Download and verify the model resources listed beside this script."""

import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def checked_path(root: Path, relative: str) -> Path:
    target = root / relative
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"resource escapes its directory: {relative}")
    return target


def prepare_models(
    manifest_path: Path,
    destination: Path,
    downloads: Path,
    *,
    source: Path | None = None,
) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for resource in manifest:
        files = resource["files"]

        def valid(directory: Path, entries: dict[str, str]) -> bool:
            return all(
                (path := checked_path(directory, name)).is_file()
                and digest(path) == sha
                for name, sha in entries.items()
            )

        if valid(destination, files):
            print(f"Verified {resource['resource']}", flush=True)
            continue
        if source is not None and valid(source, files):
            for name in files:
                target = checked_path(destination, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(checked_path(source, name), target)
            continue
        downloads.mkdir(parents=True, exist_ok=True)
        archive = downloads / Path(resource["resource"]).name
        if not archive.is_file() or digest(archive) != resource["sha256"]:
            print(f"Downloading {resource['url']}", flush=True)
            partial = archive.with_suffix(".partial")
            try:
                with (
                    urllib.request.urlopen(
                        urllib.request.Request(
                            resource["url"],
                            headers={"User-Agent": "Wordkeep-build/0.1"},
                        ),
                        timeout=120,
                    ) as response,
                    partial.open("wb") as output,
                ):
                    shutil.copyfileobj(response, output)
                if digest(partial) != resource["sha256"]:
                    raise ValueError(
                        f"download checksum failed: {resource['resource']}"
                    )
                partial.replace(archive)
            finally:
                partial.unlink(missing_ok=True)
        # Publish each resource only after all of its files pass verification.
        with tempfile.TemporaryDirectory(dir=downloads, prefix="extract-") as temporary:
            staging = Path(temporary)
            with zipfile.ZipFile(archive) as compressed:
                for name, sha in files.items():
                    suffix = name.split("/", 1)[-1]
                    candidates = [name, suffix]
                    if "/" in suffix:
                        candidates.append(suffix.split("/", 1)[1])
                    entry = next(
                        (p for p in candidates if p in compressed.namelist()), None
                    )
                    if entry is None:
                        raise ValueError(f"missing archive entry: {name}")
                    target = checked_path(staging, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with compressed.open(entry) as content, target.open("wb") as output:
                        shutil.copyfileobj(content, output)
                    if digest(target) != sha:
                        raise ValueError(f"model file checksum failed: {name}")
            for name in files:
                target = checked_path(destination, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                checked_path(staging, name).replace(target)
        print(f"Ready {resource['resource']}", flush=True)


def main() -> None:
    data = Path(__file__).resolve().parent
    prepare_models(
        data / "model-manifest.json", data / "hanlp", data.parent / "build/downloads"
    )
    print(f"Models ready at {data / 'hanlp'}")


if __name__ == "__main__":
    main()
