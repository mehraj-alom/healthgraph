"""
Security test script for Health Graph API.

Tests patient isolation by verifying:
1. Patient A can only see Patient A's graph data
2. Patient B can only see Patient B's graph data
3. Shared AnatomicalStructure nodes don't leak cross-patient data
4. Node ID guessing returns "Not found" for unauthorized access

Usage:
    Set environment variables:
        NEO4J_URI=bolt://neo4j:7687
        NEO4J_USER=neo4j
        NEO4J_PASSWORD=password

    Run:
        python scripts/test_health_graph_security.py
"""

import os
import sys
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file if present
# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")


def setup_test_data(driver):
    """Create two test patients with overlapping anatomy connections."""
    patient_a_id = str(uuid.uuid4())
    patient_b_id = str(uuid.uuid4())
    obs_a_id = str(uuid.uuid4())
    obs_b_id = str(uuid.uuid4())
    te_a_id = str(uuid.uuid4())
    te_b_id = str(uuid.uuid4())

    with driver.session() as session:
        # Clean up any previous test data
        session.run("MATCH (n) WHERE n.id STARTS WITH 'test-patient-' DETACH DELETE n")

        # Create Patient A with observation on Heart
        session.run("""
            MERGE (p:Patient {id: $patient_id})
            SET p.name = 'Test Patient A'
            MERGE (s:AnatomicalStructure {id: 'HEART'})
            SET s.display_name = 'Heart'
            MERGE (o:Observation {id: $obs_id})
            SET o.finding_code = 'heart_rate',
                o.visual_severity_score = 0.3,
                o.recorded_at = datetime(),
                o.source_type = 'PATIENT_REPORTED'
            MERGE (t:TimelineEvent {id: $te_id})
            SET t.date = datetime(),
                t.event_type = 'VITAL_SIGN'
            MERGE (p)-[:HAS_OBSERVATION]->(o)
            MERGE (o)-[:AFFECTS]->(s)
            MERGE (p)-[:HAS_TIMELINE_EVENT]->(t)
            MERGE (o)-[:LOGGED_ON]->(t)
        """, patient_id=patient_a_id, obs_id=obs_a_id, te_id=te_a_id)

        # Create Patient B with observation on SAME Heart
        session.run("""
            MERGE (p:Patient {id: $patient_id})
            SET p.name = 'Test Patient B'
            MERGE (s:AnatomicalStructure {id: 'HEART'})
            SET s.display_name = 'Heart'
            MERGE (o:Observation {id: $obs_id})
            SET o.finding_code = 'heart_rate',
                o.visual_severity_score = 0.7,
                o.recorded_at = datetime(),
                o.source_type = 'PATIENT_REPORTED'
            MERGE (t:TimelineEvent {id: $te_id})
            SET t.date = datetime(),
                t.event_type = 'VITAL_SIGN'
            MERGE (p)-[:HAS_OBSERVATION]->(o)
            MERGE (o)-[:AFFECTS]->(s)
            MERGE (p)-[:HAS_TIMELINE_EVENT]->(t)
            MERGE (o)-[:LOGGED_ON]->(t)
        """, patient_id=patient_b_id, obs_id=obs_b_id, te_id=te_b_id)

    return patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id


