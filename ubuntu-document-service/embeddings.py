import threading
from typing import List

import numpy as np

from config import EMBEDDING_DIM, EMBEDDING_MODEL

_model_lock = threading.Lock()
_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        with _model_lock:
            if _embedder is None:
                from sentence_transformers import SentenceTransformer

                _embedder = SentenceTransformer(EMBEDDING_MODEL)
    return _embedder


def _align_dimension(vec: np.ndarray, target_dim: int = EMBEDDING_DIM) -> List[float]:
    """
    Aligns embedding vector to target_dim (768 for SkillBridge pgvector(768))
    and L2-normalizes so cosine similarity remains accurate.
    """
    if vec.shape[0] > target_dim:
        vec = vec[:target_dim]
    elif vec.shape[0] < target_dim:
        pad = np.zeros(target_dim - vec.shape[0], dtype=vec.dtype)
        vec = np.concatenate([vec, pad])
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return [round(float(x), 6) for x in vec]


def generate_embeddings_batch(texts: List[str], batch_size: int = 16, target_dim: int = EMBEDDING_DIM) -> List[List[float]]:
    if not texts:
        return []
    embedder = _get_embedder()
    cleaned = [t[:8000] if isinstance(t, str) and t.strip() else " " for t in texts]
    raw_vectors = embedder.encode(cleaned, batch_size=batch_size, normalize_embeddings=True, show_progress_bar=False)
    return [_align_dimension(np.asarray(v, dtype=np.float32), target_dim) for v in raw_vectors]
