from dataclasses import dataclass
from pathlib import Path
import hashlib

SUPPORTED = {".pdf": "pdf", ".pptx": "pptx"}


@dataclass(frozen=True)
class DiscoveredFile:
    path: Path
    file_type: str
    relative_path: str
    unit: str
    folder_path: str
    file_hash: str


def discover(root: Path) -> tuple[list[DiscoveredFile], list[Path]]:
    supported, unsupported = [], []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        kind = SUPPORTED.get(path.suffix.lower())
        if not kind:
            unsupported.append(path)
            continue
        relative = path.relative_to(root)
        parts = relative.parts
        unit = parts[0] if len(parts) > 1 else ""
        folder = "/".join(parts[1:-1])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        supported.append(DiscoveredFile(path, kind, relative.as_posix(), unit, folder, digest))
    return supported, unsupported


def document_id(item: DiscoveredFile) -> str:
    return "doc_" + hashlib.sha256(item.relative_path.lower().encode()).hexdigest()[:20]
