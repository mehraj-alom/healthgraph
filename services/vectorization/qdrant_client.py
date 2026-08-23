from logger import logger
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams,PayloadSchemaType


class QdrantManager:
    def __init__(self, host: str = "localhost", port: int = 6333):
        self.host = host
        self.port = port
        self.collection_name = "healthLine"
        self.client = QdrantClient(host=self.host, port=self.port)

    def setup_collection(self):
        collections = self.client.get_collections().collections
        exists = any(c.name == self.collection_name for c in collections)

        if not exists:
            logger.info(f"Collection '{self.collection_name}' does not exist.")
            logger.info(f"Creating collection '{self.collection_name}'...")
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
            )
            
            #create a keyword index for fast search
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="patient_id",
                field_schema=PayloadSchemaType.KEYWORD
            )
            logger.info(f"Collection '{self.collection_name}' created successfully.")
        else:
            logger.info(f"Collection '{self.collection_name}' already exists. Recreating collection...")

        return self.client


vector_db = QdrantManager(host="localhost", port=6333)