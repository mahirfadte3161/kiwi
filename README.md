# SAM7 AI Document Assistant

This prototype recursively indexes PDF and PPTX files under `SEM 7/`, preserving unit, nested folder, page/slide, chunk, and source-path metadata. ChromaDB is persistent in `data/chroma/`; `data/manifest.json` makes ingestion hash-based and idempotent.

## Setup

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe scripts\ingest.py
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

Use `POST /ask` for grounded retrieval context and `POST /find` for metadata-only document discovery. `LLM_PROVIDER=none` is an offline mode that returns retrieved context. For generated answers, set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`, or `LLM_PROVIDER=openai` and `OPENAI_API_KEY`; keys remain backend-only. The local hash embedder is deterministic and dependency-free, intended as a reliable baseline; production deployments should add a semantic embedding provider implementing the same interface.

The backend also exposes `GET /documents`, `GET /documents/search?q=...`, and
`GET /documents/{document_id}/file`. The file endpoint serves the original
document recorded in the manifest; it does not reconstruct a PDF from chunks.
The frontend uses it for both source actions and the separate PDF library.

Supported formats are PDF and PPTX. Unsupported files are logged in the scan result and do not stop ingestion. OCR is attempted only for PDF pages with very little extracted text and requires a local Tesseract installation.

## Testing

Run the backend checks with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The first ingestion run processes changed files. Repeating it should report
unchanged documents as skipped. The frontend expects the backend at
`http://localhost:8000`.
