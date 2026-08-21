from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file
from pathlib import Path
from landingai_ade import LandingAIADE


client = LandingAIADE()


class Extraction:
    @staticmethod
    def parse_(document_path: str, model: str = "dpt-3-pro-latest") -> dict:
        """
        Parses a document using the LandingAI ADE API.
        return marksdown and structured json output"""

        
        response = client.v2.parse(
            document=Path(document_path),
            model=model,
        )
        return {"markdown": response.markdown, "structured_json": response.structure}


    @staticmethod
    def extract_(markdown: str, schema: str = "") -> dict:
        """
        Extracts structured data from markdown using the LandingAI ADE API.
        return structured json output"""
        extract_response = client.v2.extract(
            markdown=markdown,
            schema=schema
        )
        return {"extraction": extract_response.extraction}


    @staticmethod
    def parse_and_extract(document_path: str, model: str = "dpt-3-pro-latest", schema: str = "") -> dict:
        """
        Parses a document and extracts structured data using the LandingAI ADE API.
        Returns both markdown and structured JSON output.
        """
        parse_result = Extraction.parse_(document_path, model)
        extract_result = Extraction.extract_(parse_result["markdown"], schema)
        return {
            "markdown": parse_result["markdown"],
            "structured_json": parse_result["structured_json"],
            "extraction": extract_result["extraction"]
        }