import json
from datetime import datetime, timezone
from pathlib import Path
from .config import Settings
from .embeddings import create_embeddings
from .ingestion.discovery import discover, document_id
from .ingestion.loaders import load_pdf, load_pptx
from .ingestion.chunker import chunk_pages
from .vectorstore import ChromaVectorStore


def run(settings: Settings | None = None) -> dict:
    settings = settings or Settings.from_env()
    supported, unsupported = discover(settings.root_dir)
    settings.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(settings.manifest_path.read_text(encoding="utf-8")) if settings.manifest_path.exists() else {}
    store = ChromaVectorStore(settings.chroma_dir, create_embeddings(settings.embedding_provider))
    summary = {"files_found": len(supported) + len(unsupported), "supported_files": len(supported), "unsupported_files": len(unsupported), "pdf_count": 0, "pptx_count": 0, "pages": 0, "slides": 0, "ocr_pages": 0, "chunks": 0, "embeddings": 0, "skipped": 0, "failed": []}
    for item in supported:
        did = document_id(item)
        old = manifest.get(did)
        if old and old.get("file_hash") == item.file_hash:
            summary["skipped"] += 1
            continue
        try:
            pages, ocr_count = load_pdf(item.path) if item.file_type == "pdf" else load_pptx(item.path)
            chunks = chunk_pages(pages, settings.chunk_size, settings.chunk_overlap)
            records = []
            for index, chunk in enumerate(chunks, 1):
                cid = f"{did}_{index:05d}"
                locations = ",".join(map(str, chunk.locations))
                records.append({"id": cid, "text": chunk.text, "metadata": {"document_id": did, "chunk_id": cid, "filename": item.path.name, "file_type": item.file_type, "relative_path": item.relative_path, "unit": item.unit, "folder_path": item.folder_path, "source_path": str(item.path), "locations": locations, "location": f"{'pages' if item.file_type == 'pdf' else 'slides'} {locations}"}})
            store.replace_document(did, records)
            manifest[did] = {"document_id": did, "filename": item.path.name, "file_type": item.file_type, "relative_path": item.relative_path, "source_path": str(item.path), "file_hash": item.file_hash, "unit": item.unit, "folder_path": item.folder_path, "page_count": len(pages) if item.file_type == "pdf" else None, "slide_count": len(pages) if item.file_type == "pptx" else None, "ocr_count": ocr_count, "chunk_count": len(records), "processed_at": datetime.now(timezone.utc).isoformat()}
            summary["pdf_count"] += item.file_type == "pdf"
            summary["pptx_count"] += item.file_type == "pptx"
            summary["pages"] += len(pages) if item.file_type == "pdf" else 0
            summary["slides"] += len(pages) if item.file_type == "pptx" else 0
            summary["ocr_pages"] += ocr_count
            summary["chunks"] += len(records)
            summary["embeddings"] += len(records)
        except Exception as exc:
            summary["failed"].append({"path": item.relative_path, "reason": str(exc)})
    settings.manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return summary
