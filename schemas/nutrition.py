from datetime import date
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ScanItem(BaseModel):
    label: str
    grams: float = Field(ge=0)
    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    # Display-only micros, USDA-sourced: None on VLM-fallback items (never
    # estimated) — the client renders values or an honest absence.
    fiber_g: Optional[float] = Field(default=None, ge=0)
    sugar_g: Optional[float] = Field(default=None, ge=0)
    sodium_mg: Optional[float] = Field(default=None, ge=0)


class AnalyzeResponse(BaseModel):
    items: list[ScanItem]
    total_kcal: int = Field(ge=0)
    confidence: Literal["low", "med", "high"]
    note: str


class FoodEntryIn(BaseModel):
    """One identified food item as submitted by the client (scan or manual)."""

    label: str = Field(min_length=1, max_length=255)
    portion_g: Optional[float] = Field(default=None, ge=0)
    volume_ml: Optional[float] = Field(default=None, ge=0)
    kcal: Optional[float] = Field(default=None, ge=0)
    protein_g: Optional[float] = Field(default=None, ge=0)
    carbs_g: Optional[float] = Field(default=None, ge=0)
    fat_g: Optional[float] = Field(default=None, ge=0)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    fdc_id: Optional[str] = Field(default=None, max_length=32)


class FoodScanLog(BaseModel):
    items: list[FoodEntryIn] = Field(min_length=1, max_length=50)
    total_kcal: Optional[int] = Field(default=None, ge=0)
    overall_confidence: Optional[Literal["low", "med", "high"]] = None
    status: Literal["ai_estimated", "user_confirmed"] = "ai_estimated"
    model: Optional[str] = Field(default=None, max_length=128)
    model_version: Optional[str] = Field(default=None, max_length=64)
    meal_type: Optional[str] = Field(default=None, max_length=20)
    log_date: Optional[date] = None
    photo_hash: Optional[str] = Field(default=None, max_length=128)


class FoodEntryOut(BaseModel):
    entry_id: UUID
    label: str
    portion_g: Optional[float] = None
    kcal: Optional[float] = None
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    confidence: Optional[float] = None
    corrected: bool = False
    corrected_label: Optional[str] = None


class FoodScanOut(BaseModel):
    scan_id: UUID
    status: str
    total_kcal: Optional[int] = None
    entries: list[FoodEntryOut] = Field(default_factory=list)


class BarcodeNutrientsOut(BaseModel):
    kcal_per_100g: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class BarcodeProductOut(BaseModel):
    barcode: str
    name: str
    brand: str = ""
    nutrients: BarcodeNutrientsOut
    serving_size: str = ""
    image_url: str = ""
    source: str = "openfoodfacts"


class FoodCorrectIn(BaseModel):
    entry_id: UUID
    corrected_label: str = Field(min_length=1, max_length=255)
