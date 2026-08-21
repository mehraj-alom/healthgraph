"""This module provides functionality for canonicalizing medical terms extracted from OCR text.
 It includes methods for resolving concepts based on lexical and semantic matching,
 as well as learning new aliases for medical concepts. 
"""
from dataclasses import dataclass
from enum import Enum
from uuid import UUID
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import text
from models.ontology import MedicalAlias, MedicalConcept
from services.term_normalization import MedicalTermNormalizer
from services.matching_policy import MatchingPolicy

class MatchStatus(str, Enum):
    AUTO_MATCH = "auto_match"
    REVIEW = "review"
    UNKNOWN = "unknown"

def lexical_candidates(db: Session, term: str, limit: int = 40):
    query = text(
        """
        SELECT
            ma.id,
            ma.raw_name,
            ma.lexical_name,
            ma.concept_id,
            similarity(ma.lexical_name, :term) AS pg_score
        FROM medical_aliases ma
        WHERE ma.active = TRUE AND ma.lexical_name % :term
        ORDER BY similarity(ma.lexical_name, :term) DESC
        LIMIT :limit
        """
    )
    return db.execute(query, {"term": term, "limit": limit}).mappings().all()


@dataclass
class CanonicalizationResult:
    concept_id: UUID | None
    terminology: str | None
    code: str | None
    display_name: str | None
    raw_term: str
    canonical_text: str
    matched_alias: str | None
    lexical_score: float
    semantic_score: float | None
    combined_score: float
    status: MatchStatus

    def to_dict(self) -> dict:
        return {
            "concept_id": str(self.concept_id) if self.concept_id else None,
            "terminology": self.terminology,
            "code": self.code,
            "display_name": self.display_name,
            "raw_term": self.raw_term,
            "canonical_text": self.canonical_text,
            "matched_alias": self.matched_alias,
            "lexical_score": self.lexical_score,
            "semantic_score": self.semantic_score,
            "combined_score": self.combined_score,
            "status": self.status.value,
        }