def test_ownership_aware_traversal(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id):
    """Test that ownership-aware traversal prevents cross-patient access."""

    print("\n" + "=" * 60)
    print("TEST 1: Patient A graph should NOT contain Patient B data")
    print("=" * 60)

    with driver.session() as session:
        # Patient A's graph using ownership-aware traversal
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})

            OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)
            OPTIONAL MATCH (o)-[:AFFECTS]->(s:AnatomicalStructure)
            OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d:Document)
            OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te:TimelineEvent)
            OPTIONAL MATCH (o)-[:LOGGED_ON]->(te2:TimelineEvent)

            WITH p,
                 collect(DISTINCT o) AS observations,
                 collect(DISTINCT s) AS structures,
                 collect(DISTINCT d) AS documents,
                 collect(DISTINCT te) + collect(DISTINCT te2) AS timeline_events

            RETURN p.id AS patient_id,
                   [x IN observations WHERE x IS NOT NULL | x.id] AS obs_ids,
                   [x IN structures WHERE x IS NOT NULL | x.id] AS struct_ids,
                   [x IN timeline_events WHERE x IS NOT NULL | x.id] AS te_ids
        """, patient_id=patient_a_id)
        record = result.single()

        print(f"\nPatient A graph:")
        print(f"  Patient ID: {record['patient_id']}")
        print(f"  Observations: {record['obs_ids']}")
        print(f"  Structures: {record['struct_ids']}")
        print(f"  Timeline Events: {record['te_ids']}")

        # Verify Patient A only sees their own data
        assert record['patient_id'] == patient_a_id, "Wrong patient ID"
        assert obs_a_id in record['obs_ids'], "Missing Patient A observation"
        assert obs_b_id not in record['obs_ids'], "LEAK: Patient B observation visible to Patient A!"
        assert 'HEART' in record['struct_ids'], "Missing shared Heart structure"

    print("\n✓ PASS: Patient A only sees their own data")

    print("\n" + "=" * 60)
    print("TEST 2: Patient B graph should NOT contain Patient A data")
    print("=" * 60)

    with driver.session() as session:
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})

            OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)
            OPTIONAL MATCH (o)-[:AFFECTS]->(s:AnatomicalStructure)
            OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d:Document)
            OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te:TimelineEvent)
            OPTIONAL MATCH (o)-[:LOGGED_ON]->(te2:TimelineEvent)

            WITH p,
                 collect(DISTINCT o) AS observations,
                 collect(DISTINCT s) AS structures,
                 collect(DISTINCT d) AS documents,
                 collect(DISTINCT te) + collect(DISTINCT te2) AS timeline_events

            RETURN p.id AS patient_id,
                   [x IN observations WHERE x IS NOT NULL | x.id] AS obs_ids,
                   [x IN structures WHERE x IS NOT NULL | x.id] AS struct_ids,
                   [x IN timeline_events WHERE x IS NOT NULL | x.id] AS te_ids
        """, patient_id=patient_b_id)
        record = result.single()

        print(f"\nPatient B graph:")
        print(f"  Patient ID: {record['patient_id']}")
        print(f"  Observations: {record['obs_ids']}")
        print(f"  Structures: {record['struct_ids']}")
        print(f"  Timeline Events: {record['te_ids']}")

        assert record['patient_id'] == patient_b_id, "Wrong patient ID"
        assert obs_b_id in record['obs_ids'], "Missing Patient B observation"
        assert obs_a_id not in record['obs_ids'], "LEAK: Patient A observation visible to Patient B!"
        assert 'HEART' in record['struct_ids'], "Missing shared Heart structure"

    print("\n✓ PASS: Patient B only sees their own data")


