"""Samples API router -- GET /samples with pagination and filtering."""

from fastapi import APIRouter

router = APIRouter(prefix="/samples", tags=["samples"])
