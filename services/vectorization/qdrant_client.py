import os

from logger import logger
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    PayloadSchemaType,
    VectorParams,
)


class QdrantManager:
    def __init__(
        self,
        host: str = "localhost",
        port: int = 6333,
    ):
        self.url = os.getenv("QDRANT_URL")
        self.api_key = os.getenv("QDRANT_API_KEY")

        self.host = os.getenv("QDRANT_HOST", host)
        self.port = int(os.getenv("QDRANT_PORT", str(port)))

        self.collection_name = os.getenv(
            "QDRANT_COLLECTION_NAME",
            "healthLine",
        )

        # Cloud Qdrant
        if self.url:
            logger.info(
                f"Initializing Qdrant Cloud: {self.url}"
            )

            self.client = QdrantClient(
                url=self.url,
                api_key=self.api_key,
                timeout=15,  # TEMP DIAGNOSIS: bound remote calls
            )

        # Local Docker Qdrant fallback
        else:
            logger.info(
                f"Initializing local Qdrant: "
                f"{self.host}:{self.port}"
            )

            self.client = QdrantClient(
                host=self.host,
                port=self.port,
            )

    def setup_collection(self):
        logger.info("START qdrant.setup_collection")
        collections = self.client.get_collections().collections

        exists = any(
            collection.name == self.collection_name
            for collection in collections
        )

        if not exists:
            logger.info(
                f"Collection '{self.collection_name}' "
                "does not exist."
            )

            logger.info(
                f"Creating collection "
                f"'{self.collection_name}'..."
            )

            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=1536,
                    distance=Distance.COSINE,
                ),
            )

            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="patient_id",
                field_schema=PayloadSchemaType.KEYWORD,
            )

            logger.info(
                f"Collection '{self.collection_name}' "
                "created successfully."
            )

        else:
            logger.info(
                f"Collection '{self.collection_name}' "
                "already exists."
            )

        logger.info("DONE qdrant.setup_collection")
        return self.client


vector_db = QdrantManager()