from typing import List, Optional
import os 
import httpx
from logger import logger


class EmbeddingService:
    def __init__(self, api_key: str, base_url: str = None, model: str = "text-embedding-3-small"):
        self.api_key = api_key
        self.model = model
        # Resolve base URL: explicit arg > EMBEDDING_BASE_URL > OPENAI_API_BASE > OpenAI default.
        # OPENAI_API_BASE is the proxy/provider the API key was issued for;
        # falling back to it prevents 401 errors when using a non-OpenAI provider.
        base = base_url or os.getenv("EMBEDDING_BASE_URL") or os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
        self.endpoint = base.rstrip("/") + "/embeddings"

    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """generates 1536-dimensional embeddings for a list of texts"""

        if not texts:
            logger.warning("No texts provided for embedding generation.")
            return []
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = (
            {
                "model": self.model,
                "input": texts,
            }   
        )
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(self.endpoint, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                embeddings = [item["embedding"] for item in data["data"]]
                return embeddings
            except httpx.HTTPStatusError as e:
                logger.error(f"HTTP error occurred: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"An error occurred while generating embeddings: {str(e)}")
                raise