def test_node_ownership_verification(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id):
    """Test that node detail endpoint verifies ownership."""

    print("\n" + "=" * 60)
    print("TEST 3: Patient A cannot access Patient B's observation")
    print("=" * 60)

    with driver.session() as session:
        # Simulate the verification query that the API would run
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(target {id: $raw_id})
            RETURN true AS reachable
            LIMIT 1
        """, patient_id=patient_a_id, raw_id=obs_b_id)
        verification = result.single()

        assert verification is None or not verification.get("reachable"), \
            "SECURITY BREACH: Patient A can access Patient B's observation!"

    print("✓ PASS: Patient A denied access to Patient B's observation")

    print("\n" + "=" * 60)
    print("TEST 4: Patient A cannot access Patient B's timeline event")
    print("=" * 60)

    with driver.session() as session:
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_TIMELINE_EVENT]->(target {id: $raw_id})
            RETURN true AS reachable
            LIMIT 1
        """, patient_id=patient_a_id, raw_id=te_b_id)
        verification = result.single()

        assert verification is None or not verification.get("reachable"), \
            "SECURITY BREACH: Patient A can access Patient B's timeline event!"

    print("✓ PASS: Patient A denied access to Patient B's timeline event")

    print("\n" + "=" * 60)
    print("TEST 5: Patient A CAN access Patient A's observation")
    print("=" * 60)

    with driver.session() as session:
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(target {id: $raw_id})
            RETURN true AS reachable
            LIMIT 1
        """, patient_id=patient_a_id, raw_id=obs_a_id)
        verification = result.single()

        assert verification and verification.get("reachable"), \
            "Patient A should be able to access their own observation!"

    print("✓ PASS: Patient A can access their own observation")


def test_shared_anatomy_access(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id):
    """Test that shared AnatomicalStructure nodes are accessible but safe."""

    print("\n" + "=" * 60)
    print("TEST 6: Patient A can access shared Heart (has observation)")
    print("=" * 60)

    with driver.session() as session:
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target {id: $raw_id})
            RETURN true AS reachable
            LIMIT 1
        """, patient_id=patient_a_id, raw_id="HEART")
        verification = result.single()

        assert verification and verification.get("reachable"), \
            "Patient A should be able to access Heart (they have an observation on it)"

    print("✓ PASS: Patient A can access shared Heart node")

    print("\n" + "=" * 60)
    print("TEST 7: Heart node details only show Patient A's data")
    print("=" * 60)

    with driver.session() as session:
        # Simulate the detail query for anatomy node
        # Fix: collect te2 first, then combine lists in a separate WITH
        # SECURITY: 'p' must be carried through every WITH clause to prevent
        # it from being re-bound against all Patient nodes.
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)-[:AFFECTS]->(target {id: $raw_id})
            WITH p, target, collect(DISTINCT o) AS patient_obs
            OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o2:Observation)-[:SOURCE_DOCUMENT]->(d:Document)
            WHERE o2 IN patient_obs
            WITH p, target, patient_obs, collect(DISTINCT d) AS patient_docs
            OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o3:Observation)-[:LOGGED_ON]->(te:TimelineEvent)
            WHERE o3 IN patient_obs
            WITH p, target, patient_obs, patient_docs, collect(DISTINCT te) AS patient_tes
            OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te2:TimelineEvent)
            WHERE NOT te2 IN patient_tes
            WITH p, target, patient_obs, patient_docs, patient_tes, collect(DISTINCT te2) AS extra_tes
            WITH p, target, patient_obs, patient_docs, patient_tes + extra_tes AS all_tes
            RETURN target.id AS target_id,
                   [x IN patient_obs WHERE x IS NOT NULL | x.id] AS obs_ids,
                   [x IN all_tes WHERE x IS NOT NULL | x.id] AS te_ids
        """, patient_id=patient_a_id, raw_id="HEART")
        record = result.single()

        print(f"\nHeart node details for Patient A:")
        print(f"  Target: {record['target_id']}")
        print(f"  Observations: {record['obs_ids']}")
        print(f"  Timeline Events: {record['te_ids']}")

        # Verify only Patient A's data is included
        assert obs_a_id in record['obs_ids'], "Missing Patient A observation"
        assert obs_b_id not in record['obs_ids'], \
            "SECURITY BREACH: Patient B observation visible in shared Heart detail!"

        # Verify Patient B's timeline event does NOT appear
        # Patient B's timeline events should never reach Patient A through shared anatomy
        for te_id in record['te_ids']:
            assert te_id != te_b_id, \
                f"SECURITY BREACH: Patient B timeline event {te_b_id} visible in Patient A's Heart detail!"

    print("✓ PASS: Heart details only show Patient A's data")


def test_unreachable_node_returns_not_found(driver, patient_a_id):
    """Test that unreachable nodes return 'Not found'."""

    print("\n" + "=" * 60)
    print("TEST 8: Nonexistent node returns 'Not found'")
    print("=" * 60)

    with driver.session() as session:
        result = session.run("""
            MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(target {id: $raw_id})
            RETURN true AS reachable
            LIMIT 1
        """, patient_id=patient_a_id, raw_id="NONEXISTENT_NODE_12345")
        verification = result.single()

        assert verification is None or not verification.get("reachable"), \
            "Nonexistent node should not be reachable"

    print("✓ PASS: Nonexistent node returns 'Not found'")


def cleanup_test_data(driver):
    """Remove test data."""
    with driver.session() as session:
        # Delete all test patients and their connected nodes
        session.run("""
            MATCH (p:Patient)
            WHERE p.name STARTS WITH 'Test Patient'
            OPTIONAL MATCH (p)-[:HAS_OBSERVATION]->(o:Observation)
            OPTIONAL MATCH (o)-[:AFFECTS]->(s:AnatomicalStructure)
            OPTIONAL MATCH (o)-[:SOURCE_DOCUMENT]->(d:Document)
            OPTIONAL MATCH (p)-[:HAS_TIMELINE_EVENT]->(te:TimelineEvent)
            DETACH DELETE p, o, d, te
        """)
        # Delete orphaned test timeline events
        session.run("""
            MATCH (te:TimelineEvent)
            WHERE te.event_type = 'VITAL_SIGN'
              AND NOT (te)<-[:LOGGED_ON]-(:Observation)
              AND NOT (:Patient)-[:HAS_TIMELINE_EVENT]->(te)
            DETACH DELETE te
        """)
        # Delete orphaned HEART if no observations reference it
        session.run("MATCH (n:AnatomicalStructure {id: 'HEART'}) WHERE NOT (n)<-[:AFFECTS]-() DETACH DELETE n")


def main():
    print("=" * 60)
    print("HEALTH GRAPH SECURITY TEST")
    print("=" * 60)

    try:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        print(f"\nConnected to Neo4j at {NEO4J_URI}")
    except Exception as e:
        print(f"\nFailed to connect to Neo4j: {e}")
        print("Please ensure Neo4j is running and accessible.")
        sys.exit(1)

    try:
        # Setup test data
        print("\nSetting up test data...")
        patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id = setup_test_data(driver)
        print(f"  Patient A: {patient_a_id}")
        print(f"  Patient B: {patient_b_id}")

        # Run tests
        test_ownership_aware_traversal(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id)
        test_node_ownership_verification(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id)
        test_shared_anatomy_access(driver, patient_a_id, patient_b_id, obs_a_id, obs_b_id, te_a_id, te_b_id)
        test_unreachable_node_returns_not_found(driver, patient_a_id)

        print("\n" + "=" * 60)
        print("ALL SECURITY TESTS PASSED ✓")
        print("=" * 60)

    except AssertionError as e:
        print(f"\n✗ SECURITY TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cleanup_test_data(driver)
        driver.close()


if __name__ == "__main__":
    main()
