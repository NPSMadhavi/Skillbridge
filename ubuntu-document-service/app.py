from fastapi import FastAPI
from router import router as documents_router
from config import EMBEDDING_DIM, EMBEDDING_MODEL, OLLAMA_MODEL, WORKER_CONCURRENCY

app = FastAPI(title="SkillBridge Ubuntu Document Processing Service", version="1.0.0")
app.include_router(documents_router)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "SkillBridge Document Processor",
        "ollama_model": OLLAMA_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
        "worker_concurrency": WORKER_CONCURRENCY,
    }
