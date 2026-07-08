from fastapi import APIRouter

from app.api.v1.auth import router as auth_router

# API v1 통합 라우터
api_router = APIRouter()

# 하위 라우터 포함
api_router.include_router(auth_router)
