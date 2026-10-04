# SAM7 AI Document Assistant

A local, retrieval-augmented generation (RAG) application for searching and asking questions about semester study material. The project recursively scans PDF and PowerPoint files, extracts their content, preserves document/page/slide metadata, stores embeddings in a persistent ChromaDB vector store, and exposes a FastAPI backend with a Next.js frontend.

The assistant is designed to answer questions from the indexed course documents while showing the source filename and page or slide locations used for each result.

> **Repository:** `mahirfadte3161/kiwi`  
> **Primary stack:** Python, FastAPI, ChromaDB, Next.js, React, TypeScript  
> **Supported source files:** `.pdf` and `.pptx`

## What the project does

1. Recursively scans the configured document library, by default `SEM 7/`.
2. Detects supported PDF and PPTX files and records unsupported files without stopping ingestion.
3. Extracts text from PDF pages and PowerPoint slides.
4. Attempts OCR for PDF pages that contain very little extractable text. OCR requires a local Tesseract installation.
5. Splits extracted content into overlapping word-based chunks while preserving page or slide numbers.
6. Creates embeddings using the configured embedding provider.
7. Stores chunks and metadata in a persistent ChromaDB collection under `data/chroma/`.
8. Maintains a JSON manifest at `data/manifest.json` with document metadata, hashes, source paths, and processing information.
9. Uses hybrid retrieval:
   - keyword and phrase matching across indexed chunks;
   - metadata matching against filenames, units, and paths;
   - vector similarity search as a semantic fallback.
10. Sends retrieved context to Gemini or OpenAI for generated answers, or displays retrieved excerpts in offline mode.
11. Provides document discovery, content search, source links, document previews, and downloads through the web interface and API.

## Main features

### Document ingestion

- Recursive discovery of files below the configured root directory.
- PDF and PPTX support.
- Stable document IDs based on relative paths.
- SHA-256 file hashes for change detection.
- Unchanged documents are skipped on later ingestion runs.
- Changed documents replace their previous chunks in the vector store.
- Unsupported files are reported in the ingestion summary.
- Page count, slide count, folder path, unit, chunk count, and processing time are preserved as metadata.

### Retrieval and search

- Hybrid keyword plus vector retrieval.
- Phrase matching and meaningful-term extraction with common question words removed.
- Search results grouped by document rather than showing only individual chunks.
- Relevance scores, match counts, snippets, and matching pages or slides.
- Separate document discovery endpoint for finding documents related to a topic or subtopic.
- Metadata search across filenames, relative paths, units, and folders.
- Source links point to the original document and, for PDFs, can open at the relevant page.

### Question answering

- Questions are answered only from retrieved document context.
- Gemini and OpenAI providers are supported.
- Conversation history can be supplied to the `/ask` endpoint.
- The system prompt asks the model not to invent facts and to include concise source references.
- Offline mode returns formatted excerpts from the documents without requiring an LLM API key.
- If a configured LLM provider is unavailable, the backend gracefully falls back to direct document excerpts.
- Gemini requests include retries and fallback model attempts for temporary rate-limit or availability errors.

### Web application

The frontend is a Next.js and React application written in TypeScript. It provides an interface for:

- asking questions about the indexed semester material;
- viewing retrieved answers and source references;
- searching for documents and subtopics;
- browsing the indexed document library;
- opening PDF sources and downloading original files;
- displaying page, slide, unit, folder, and relevance metadata.

The frontend expects the backend API at `http://localhost:8000` during local development.

## Architecture

```text
SEM 7/
  ├── Unit 1/
  │   ├── notes.pdf
  │   └── lecture.pptx
  └── Unit 2/
      └── revision.pdf
          |
          v
  Discovery and file hashing
          |
          v
  PDF/PPTX loaders and optional OCR
          |
          v
  Page/slide-aware chunking
          |
          v
  Embeddings + ChromaDB
          |
          v
  Hybrid keyword/vector retrieval
          |
          +----------------------+
          |                      |
          v                      v
       /ask                   /find
          |                      |
          v                      v
  Gemini/OpenAI or offline   Document discovery
          |
          v
  Next.js frontend
```

### Backend modules

