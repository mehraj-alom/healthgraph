from core.db import SessionLocal
from services.ontology_seed import seed_medical_concepts


def seed() -> None:
    db = SessionLocal()
    try:
        concepts = seed_medical_concepts(db)
        db.commit()
        print(f"Seeded {len(concepts)} canonical medical concepts.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed()
