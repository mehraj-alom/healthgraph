from datetime import date, datetime, timedelta
import hashlib
import hmac

class DateTransformer:
    def __init__(self, secret: bytes):
        self.secret = secret

    def _offset_for_subject(self, subject_id: str) -> int:
        digest = hmac.new(
            self.secret,
            subject_id.encode(),
            hashlib.sha256,
        ).digest()

        # Range: -365 to +365 days offset
        number = int.from_bytes(digest[:4], "big")
        return (number % 731) - 365

    def transform_date(self, value: date, subject_id: str) -> date:
        offset = self._offset_for_subject(subject_id)
        return value + timedelta(days=offset)

    def transform_datetime(self, value: datetime, subject_id: str) -> datetime:
        offset = self._offset_for_subject(subject_id)
        return value + timedelta(days=offset)

    @staticmethod
    def transform_age(age: int) -> str:
        """HIPAA Safe Harbor: Ages 90 and over must be aggregated."""
        if age >= 90:
            return "90+"
        return str(age)