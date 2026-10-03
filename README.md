# SAM7 AI Document Assistant

This prototype recursively indexes PDF and PPTX files under `SEM 7/`, preserving unit, nested folder, page/slide, chunk, and source-path metadata. ChromaDB is persistent in `data/chroma/`; `data/manifest.json` makes ingestion hash-based and idempotent.

## Setup

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe scripts\ingest.py
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

Use `POST /ask` for grounded retrieval context and `POST /find` for metadata-only document discovery. `LLM_PROVIDER=none` is an offline mode that returns retrieved context; connect a provider adapter in `backend/app/llm.py` before using hosted generation. The local hash embedder is deterministic and dependency-free, intended as a reliable baseline; production deployments should add Gemini, OpenAI, or a local semantic model implementing the same interface.

Supported formats are PDF and PPTX. Unsupported files are logged in the scan result and do not stop ingestion. OCR is attempted only for PDF pages with very little extracted text and requires a local Tesseract installation.
