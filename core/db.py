from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from core.config import settings
from logger import logger

# TEMP STARTUP-DIAGNOSIS: bound the otherwise-unbounded first connect.
# psycopg2's default connect_timeout is None -> a stalled TCP/TLS connect
# to the remote endpoint hangs startup with no upper bound.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_timeout=15,
    connect_args={
        "connect_timeout": 15,
        "application_name": "medgraph-api",
    },
)
logger.info("START dbengine created (connect_timeout=15)")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # P7: never return a failed transaction to the pool without
        # rolling back — a failed flush/commit would otherwise poison the
        # next borrower of this pooled connection.
        db.rollback()
        raise
    finally:
        db.close()


def acquire_daily_checkin_lock(db, patient_id, day) -> None:
    """Serialize concurrent daily check-ins for one (patient, day).

    Transaction-scoped Postgres advisory lock. Two POSTs racing for the
    same day would otherwise both find-or-create the deterministic Visit
    (uq_visit_patient_date_type) and the losing flush would IntegrityError
    into a generic 500 for the whole check-in. The lock is released
    automatically when the transaction commits or rolls back.

    Only counts/ids are logged — never health data. No-ops on non-Postgres
    backends (e.g. SQLite in tests), where the savepoint fallbacks still
    cover the narrow race.
    """
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # Two int4 keys: a fixed namespace + a stable per-(patient, day) hash.
    day_key = int(day.strftime("%Y%m%d"))
    patient_key = int(patient_id.int % 2_147_483_647)
    db.execute(
        text("SELECT pg_advisory_xact_lock(:patient_key, :day_key)"),
        {"patient_key": patient_key, "day_key": day_key},
    )