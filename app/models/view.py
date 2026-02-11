"""Pydantic models for saved view configurations."""

from datetime import datetime

from pydantic import BaseModel


class SavedViewCreate(BaseModel):
    """Request body for creating a saved view."""

    dataset_id: str
    name: str
    filters: dict  # Serialized filter state from frontend


class SavedViewResponse(BaseModel):
    """Single saved view returned by the API."""

    id: str
    dataset_id: str
    name: str
    filters: dict
    created_at: datetime
    updated_at: datetime


class SavedViewListResponse(BaseModel):
    """List of saved views for a dataset."""

    views: list[SavedViewResponse]