class Canonicalizer:
    CANDIDATE_LIMIT = 40

    @classmethod
    def resolve_concept(
        cls, db: Session, raw_term: str, semantic_matcher=None
    ) -> CanonicalizationResult:
        
        canonical_text = MedicalTermNormalizer.canonical_text(raw_term)
        lexical_text = MedicalTermNormalizer.lexical_text(raw_term)

        if not lexical_text:
            return CanonicalizationResult(
                concept_id=None, terminology=None, code=None, display_name=None,
                raw_term=raw_term, canonical_text=canonical_text, matched_alias=None,
                lexical_score=0.0, semantic_score=None, combined_score=0.0, status=MatchStatus.UNKNOWN,
            )

        #EXACT MATCH
        exact_alias = db.scalar(
            select(MedicalAlias).where(
                MedicalAlias.lexical_name == lexical_text, MedicalAlias.active.is_(True)
            )
        )

        if exact_alias:
            concept = db.get(MedicalConcept, exact_alias.concept_id)
            if concept:
                return CanonicalizationResult(
                    concept_id=concept.id, terminology=concept.terminology, code=concept.code,
                    display_name=concept.display_name, raw_term=raw_term, canonical_text=canonical_text,
                    matched_alias=exact_alias.raw_name, lexical_score=100.0, semantic_score=100.0,
                    combined_score=100.0, status=MatchStatus.AUTO_MATCH,
                )

        #LEXICAL CANDIDATES (PostgreSQL trigram)
        candidates = lexical_candidates(db=db, term=lexical_text, limit=cls.CANDIDATE_LIMIT)
        lexical_results = []
        
        for candidate in candidates:
            score = fuzz.WRatio(lexical_text, candidate["lexical_name"])
            lexical_results.append({**candidate, "lexical_score": score})

        # SEMANTIC SEARCH (Optiona via Milvus)
        semantic_results = {}
        if semantic_matcher is not None:
            semantic_matches = semantic_matcher.search(canonical_text, limit=20)
            for match in semantic_matches:
                semantic_results[match["concept_id"]] = match["score"]

        # COMBINE SCORES
        best = None
        best_score = 0.0

        for candidate in lexical_results:
            semantic_score = semantic_results.get(candidate["concept_id"])
            if semantic_score is None:
                combined = candidate["lexical_score"] * 0.70
            else:
                combined = 0.55 * candidate["lexical_score"] + 0.45 * semantic_score

            if combined > best_score:
                best = candidate
                best_score = combined
                best["semantic_score"] = semantic_score

        # FALLBACK: Semantic-only candidates
        if semantic_results and not best:
            concept_id = max(semantic_results, key=semantic_results.get)
            concept = db.get(MedicalConcept, concept_id)
            if concept:
                semantic_score = semantic_results[concept_id]
                if semantic_score >= 90:
                    return CanonicalizationResult(
                        concept_id=concept.id, terminology=concept.terminology, code=concept.code,
                        display_name=concept.display_name, raw_term=raw_term, canonical_text=canonical_text,
                        matched_alias=None, lexical_score=0.0, semantic_score=semantic_score,
                        combined_score=semantic_score, status=MatchStatus.AUTO_MATCH,
                    )

        # RESOLVE FINAL STATUS
        if not best:
            return CanonicalizationResult(
                concept_id=None, terminology=None, code=None, display_name=None,
                raw_term=raw_term, canonical_text=canonical_text, matched_alias=None,
                lexical_score=0.0, semantic_score=None, combined_score=0.0, status=MatchStatus.UNKNOWN,
            )

        concept = db.get(MedicalConcept, best["concept_id"])
        
        if not concept:
            return CanonicalizationResult(
                concept_id=None, terminology=None, code=None, display_name=None,
                raw_term=raw_term, canonical_text=canonical_text, matched_alias=best["raw_name"],
                lexical_score=best["lexical_score"], semantic_score=best.get("semantic_score"),
                combined_score=best_score, status=MatchStatus.UNKNOWN,
            )

        threshold = MatchingPolicy.auto_threshold(lexical_text)
        review_threshold = MatchingPolicy.review_threshold(lexical_text)

        if best_score >= threshold:
            status = MatchStatus.AUTO_MATCH
        elif best_score >= review_threshold:
            status = MatchStatus.REVIEW
        else:
            status = MatchStatus.UNKNOWN

        return CanonicalizationResult(
            concept_id=concept.id if status == MatchStatus.AUTO_MATCH else None,
            terminology=concept.terminology if status == MatchStatus.AUTO_MATCH else None,
            code=concept.code if status == MatchStatus.AUTO_MATCH else None,
            display_name=concept.display_name if status == MatchStatus.AUTO_MATCH else None,
            raw_term=raw_term,
            canonical_text=canonical_text,
            matched_alias=best["raw_name"],
            lexical_score=best["lexical_score"],
            semantic_score=best.get("semantic_score"),
            combined_score=best_score,
            status=status,
        )

    @staticmethod
    def learn_alias(db: Session, raw_term: str, concept_id: UUID, source: str = "ocr", confidence: float = 1.0):
        """Atomic upsert to learn a new alias without race conditions across Celery workers."""
        lexical_name = MedicalTermNormalizer.lexical_text(raw_term)
        
        stmt = insert(MedicalAlias).values(
            raw_name=raw_term.strip(),
            lexical_name=lexical_name,
            concept_id=concept_id,
            source=source,
            confidence=confidence,
            usage_count=1,
            active=True,
        )

        stmt = stmt.on_conflict_do_update(
            constraint="uq_alias_lexical_concept",
            set_={"usage_count": MedicalAlias.usage_count + 1, "confidence": confidence, "active": True},
        )

        db.execute(stmt)
        db.commit()