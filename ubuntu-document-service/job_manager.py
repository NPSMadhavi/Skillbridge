import asyncio
import hashlib
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from chunker import build_document_aware_chunks
from config import EMBEDDING_DIM, JOB_TTL_SECONDS, WORKER_CONCURRENCY
from curriculum import build_grounded_curriculum
from embeddings import generate_embeddings_batch
from extractors import extract_universal


@dataclass
class DocumentJob:
    job_id: str
    file_hash: str
    filename: str
    status: str = "queued"  # queued | processing | completed | failed
    stage: str = "queued"
    progress: int = 0
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: Optional[Dict[str, Any]] = None


class DocumentJobManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, DocumentJob] = {}
        self._hash_to_job: Dict[str, str] = {}
        self._semaphore = asyncio.Semaphore(WORKER_CONCURRENCY)

    def _evict_expired(self) -> None:
        now = time.time()
        expired = [jid for jid, job in self._jobs.items() if (now - job.updated_at) > JOB_TTL_SECONDS]
        for jid in expired:
            job = self._jobs.pop(jid, None)
            if job and self._hash_to_job.get(job.file_hash) == jid:
                self._hash_to_job.pop(job.file_hash, None)

    def submit(
        self,
        file_bytes: bytes,
        filename: str,
        course_title: str = "",
        course_description: str = "",
        generate_curriculum: bool = True,
    ) -> DocumentJob:
        self._evict_expired()
        file_hash = hashlib.sha256(file_bytes).hexdigest()

        existing_id = self._hash_to_job.get(file_hash)
        if existing_id and existing_id in self._jobs:
            existing = self._jobs[existing_id]
            if existing.status in ("queued", "processing", "completed"):
                return existing

        job_id = str(uuid.uuid4())
        job = DocumentJob(job_id=job_id, file_hash=file_hash, filename=filename)
        self._jobs[job_id] = job
        self._hash_to_job[file_hash] = job_id

        asyncio.create_task(
            self._run_job(job, file_bytes, filename, course_title, course_description, generate_curriculum)
        )
        return job

    async def _run_job(
        self,
        job: DocumentJob,
        file_bytes: bytes,
        filename: str,
        course_title: str,
        course_description: str,
        generate_curriculum: bool,
    ) -> None:
        async with self._semaphore:
            try:
                job.status = "processing"
                job.stage = "extracting"
                job.progress = 20
                job.updated_at = time.time()

                doc = await extract_universal(file_bytes, filename)
                if not (doc.get("text") or "").strip():
                    raise ValueError("No readable content could be extracted from the uploaded document.")

                job.stage = "chunking"
                job.progress = 50
                job.updated_at = time.time()
                chunks = build_document_aware_chunks(doc)
                if not chunks:
                    raise ValueError("Document extraction succeeded but produced no valid knowledge chunks.")

                curriculum = None
                if generate_curriculum:
                    job.stage = "curriculum"
                    job.progress = 70
                    job.updated_at = time.time()
                    curriculum = await build_grounded_curriculum(doc, chunks, course_title, course_description)

                job.stage = "embeddings"
                job.progress = 85
                job.updated_at = time.time()
                texts = [f"{c.get('concept', '')}\n{c.get('chunkText', '')}" for c in chunks]
                vectors = await asyncio.to_thread(generate_embeddings_batch, texts, 16, EMBEDDING_DIM)

                job.result = {
                    "job_id": job.job_id,
                    "file_hash": job.file_hash,
                    "document": {
                        "fileType": doc.get("fileType"),
                        "fileName": doc.get("fileName"),
                        "text": doc.get("text"),
                        "pages": doc.get("pages") or [],
                        "slides": doc.get("slides") or [],
                    },
                    "chunks": chunks,
                    "embeddings": vectors,
                    "embedding_dimensions": EMBEDDING_DIM,
                    "curriculum": curriculum,
                }
                job.status = "completed"
                job.stage = "completed"
                job.progress = 100
                job.updated_at = time.time()
            except Exception as exc:
                job.status = "failed"
                job.stage = "failed"
                job.error = str(exc)
                job.updated_at = time.time()
            finally:
                # Release raw file bytes reference promptly
                del file_bytes

    def get_job(self, job_id: str) -> Optional[DocumentJob]:
        return self._jobs.get(job_id)


job_manager = DocumentJobManager()
