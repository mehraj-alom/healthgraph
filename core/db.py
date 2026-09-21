from sqlalchemy import create_engine
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