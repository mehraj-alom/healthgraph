import re

class MedicalTermNormalizer:
    @staticmethod
    def canonical_text(value: str) -> str:
        """Human-readable normalized representation. Preserves clinical punctuation."""
        if not value:
            return ""
        
        value = value.strip().lower()
        # Normalize typographic dashes and plus/multiply signs
        for old, new in [("–", "-"), ("—", "-"), ("−", "-"), ("＋", "+"), ("×", "x")]:
            value = value.replace(old, new)
        return re.sub(r"\s+", " ", value).strip()

    @staticmethod
    def lexical_text(value: str) -> str:
        """Matching representation. Keeps critical signs attached to tokens (e.g., hco3-)."""
        value = MedicalTermNormalizer.canonical_text(value)
        # Keep + and - attached to tokens
        value = re.sub(r"\s*([+-])\s*", r"\1", value)
        # Convert purely structural punctuation into spaces
        value = re.sub(r"[/,:;()[\]{}]+", " ", value)
        return re.sub(r"\s+", " ", value).strip()


"""This file implements length-aware thresholding
, preventing short acronyms from being heavily penalized by standard string distance algorithms."""
class MatchingPolicy:
    @staticmethod
    def auto_threshold(term: str) -> float:
        length = len(term.replace(" ", ""))
        if length <= 3: return 98.0
        if length <= 5: return 94.0
        if length <= 8: return 91.0
        return 88.0

    @staticmethod
    def review_threshold(term: str) -> float:
        length = len(term.replace(" ", ""))
        if length <= 3: return 92.0
        if length <= 5: return 88.0
        if length <= 8: return 84.0
        return 80.0