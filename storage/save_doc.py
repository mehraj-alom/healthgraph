import hashlib
import os
from typing import BinaryIO
from uuid import UUID

from fastapi import UploadFile
from logger import logger

from core.config import Settings

STORAGE_DIR = Settings().STORAGE_DIR

class StorageService:
    """Service for storage of any documents or files in the application.
    calculates the hash of the file and saves it to the storage directory.
    methods - calculate_file_hash, save_document
    args : 
        save_document_args = patient_id, document_id, file"""
    @staticmethod
    def calculate_file_hash(file: BinaryIO) -> str:
        """Calculate the SHA256 hash of a file."""
        sha256 = hashlib.sha256()
        file.seek(0)  # Ensure at the start of the file
        while chunk := file.read(65536): # 65536 bytes at a time
            sha256.update(chunk)
        file.seek(0)  # Reset file pointer to the start after reading
        return sha256.hexdigest()

    @staticmethod
    def save_document(file: UploadFile, patient_id: UUID, document_id: UUID) -> str:
        """Save the uploaded document to the storage directory."""
        # Ensure the storage directory exists
        os.makedirs(STORAGE_DIR, exist_ok=True)

        # Create a unique filename using patient_id and original filename
        file.extension = os.path.splitext(file.filename)[-1]
        file_path = os.path.join(STORAGE_DIR, f"{patient_id}_{document_id}{file.extension}")

        # Resolve to absolute path for logging
        abs_path = os.path.abspath(file_path)
        logger.info(f"[Storage] Saving document to: {abs_path}")

        file.file.seek(0)  # Ensure at the start of the file before saving
        with open(file_path, "wb") as buffer:
            while chunk := file.file.read(65536):
                buffer.write(chunk)

        file_exists = os.path.exists(abs_path)
        file_size = os.path.getsize(abs_path) if file_exists else 0
        logger.info(f"[Storage] File exists after save: {file_exists}, size: {file_size} bytes")

        return file_path