- `backend/main.py` — FastAPI application, CORS configuration, request models, API routes, manifest access, and original-file serving.
- `backend/app/config.py` — environment-based application settings.
- `backend/app/ingest.py` — complete ingestion pipeline and incremental processing.
- `backend/app/ingestion/discovery.py` — recursive file discovery, supported-format detection, file hashing, and stable IDs.
- `backend/app/ingestion/loaders.py` — PDF and PPTX text extraction and OCR integration.
- `backend/app/ingestion/chunker.py` — overlapping chunks with page/slide location preservation.
- `backend/app/embeddings.py` — embedding provider creation.
- `backend/app/vectorstore.py` — persistent ChromaDB storage and document replacement.
- `backend/app/retrieval.py` — hybrid retrieval, document grouping, snippets, relevance, and metadata search.
- `backend/app/llm.py` — prompt construction, Gemini/OpenAI calls, retries, and offline fallback formatting.
- `scripts/ingest.py` — command-line entry point for indexing the document library.
- `tests/test_core.py` — tests for discovery, stable IDs, chunk locations, and content search.

## API reference

The backend runs as a FastAPI application and exposes automatic OpenAPI documentation at `/docs` when the server is running.

### `GET /health`

Returns service status and index information:

- health status;
- indexed chunk count;
- total indexed documents;
- active LLM provider.

### `POST /ask`

Retrieves relevant chunks and generates an answer.

Example request:

```json
{
  "query": "Explain backpropagation",
  "top_k": 6,
  "history": [
    {"role": "user", "content": "What is gradient descent?"},
    {"role": "assistant", "content": "..."}
  ]
}
```

Example response shape:

```json
{
  "answer": "...",
  "sources": [
    {
      "document_id": "doc_...",
      "filename": "notes.pdf",
      "file_type": "pdf",
      "locations": "5, 6",
      "view_url": "/documents/doc_.../file#page=5",
      "download_url": "/documents/doc_.../file"
    }
  ],
  "query": "Explain backpropagation"
}
```

### `POST /find`

Finds documents related to a query and returns document-level matches, snippets, relevance, and page or slide locations.

Example request:

```json
{
  "query": "neural network optimization",
  "top_k": 15
}
```

### `GET /documents`

Lists all indexed documents and their metadata.

### `GET /documents/search?q=<query>`

Searches document contents and metadata. With an empty query, it returns the complete document library.

### `GET /documents/{document_id}/file`

Serves the original source file recorded in the manifest. PDFs are displayed inline when possible; PowerPoint files are returned as downloadable attachments. The endpoint does not reconstruct documents from vector chunks.

## Requirements

- Python 3.10 or newer recommended.
- Node.js and npm for the frontend.
- A local Tesseract installation if OCR is required.
- Optional API key for Gemini or OpenAI generated answers.
- The source documents to be indexed in the configured document directory.

### Python dependencies

The backend dependencies are listed in `requirements.txt`:

- ChromaDB
- FastAPI
- Uvicorn
- PyMuPDF
- python-pptx
- Pydantic
- Pillow
- pytesseract

### Frontend dependencies

The frontend uses:

- Next.js
- React
- React DOM
- TypeScript

## Installation and setup

Clone the repository and enter the project directory:

```bash
git clone https://github.com/mahirfadte3161/kiwi.git
cd kiwi
```

### 1. Set up the Python backend

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Place PDF and PPTX files inside `SEM 7/`, or change `SAM7_ROOT` in `.env` to another document directory.

### 2. Configure the application

The default `.env.example` contains:

```dotenv
SAM7_ROOT=./SEM 7
SAM7_DATA_DIR=./data
EMBEDDING_PROVIDER=local
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-flash-lite-latest
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
CHUNK_SIZE=420
CHUNK_OVERLAP=70
TOP_K=6
GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

Important configuration values:

| Variable | Purpose |
| --- | --- |
| `SAM7_ROOT` | Root directory containing PDFs and PPTX files. |
| `SAM7_DATA_DIR` | Directory for ChromaDB data and the document manifest. |
| `EMBEDDING_PROVIDER` | Embedding implementation to use. The default is `local`. |
| `LLM_PROVIDER` | `gemini`, `openai`, or `none` for offline mode. |
| `GEMINI_MODEL` | Gemini model used when `LLM_PROVIDER=gemini`. |
| `OPENAI_MODEL` | OpenAI model used when `LLM_PROVIDER=openai`. |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL. |
| `CHUNK_SIZE` | Number of words per chunk. Default: `420`. |
| `CHUNK_OVERLAP` | Number of overlapping words between chunks. Default: `70`. |
| `TOP_K` | Default number of retrieved chunks. Default: `6`. |
| `GEMINI_API_KEY` | Gemini API key, required for Gemini answers. |
| `OPENAI_API_KEY` | OpenAI API key, required for OpenAI answers. |

For a completely local/offline retrieval experience, set:

```dotenv
LLM_PROVIDER=none
```

Do not commit real API keys to the repository.

### 3. Ingest the documents

```powershell
.\.venv\Scripts\python.exe scripts/ingest.py
```

macOS/Linux:

```bash
.venv/bin/python scripts/ingest.py
```

The ingestion command prints a JSON summary containing discovered files, supported and unsupported files, PDF/page counts, PPTX/slide counts, OCR pages, chunks, embeddings, skipped files, and failures.

The first run creates the persistent index. Subsequent runs only process new or changed files and skip unchanged files.

### 4. Start the backend

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

macOS/Linux:

```bash
.venv/bin/python -m uvicorn backend.main:app --reload
```

The API is available at `http://localhost:8000`. FastAPI documentation is available at `http://localhost:8000/docs`.

