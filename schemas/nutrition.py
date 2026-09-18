from typing import Literal

from pydantic import BaseModel, Field


class ScanItem(BaseModel):
    label: str
    grams: float = Field(ge=0)
    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)


class AnalyzeResponse(BaseModel):
    items: list[ScanItem]
    total_kcal: int = Field(ge=0)
    confidence: Literal["low", "med", "high"]
    note: str
