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
from qdrant_client.http import models

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from services.vectorization.qdrant_client import QdrantManager
from services.vectorization.embeddings import EmbeddingService 
from models.anatomy import AnatomicalObservation



def _get_document_evidence(
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
    cypher = """
    MATCH (p:Patient {id: $patient_id})
          -[:HAS_OBSERVATION]->(o:Observation)
          -[:SOURCE_DOCUMENT]->(d:Document {id: $document_id})
    RETURN d.id
    LIMIT 1
    """
    with driver.session() as session:
        result = session.run(cypher, patient_id=str(patient_id), document_id=str(document_id))
        if not result.single():
            return [{"error": "DOCUMENT_NOT_PROJECTED: Document exists but lacks clinical graph provenance."}]
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set.")
    embedding_service = EmbeddingService(api_key=api_key)
    # Qdrant Semantic Search (Mandatory Tenant Isolation Filter)
    query_vector = embedding_service.generate_embeddings(query)
    tenant_filter = models.Filter(
        must=[
            models.FieldCondition(
                key="patient_id",
                match=models.MatchValue(value=str(patient_id))
            ),
            models.FieldCondition(
                key="document_id",
                match=models.MatchValue(value=str(document_id))
            )
        ]
    )
    
    results = client.search(
        collection_name="clinical_documents",
        query_vector=query_vector,
        query_filter=tenant_filter,
        limit=5  # Top-K constraint
    )
    
    if not results:
        return [{"message": "No relevant evidence found in this document for the given query."}]
    
    return [
        {
            "chunk_id": str(hit.id),
            "text": hit.payload.get("text", ""),
            "page_number": hit.payload.get("page_number", 1),
            "similarity_score": round(hit.score, 4)
        }
        for hit in results
    ]

@tool
def get_document_evidence(document_id: str, query: str, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves semantic text evidence and exact quotes from a specific medical document.
    """
    # Security Boundary: Extract tenant ID from execution context
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        quadrent_client = QdrantManager()
        return _get_document_evidence(patient_id, document_id, query, db, neo4j_driver, quadrent_client.client)
    finally:
        db.close()