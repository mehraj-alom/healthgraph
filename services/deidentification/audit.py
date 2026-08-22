from collections import Counter
import hashlib
import hmac

class DeIdentificationAudit:
    def __init__(self, secret: bytes):
        self.secret = secret

    def hash_value(self, value: str) -> str:
        return hmac.new(
            self.secret,
            value.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def build(self, entities):
        counts = Counter(entity.entity_type for entity in entities)
        return {
            "policy_version": "v1",
            "entity_counts": dict(counts),
            "total_entities": len(entities),
        }