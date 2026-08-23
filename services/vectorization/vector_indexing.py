import uuid
from logger import logger
from typing import List, Dict, Any
from qdrant_client.http.models  import PointStruct
from vectorization.qdrant_client import vector_db
from vectorization.embeddings import EmbeddingService
from vectorization.chunker import MarkdownChunker



class VectorIndexingService:
    def __init__(self):
        self.embedding_service = EmbeddingService()
        self.chunker = MarkdownChunker()
        self.client = vector_db.setup_collection()
        self.collection_name = vector_db.collection_name


    async def index_markdown_file(self,patient_id:uuid.UUID, document_id:uuid.UUID, safe_markdown:str):
        """
        Indexes a markdown file by chunking it, generating embeddings for each chunk, and storing them in the vector database.

        Args:
            patient_id (uuid.UUID): The ID of the patient.
            document_id (uuid.UUID): The ID of the document.
            safe_markdown (str): The markdown content to be indexed.

        Returns:
            int: The number of chunks indexed.
        """
        chunks : List[str] = self.chunker.split_markdown(safe_markdown)

        if not chunks:
            logger.warning(f"No chunks generated for document {document_id}. Skipping indexing.")
            return 0
         
        embeddings = await self.embedding_service.generate_embeddings(chunks)

        #qdraant PointStruct requires a list of points to be inserted into the collection
        points: List[PointStruct] = []
        for i, (chunk, vector) in enumerate(zip(chunks, embeddings)):
            point = PointStruct(
                id= str(uuid.uuid4()),  # Generate a unique ID for each chunk
                vector=vector,
                payload={
                    "patient_id": str(patient_id),
                    "document_id": str(document_id),
                    "chunk_index": i,
                    "chunk_text": chunk
                }
            )
            points.append(point)

        # upsert points into the Qdrant collection
        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )
        logger.info(f"Indexed {len(points)} chunks for document {document_id} of patient {patient_id}.")
        return len(points)