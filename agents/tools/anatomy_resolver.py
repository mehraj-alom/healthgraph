from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field
from langchain_core.tools import tool
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from models.anatomy import AnatomicalStructure

class ResolutionStatus(str, Enum):
    RESOLVED = "resolved"
    AMBIGUOUS = "ambiguous"
    NOT_FOUND = "not_found"
    INVALID = "invalid"

class AnatomyResolution(BaseModel):
    status: ResolutionStatus
    structure_id: Optional[str] = None
    candidates: List[str] = Field(default_factory=list)
    message: Optional[str] = None


def _resolve_anatomy_id(query: str, db: Session) -> AnatomyResolution:
    """
    Deterministic internal resolver logic using token subset matching.
    """
    clean_query = " ".join(query.lower().strip().split())
    if not clean_query:
        return AnatomyResolution(status=ResolutionStatus.INVALID, message="Empty search string provided.")
        
    query_tokens = set(clean_query.split())
    
    # Fetch all anatomical structures from the database
    structures = db.execute(select(AnatomicalStructure)).scalars().all()
    
    matches = []
    for struct in structures:
        struct_name = struct.display_name.lower()
        
        # Exact match bypass
        if struct_name == clean_query:
            return AnatomyResolution(
                status=ResolutionStatus.RESOLVED,
                structure_id=struct.structure_id,
                candidates=[struct.display_name]
            )
            
        # Token subset match (order-independent)
        struct_tokens = set(struct_name.split())
        if query_tokens.issubset(struct_tokens):
            matches.append(struct)
            
    if not matches:
        return AnatomyResolution(status=ResolutionStatus.NOT_FOUND, message=f"Could not resolve '{query}'.")
        
    if len(matches) == 1:
        return AnatomyResolution(
            status=ResolutionStatus.RESOLVED,
            structure_id=matches[0].structure_id,
            candidates=[matches[0].display_name]
        )
        
    options = [m.display_name for m in matches]
    return AnatomyResolution(
        status=ResolutionStatus.AMBIGUOUS,
        candidates=options,
        message="Query matched multiple structures. Ask user to clarify."
    )


@tool
def resolve_anatomy_id(query: str) -> dict:
    """
    Resolves a natural language body part description into a canonical structure ID.
    Always use this before querying Neo4j or PostgreSQL with anatomy.
    """
    db: Session = SessionLocal()
    try:
        return _resolve_anatomy_id(query, db).model_dump()
    finally:
        db.close()