### 5. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the development URL shown by Next.js, normally `http://localhost:3000`.

The frontend is configured to communicate with the backend at `http://localhost:8000`.

## Testing

Run the backend test suite from the repository root:

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

macOS/Linux:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

The tests currently cover:

- recursive discovery of supported and unsupported files;
- stable document ID generation;
- preservation of page locations across chunks;
- content-based document search and snippets.

## Data and generated files

The following directories/files are generated locally and should not be committed:

- `data/chroma/` — persistent ChromaDB vector data;
- `data/manifest.json` — indexed document manifest;
- `.venv/` — Python virtual environment;
- local `.env` files containing secrets.

If the index becomes stale, remove the generated `data/` directory and run ingestion again. This will rebuild the manifest and vector store from the source documents.

## Retrieval behavior and limitations

- Only PDF and PPTX files are currently supported for ingestion.
- Unsupported files are reported but are not indexed.
- OCR quality depends on the local Tesseract installation and the quality of scanned pages.
- Generated answers depend on the selected LLM provider, model availability, API quota, and network access.
- Offline mode returns retrieved excerpts rather than synthesized answers.
- The application is intended for grounded study-document assistance; it should not be treated as an authority beyond the indexed source material.
- The original source files must remain inside the configured document root for secure file serving.
- The current CORS configuration allows all origins for local development and should be restricted before production deployment.

## Security notes

- Keep Gemini and OpenAI keys in `.env` or another secret manager.
- Never expose API keys in frontend code.
- Review the permissive CORS configuration before deploying publicly.
- The document file endpoint validates that requested source files are inside the configured library root.
- Consider adding authentication, rate limiting, HTTPS, and stricter origin rules for production use.

## Project status

This is a functional prototype for a semester-focused RAG document assistant. The core ingestion, indexing, retrieval, API, frontend, source navigation, and test flows are implemented. Production deployment would require stronger authentication, observability, deployment configuration, secret management, and additional file-format support.

## Context for AI assistants

If this README is provided to an AI assistant, use the following summary as the authoritative project context:

> This repository is a local RAG-based semester document assistant named **SAM7 AI Document Assistant**. It contains a Python FastAPI backend and a Next.js/React/TypeScript frontend. The backend recursively scans the `SEM 7/` directory for PDF and PPTX files, extracts page/slide text, optionally performs OCR on low-text PDF pages, chunks the text with overlap while preserving locations, creates embeddings, and stores the chunks in persistent ChromaDB under `data/chroma/`. It also maintains `data/manifest.json` for document metadata and incremental file-hash-based ingestion. Retrieval is hybrid: keyword and phrase matching are prioritized, metadata is searched, and vector similarity is used as a semantic fallback. The `/ask` endpoint retrieves relevant chunks and generates grounded answers through Gemini or OpenAI, with `LLM_PROVIDER=none` providing offline excerpts and graceful fallback behavior when an API is unavailable. The `/find` endpoint performs document-level content discovery. Additional endpoints are `/health`, `/documents`, `/documents/search?q=...`, and `/documents/{document_id}/file`. The frontend provides question answering, source references, document search, a document library, PDF viewing, and original-file downloads. Main backend modules are in `backend/app/`, ingestion is started with `scripts/ingest.py`, frontend code is in `frontend/app/`, and backend tests are in `tests/test_core.py`. Important configuration is stored in `.env`, based on `.env.example`; never commit real API keys. The standard development flow is: install Python requirements, create `.env`, place PDF/PPTX files in `SEM 7/`, run `scripts/ingest.py`, start FastAPI with `uvicorn backend.main:app --reload`, then run the frontend with `npm run dev` from `frontend/`.

## License

No license has been specified for this repository yet.
