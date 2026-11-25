import hmac
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from config import ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES, SKILLBRIDGE_API_KEY
from job_manager import job_manager

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


def verify_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")) -> None:
    if not SKILLBRIDGE_API_KEY:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key.strip(), SKILLBRIDGE_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def validate_upload(file: UploadFile, content: bytes) -> str:
    filename = file.filename or "document"
    ext = Path(filename).suffix.lstrip(".").lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file format '.{ext}'. Supported: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.",
        )
    return filename


@router.post("/process", status_code=202, dependencies=[Depends(verify_api_key)])
async def process_document(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    description: str = Form(default=""),
    generate_curriculum: bool = Form(default=True),
):
    content = await file.read()
    filename = validate_upload(file, content)
    job = job_manager.submit(
        file_bytes=content,
        filename=filename,
        course_title=title,
        course_description=description,
        generate_curriculum=generate_curriculum,
    )
    return {
        "job_id": job.job_id,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "file_hash": job.file_hash,
    }


@router.get("/jobs/{job_id}", dependencies=[Depends(verify_api_key)])
async def get_job_status(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Document processing job not found.")
    return {
        "job_id": job.job_id,
        "filename": job.filename,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


@router.get("/jobs/{job_id}/result", dependencies=[Depends(verify_api_key)])
async def get_job_result(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Document processing job not found.")
    if job.status == "failed":
        raise HTTPException(status_code=422, detail=job.error or "Document processing failed.")
    if job.status != "completed" or not job.result:
        raise HTTPException(status_code=409, detail=f"Job is still {job.status} ({job.stage}).")
    return job.result
