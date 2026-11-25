import os

ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "ppt", "pptx",
    "xls", "xlsx", "txt", "csv", "rtf",
    "html", "htm", "png", "jpg", "jpeg",
}

ALLOWED_MIME_PREFIXES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.",
    "application/vnd.ms-powerpoint",
    "application/vnd.ms-excel",
    "text/",
    "application/rtf",
    "application/csv",
    "image/png",
    "image/jpeg",
    "application/octet-stream",
)

SKILLBRIDGE_API_KEY = os.getenv("SKILLBRIDGE_API_KEY", "").strip()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:9b")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "768"))
MAX_FILE_SIZE_BYTES = int(os.getenv("MAX_FILE_SIZE_MB", "100")) * 1024 * 1024
WORKER_CONCURRENCY = max(1, int(os.getenv("WORKER_CONCURRENCY", "2")))
JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "3600"))
TEMP_DIR = os.getenv("DOC_TEMP_DIR", "/tmp/skillbridge_docs")
