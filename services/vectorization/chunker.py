import re
from typing import List, Tuple
from logger import logger


class MarkdownChunker:
    def __init__(self, max_chunk_size: int = 1000, overlap_size: int = 100):
        self.chunk_size = max_chunk_size
        self.overlap_size = overlap_size

    def split_markdown(self, markdown_text: str) -> List[str]:
        # Split the text into paragraphs based on double newlines
        if not markdown_text:
            logger.warning("No markdown text provided for chunking.")
            return []
        #split along the markdown headers 
        sections = re.split(r'(?=\n#{1,4}\s)', markdown_text)
        
        chunks = []

        for section in sections:
            # Split each section into chunks based on the specified chunk size and overlap
            clean_sec = section.strip()
            if not clean_sec:
                continue
            if len(clean_sec) <= self.chunk_size:
                chunks.append(clean_sec)
            else:
                start = 0
                while start < len(clean_sec):
                    end = start + self.chunk_size
                    chunk = clean_sec[start:end]
                    chunks.append(chunk)
                    start += (self.chunk_size - self.overlap_size)

        return chunks