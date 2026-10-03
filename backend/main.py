import json
import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .app.config import Settings
from .app.embeddings import create_embeddings
from .app.vectorstore import ChromaVectorStore
from .app.retrieval import Retriever
from .app.llm import answer_with_context

app = FastAPI(title="SAM7 AI Document Assistant")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
settings = Settings.from_env()
retriever = Retriever(ChromaVectorStore(settings.chroma_dir, create_embeddings(settings.embedding_provider)))


class Message(BaseModel):
    role: str
    content: str


class Query(BaseModel):
    query: str
    top_k: int | None = None
    history: list[Message] | None = None


def _manifest() -> dict[str, dict]:
    if not settings.manifest_path.exists():
        return {}
    return json.loads(settings.manifest_path.read_text(encoding="utf-8"))


def _public_document(document: dict) -> dict:
    result = {
        key: document[key]
        for key in (
            "document_id", "filename", "file_type", "relative_path", "unit",
            "folder_path", "page_count", "slide_count", "chunk_count", "processed_at",
        )
        if key in document
    }
    encoded_id = quote(document.get("document_id", ""))
    result["view_url"] = f"/documents/{encoded_id}/file"
    result["download_url"] = result["view_url"]
    return result


def _document_file(document_id: str) -> tuple[dict, Path]:
    document = _manifest().get(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    source = Path(document["source_path"]).resolve()
    root = settings.root_dir.resolve()
    if source.parent != root and root not in source.parents:
        raise HTTPException(status_code=403, detail="Document is outside the configured library")
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Original document is no longer available")
    return document, source


@app.get("/health")
def health():
    return {
        "status": "ok",
        "indexed_chunks": retriever.store.collection.count(),
        "total_documents": len(_manifest()),
        "llm_provider": settings.llm_provider,
    }


@app.post("/ask")
def ask(request: Query):
    chunks = retriever.chunks(request.query, request.top_k or settings.top_k)
    seen_docs = {}
    for item in chunks:
        meta = dict(item["metadata"])
        meta.pop("source_path", None)
        doc_id = meta.get("document_id", "")
        encoded_id = quote(doc_id)
        
        locs = meta.get("locations", "")
        first_num = next((p.strip() for p in locs.split(",") if p.strip().isdigit()), "1")
        is_pdf = meta.get("file_type") == "pdf"
        
        if doc_id not in seen_docs:
            meta["view_url"] = f"/documents/{encoded_id}/file{'#page=' + first_num if is_pdf else ''}"
            meta["download_url"] = f"/documents/{encoded_id}/file"
            meta["preview"] = item.get("text", "")[:220].strip()
            seen_docs[doc_id] = meta
        else:
            existing_locs = seen_docs[doc_id].get("locations", "")
            all_loc_nums = set(filter(None, [l.strip() for l in (existing_locs + "," + locs).split(",")]))
            sorted_locs = sorted(int(x) for x in all_loc_nums if x.isdigit())
            loc_label = "pages" if is_pdf else "slides"
            seen_docs[doc_id]["locations"] = f"{', '.join(map(str, sorted_locs[:8]))}"
            seen_docs[doc_id]["location"] = f"{loc_label} {', '.join(map(str, sorted_locs[:8]))}"

    sources = list(seen_docs.values())

    history_dicts = [{"role": m.role, "content": m.content} for m in request.history] if request.history else None
    try:
        answer = answer_with_context(request.query, chunks, history_dicts)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"answer": answer, "sources": sources, "query": request.query}


@app.post("/find")
def find(request: Query):
    results = retriever.find_documents(request.query, request.top_k or 15)
    manifest = _manifest()
    for result in results:
        doc_id = result.get("document_id", "")
        document = manifest.get(doc_id)
        encoded_id = quote(doc_id)
        first_p = result.get("first_page", 1)
        is_pdf = result.get("file_type") == "pdf"

        result["view_url"] = f"/documents/{encoded_id}/file{'#page=' + str(first_p) if is_pdf else ''}"
        result["download_url"] = f"/documents/{encoded_id}/file"
        if document:
            result.update({
                "page_count": document.get("page_count"),
                "slide_count": document.get("slide_count"),
                "folder_path": document.get("folder_path"),
            })
    return {"documents": results, "total": len(results), "query": request.query}


@app.get("/documents")
def documents():
    manifest = _manifest()
    return {
        "documents": [_public_document(doc) for doc in manifest.values()],
        "total": len(manifest)
    }


@app.get("/documents/search")
def search_documents(q: str = ""):
    needle = q.strip()
    manifest = _manifest()
    if not needle:
        return {
            "documents": [_public_document(doc) for doc in manifest.values()],
            "total": len(manifest)
        }

    # 1. Search inside contents using Retriever
    content_matches = retriever.find_documents(needle, top_k=25)
    matched_ids = set()
    results = []

    for item in content_matches:
        doc_id = item["document_id"]
        matched_ids.add(doc_id)
        doc = manifest.get(doc_id, {})
        encoded_id = quote(doc_id)
        first_p = item.get("first_page", 1)
        is_pdf = item.get("file_type") == "pdf"
        
        result_item = _public_document(doc) if doc else item
        result_item.update({
            "relevance": item.get("relevance", 0.0),
            "match_count": item.get("match_count", 1),
            "snippets": item.get("snippets", []),
            "locations": item.get("locations", ""),
            "pages": item.get("pages"),
            "slides": item.get("slides"),
            "view_url": f"/documents/{encoded_id}/file{'#page=' + str(first_p) if is_pdf else ''}",
            "download_url": f"/documents/{encoded_id}/file",
        })
        results.append(result_item)

    # 2. Check metadata match in manifest for any missed docs
    needle_lower = needle.casefold()
    for doc_id, doc in manifest.items():
        if doc_id in matched_ids:
            continue
        haystack = " ".join(
            str(doc.get(key, "")) for key in ("filename", "relative_path", "unit", "folder_path")
        ).casefold()
        if needle_lower in haystack:
            matched_ids.add(doc_id)
            pub = _public_document(doc)
            pub["relevance"] = 0.5
            pub["match_count"] = 1
            pub["snippets"] = [f"Matched document metadata: {doc.get('relative_path', '')}"]
            results.append(pub)

    return {"documents": results, "total": len(results), "query": needle}


@app.get("/documents/{document_id}/file")
def document_file(document_id: str):
    document, source = _document_file(document_id)
    media_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
    disposition = "inline" if document.get("file_type") == "pdf" else "attachment"
    return FileResponse(
        source,
        media_type=media_type,
        filename=document["filename"],
        content_disposition_type=disposition,
    )
