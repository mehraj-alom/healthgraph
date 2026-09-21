from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file
import os
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session
from qdrant_client import QdrantClient

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from services.vectorization.qdrant_client import vector_db
from services.vectorization.embeddings import EmbeddingService
from services.vectorization.vector_indexing import (
    live_document_ids,
    search_evidence_chunks,
)
from models.anatomy import AnatomicalObservation
# P15 / D2: statement registered in the template registry + runtime safety gate.
from services.retrieval.templates import (
    CYPHER_DOCUMENT_PROVENANCE,
    run_patient_cypher,
)



async def _get_document_evidence(
    patient_id: uuid.UUID, 
    document_id: str, 
    query: str,
    db: Session,
    driver,
    client: QdrantClient
) -> List[Dict]:
    """
    Internal logic: Three-layer verification pipeline 
    (PostgreSQL Ownership -> Neo4j Provenance -> Qdrant Semantic Retrieval)
    """
    if not query or not query.strip():
        return [{"error": "INVALID_QUERY: Search query cannot be empty."}]
    
    # If no specific document_id provided, search across all patient's documents
    if not document_id or not document_id.strip():
        # Search across all patient's documents
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not set.")
        base_url = os.getenv("EMBEDDING_BASE_URL") or os.getenv("OPENAI_API_BASE")
        embedding_service = EmbeddingService(api_key=api_key, base_url=base_url)
        # P7: vector outage degrades to an explicit message (PG evidence
        # stays reachable via other tools) instead of a chat 500.
        try:
            query_vector = (await embedding_service.generate_embeddings([query]))[0]
            # P8.1: shared backend search. Mandatory tenant filter; PG
            # allow-list excludes DELETED documents (PG authoritative).
            results = search_evidence_chunks(
                client=client,
                collection_name=vector_db.collection_name,
                query_vector=query_vector,
                patient_id=patient_id,
                allowed_document_ids=live_document_ids(db, patient_id),
                limit=5,
            )
        except Exception:
            return [{"message": "Document search is temporarily unavailable; structured records and provenance remain available."}]
        
        if not results:
            return [{"message": "No relevant evidence found across patient's documents for the given query."}]
        
        return [
            {
                "chunk_id": hit["chunk_id"],
                "text": hit["text"],
                "document_id": hit["document_id"],
                "page_number": hit["page_number"],
                "similarity_score": hit["similarity_score"],
                # P7: Citation-compatible keys (additive; existing keys kept).
                "node_id": hit["node_id"],
                "quote": hit["quote"],
                "evidence_level": hit["evidence_level"],
            }
            for hit in results
        ]
    
    # Specific document_id provided - validate
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        return [{"error": "INVALID_DOCUMENT_ID: Document ID must be a valid UUID."}]

    # 1. PostgreSQL Ownership Validation (System of Record)
    stmt = select(AnatomicalObservation.document_id).where(
        AnatomicalObservation.patient_id == patient_id,
        AnatomicalObservation.document_id == doc_uuid
    ).limit(1)
    
    valid_doc = db.execute(stmt).scalar_one_or_none()
    
    if not valid_doc:
        return [{"error": "DOCUMENT_NOT_FOUND: This document does not belong to the current patient or does not exist."}]

    # 2. Neo4j Provenance Check (Graph Topology)
    # P2 retirement prep: accept both the legacy SOURCE_DOCUMENT link and
    # the canonical DOCUMENTED_IN link (dual-written since P0).
    with driver.session() as session:
        result = run_patient_cypher(
            session,
            CYPHER_DOCUMENT_PROVENANCE,
            {"patient_id": str(patient_id), "document_id": str(document_id)},
            statement_id="T-DOC-PROVENANCE",
        )
        if not result.single():
            return [{"error": "DOCUMENT_NOT_PROJECTED: Document exists but lacks clinical graph provenance."}]
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set.")
    base_url = os.getenv("EMBEDDING_BASE_URL") or os.getenv("OPENAI_API_BASE")
    embedding_service = EmbeddingService(api_key=api_key, base_url=base_url)

    # P7: same degraded-mode handling as the cross-doc path above.
    try:
        query_vector = (await embedding_service.generate_embeddings([query]))[0]
        # P8.1: shared backend search (single-document scope).
        results = search_evidence_chunks(
            client=client,
            collection_name=vector_db.collection_name,
            query_vector=query_vector,
            patient_id=patient_id,
            document_id=str(document_id),
            limit=5,
        )
    except Exception:
        return [{"message": "Document search is temporarily unavailable; structured records and provenance remain available."}]
    
    if not results:
        return [{"message": "No relevant evidence found in this document for the given query."}]
    
    return [
        {
            "chunk_id": hit["chunk_id"],
            "text": hit["text"],
            "page_number": hit["page_number"],
            "similarity_score": hit["similarity_score"],
            # P7: Citation-compatible keys (additive; existing keys kept).
            "node_id": hit["node_id"],
            "document_id": hit["document_id"],
            "quote": hit["quote"],
            "evidence_level": hit["evidence_level"],
        }
        for hit in results
    ]

@tool
async def get_document_evidence(query: str, document_id: str = "", config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves semantic text evidence and exact quotes from a specific medical document or across all patient documents.
    
    Args:
        query: Search query (required).
        document_id: Optional UUID of a specific document. If omitted, searches across all patient's documents.
    """
    # Security Boundary: Extract tenant ID from execution context
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    if not query or not query.strip():
        return [{"error": "INVALID_QUERY: Search query cannot be empty."}]
        
    db: Session = SessionLocal()
    try:
        return await _get_document_evidence(patient_id, document_id, query, db, neo4j_driver, vector_db.client)
    finally:
        db.close()
