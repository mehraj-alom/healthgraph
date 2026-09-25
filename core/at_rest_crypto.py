"""Authenticated at-rest encryption for durable document bytes.

PASSIVE and deployment-lite by design:

  * Writes are encrypted transparently (AES-256-GCM) before the bytes land in
    the ``document_blobs`` table; reads detect the envelope and decrypt it,
    while passing through legacy plaintext rows unchanged — so existing rows
    need no migration and the feature ships with zero downtime.
  * The key is either ``DOC_ENCRYPTION_KEY`` (base64 encoding of exactly 32
    bytes) or, when unset, derived deterministically from ``secret_key`` via
    HKDF-SHA256. Production SHOULD set ``DOC_ENCRYPTION_KEY`` so existing
    document ciphertext survives a ``secret_key`` rotation.
  * The ``document_id`` is bound as associated data (AAD), so ciphertext
    cannot be swapped between documents (or rows) without failing
    authentication.

Threat model: this defends the document bytes at rest — a database dump, a
slow-loris backup read, or an unauthorized console SELECT no longer yields
readable health records. It is defense-in-depth, NOT a substitute for
access control: the key lives in the same deployment as the ciphertext.
"""

import os
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Envelope layout: 4-byte magic || 12-byte nonce || AES-256-GCM ciphertext
# || 16-byte tag. The magic byte-prefix is the detector that distinguishes
# encrypted rows from legacy plaintext rows on read.
_MAGIC = b"HG01"
_NONCE_LEN = 12
_TAG_LEN = 16
_KEY_INFO = b"healthgraph-document-at-rest-v1"


class AtRestDecryptionError(Exception):
    """An envelope failed authentication/decryption (key or AAD mismatch)."""


def decode_key(value: str) -> Optional[bytes]:
    """Return the raw 32-byte key for a base64 setting, or None when empty.

    Raises ValueError when the value is present but not a base64 encoding of
    exactly 32 bytes, so a malformed configuration never silently falls back
    to the derived key.
    """
    value = value.strip()
    if not value:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        key = urlsafe_b64decode(padded.encode("ascii"))
    except Exception as exc:  # noqa: BLE001 — single uniform config error
        raise ValueError("DOC_ENCRYPTION_KEY must be valid base64.") from exc
    if len(key) != 32:
        raise ValueError("DOC_ENCRYPTION_KEY must decode to exactly 32 bytes.")
    return key


def _load_key() -> bytes:
    # Local import: core.config's production gate imports decode_key from
    # this module, so a module-level settings import would be circular.
    from core.config import settings

    key = decode_key(settings.DOC_ENCRYPTION_KEY)
    if key is not None:
        return key
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_KEY_INFO,
    ).derive(settings.secret_key.encode("utf-8"))


def encrypt_bytes(data: bytes, *, aad: bytes = b"") -> bytes:
    """Encrypt and authenticate ``data``; empty input is returned unchanged.

    Envelope layout: ``_MAGIC || 12-byte nonce || ciphertext || 16-byte tag``.
    """
    if not data:
        return data
    nonce = os.urandom(_NONCE_LEN)
    sealed = AESGCM(_load_key()).encrypt(nonce, data, aad)
    return _MAGIC + nonce + sealed  # sealed == ciphertext || tag


def decrypt_bytes(data: bytes, *, aad: bytes = b"") -> bytes:
    """Decrypt an envelope; pass through legacy plaintext rows unchanged.

    Detection is the 4-byte magic prefix. On authentication/decryption
    failure, raises AtRestDecryptionError instead of silently returning
    corrupt bytes. An implausibly short "envelope" is treated as legacy
    plaintext so stray prefixes can never break a read.
    """
    if not data or not data.startswith(_MAGIC):
        return data
    body = data[len(_MAGIC):]
    if len(body) < _NONCE_LEN + _TAG_LEN + 1:
        return data  # not a real envelope — legacy plaintext
    nonce, sealed = body[:_NONCE_LEN], body[_NONCE_LEN:]
    try:
        return AESGCM(_load_key()).decrypt(nonce, sealed, aad)
    except Exception as exc:  # InvalidTag/ValueError — never log internals
        raise AtRestDecryptionError(
            "Document bytes failed authentication/decryption. This usually "
            "means the at-rest encryption key does not match the key used to "
            "encrypt the stored document."
        ) from exc


def _aad_for(document_id) -> bytes:
    return str(document_id).encode("utf-8")


def new_key_display() -> bytes:
    """Generate a Fernet-format key suitable for DOC_ENCRYPTION_KEY."""
    return urlsafe_b64encode(os.urandom(32))