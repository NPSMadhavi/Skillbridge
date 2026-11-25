# SkillBridge Ubuntu Document Processing Service

Centralized document extraction, OCR, structure-aware chunking, 768-d `BAAI/bge-m3` embeddings, and grounded `qwen3.5:9b` curriculum generation for the Ubuntu 26.04.1 LTS RTX 3090 AI server.

## Supported Formats
`pdf`, `doc`, `docx`, `ppt`, `pptx`, `xls`, `xlsx`, `txt`, `csv`, `rtf`, `html`, `png`, `jpg`, `jpeg`

## Endpoints
- `POST /api/v1/documents/process` (`X-API-Key`, multipart `file`, optional `title`, `description`, `generate_curriculum`) -> returns `{ job_id, status, stage, progress, file_hash }`
- `GET /api/v1/documents/jobs/{job_id}` -> returns live job status/progress
- `GET /api/v1/documents/jobs/{job_id}/result` -> returns `{ document, chunks, embeddings, embedding_dimensions: 768, curriculum }`

## Ubuntu Deployment
```bash
sudo apt-get update && sudo apt-get install -y libreoffice tesseract-ocr poppler-utils
cd ubuntu-document-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export SKILLBRIDGE_API_KEY="<your-gateway-key>"
export EMBEDDING_DIM=768
export OLLAMA_MODEL="qwen3.5:9b"
uvicorn app:app --host 0.0.0.0 --port 8094 --workers 1
```
Then proxy `/api/v1/documents/process` and `/api/v1/documents/jobs/` in your Ubuntu Nginx/Central AI Gateway to `http://127.0.0.1:8094` (or mount `documents_router` directly in your FastAPI Gateway).
