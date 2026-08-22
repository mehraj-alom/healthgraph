import hashlib
import hmac

class Pseudonymizer:
    def __init__(self, secret: bytes):
        self.secret = secret

    def pseudonym(self, entity_type: str, value: str) -> str:
        normalized = value.strip().lower()
        
        digest = hmac.new(
            self.secret,
            normalized.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:12]

        return f"<{entity_type}_{digest}>"