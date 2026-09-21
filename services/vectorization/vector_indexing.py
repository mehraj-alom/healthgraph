import os
import uuid
from typing import Any, Callable, Dict, List, Optional

from qdrant_client.http.models import FieldCondition, Filter, FilterSelector, MatchAny, MatchValue, PointStruct

from logger import logger
from services.vectorization.chunker import MarkdownChunker
from services.vectorization.embeddings import EmbeddingService
from services.vectorization.qdrant_client import vector_db


# P8.1: namespace for deterministic chunk point IDs. Chunk points are a
# derived index (not history): the same (document, chunk_index) always
# maps to the same point id, so retry / replay / re-index upserts over
# the same ids instead of duplicating evidence. Content changes to the
# same slot likewise overwrite — never accumulate.
_CHUNK_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://healthgraph.local/qdrant/chunks/v1")


def chunk_point_id(document_id: uuid.UUID | str, chunk_index: int) -> str:
    """Deterministic point id for one chunk slot (P8.1, pure)."""
    return str(uuid.uuid5(_CHUNK_ID_NAMESPACE, f"{document_id}:{int(chunk_index)}"))


def live_document_ids(db, patient_id: uuid.UUID) -> set[str]:
    """Ids of the patient's non-DELETED documents (P8.1, PG is truth).

    Retrieval must never surface chunks from deleted documents; the
    chunk payload mirrors status at index time, so PG is re-checked.
    """
    from models.events import Document

    rows = db.query(Document.document_id).filter(
        Document.patient_id == patient_id,
        Document.status != "DELETED",
    ).all()
    return {str(r[0]) for r in rows}


def search_evidence_chunks(
    *,
    client,
    collection_name: str,
    query_vector: List[float],
    patient_id: uuid.UUID | str,
    document_id: uuid.UUID | str | None = None,
    allowed_document_ids: Optional[set[str]] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """Backend evidence search over Qdrant (P8.1, no network/LLM inside).

    Mandatory patient filter (no cross-patient retrieval, ever);
    optional single-document scope; optional allow-list (used for
    deleted-document exclusion — PG remains authoritative). Bounded
    limit (1..50). Returns citation-compatible dicts; NEVER the source
    of truth — callers hydrate from PG.
    """
    bounded = max(1, min(int(limit or 10), 50))
    must = [FieldCondition(key="patient_id", match=MatchValue(value=str(patient_id)))]
    if document_id is not None:
        must.append(FieldCondition(key="document_id", match=MatchValue(value=str(document_id))))
    elif allowed_document_ids is not None:
        allowed = sorted(allowed_document_ids)
        if not allowed:
            return []
        must.append(FieldCondition(key="document_id", match=MatchAny(any=allowed)))
    points = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        query_filter=Filter(must=must),
        limit=bounded,
        with_payload=True,
    ).points
    results = []
    for hit in points:
        payload = hit.payload or {}
        chunk_text = payload.get("text") or payload.get("chunk_text", "")
        doc_id = str(payload.get("document_id", ""))
        results.append(
            {
                "chunk_id": str(hit.id),
                "text": chunk_text,
                "document_id": doc_id,
                "chunk_index": payload.get("chunk_index"),
                "page_number": payload.get("page_number", 1),
                "similarity_score": round(hit.score, 4),
                # Citation-compatible keys (same envelope as the agent tool).
                "node_id": f"document:{doc_id}",
                "quote": chunk_text[:300] or None,
                "evidence_level": "SOURCE_FACT",
            }
        )
    return results


async def retrieve_evidence(
    db,
    patient_id: uuid.UUID,
    query: str,
    *,
    document_id: uuid.UUID | str | None = None,
    limit: int = 10,
    embed_fn: Callable[[List[str]], Any] | None = None,
) -> List[Dict[str, Any]] | Dict[str, str]:
    """Patient-scoped semantic evidence retrieval (P8.1 backend path).

    query → embed → Qdrant (mandatory tenant filter) → citation dicts.
    Excludes DELETED documents via PG allow-list. Returns a
    {"message": ...} dict (never raises) when embeddings/vector search
    is unavailable or nothing matches — same degraded contract as the
    agent evidence tool. `embed_fn` is injectable for tests.
    """
    if not query or not query.strip():
        return {"error": "INVALID_QUERY: Search query cannot be empty."}
    try:
        if embed_fn is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY is not set.")
            base_url = os.getenv("EMBEDDING_BASE_URL") or os.getenv("OPENAI_API_BASE")
            service = EmbeddingService(api_key=api_key, base_url=base_url)
            vectors = await service.generate_embeddings([query])
        else:
            vectors = await embed_fn([query])
        query_vector = vectors[0]
        allowed = None if document_id is not None else live_document_ids(db, patient_id)
        hits = search_evidence_chunks(
            client=vector_db.client,
            collection_name=vector_db.collection_name,
            query_vector=query_vector,
            patient_id=patient_id,
            document_id=document_id,
            allowed_document_ids=allowed,
            limit=limit,
        )
    except Exception:
        return {"message": "Document search is temporarily unavailable; structured records and provenance remain available."}
    if not hits:
        return {"message": "No relevant evidence found for the given query."}
    return hits



class VectorIndexingService:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required for vector indexing.")
        self.embedding_service = EmbeddingService(api_key=api_key)
        self.chunker = MarkdownChunker()
        self.client = vector_db.setup_collection()
        self.collection_name = vector_db.collection_name


    async def index_markdown_file(self,patient_id:uuid.UUID, document_id:uuid.UUID, safe_markdown:str):
        """
        Indexes a markdown file by chunking it, generating embeddings for each chunk, and storing them in the vector database.

        Args:
            patient_id (uuid.UUID): The ID of the patient.
            document_id (uuid.UUID): The ID of the document.
            safe_markdown (str): The markdown content to be indexed.

        Returns:
            int: The number of chunks indexed.
        """
        chunks : List[str] = self.chunker.split_markdown(safe_markdown)

        if not chunks:
            logger.warning(f"No chunks generated for document {document_id}. Skipping indexing.")
            return 0
         
        embeddings = await self.embedding_service.generate_embeddings(chunks)

        # P8.1: chunk idempotency. First remove this document's existing
        # points (stale slots from a changed chunking), then upsert
        # deterministic ids — retry / replay / re-index converge instead
        # of duplicating. Points are derived index, not history.
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=FilterSelector(
                    filter=Filter(
                        must=[
                            FieldCondition(key="patient_id", match=MatchValue(value=str(patient_id))),
                            FieldCondition(key="document_id", match=MatchValue(value=str(document_id))),
                        ]
                    )
                ),
            )
        except Exception as e:
            logger.warning(f"Qdrant pre-index cleanup skipped for document {document_id}: {type(e).__name__}")

        #qdraant PointStruct requires a list of points to be inserted into the collection
        points: List[PointStruct] = []
        for i, (chunk, vector) in enumerate(zip(chunks, embeddings)):
            point = PointStruct(
                id=chunk_point_id(document_id, i),
                vector=vector,
                payload={
                    "patient_id": str(patient_id),
                    "document_id": str(document_id),
                    "chunk_index": i,
                    "text": chunk,
                    "chunk_text": chunk,
                },
            )
            points.append(point)

        # upsert points into the Qdrant collection
        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )
        logger.info(f"Indexed {len(points)} chunks for document {document_id} of patient {patient_id}.")
        return len(points)