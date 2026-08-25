import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()


def get_llm_client(**kwargs) -> ChatOpenAI:
    """Build the shared chat model used by all LLM workflows."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY must be set before invoking the LLM.")

    return ChatOpenAI(
        api_key=api_key,
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        model=os.getenv("OPENROUTER_MODEL", "z-ai/glm-5.2:free"),
        temperature=0,
        **kwargs,
    )

