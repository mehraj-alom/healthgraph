from sqlalchemy import text
from sqlalchemy.orm import Session

def get_body_region_descendants(db: Session, region_name: str):
    """Recursive CTE to fetch a region and all its sub-regions for the 3D model."""
    query = text("""
        WITH RECURSIVE region_tree AS (
            SELECT region_id, name, parent_id
            FROM body_regions
            WHERE name = :region_name
            
            UNION ALL
            
            SELECT br.region_id, br.name, br.parent_id
            FROM body_regions br
            INNER JOIN region_tree rt ON br.parent_id = rt.region_id
        )
        SELECT * FROM region_tree;
    """)
    result = db.execute(query, {"region_name": region_name})
    return [row._mapping for row in result]