import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.db.base import Base
from app.db.session import engine
import app.models  # noqa: F401 - ensure all ORM models are registered in Base.metadata

logger = logging.getLogger("auth-server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작 시 DB 테이블 자동 생성 및 초기화."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("데이터베이스 테이블 자동 생성 및 초기화 완료.")
    except Exception as e:
        logger.error("DB 테이블 생성 실패: %s", e)
    yield


def create_app() -> FastAPI:
    """FastAPI 애플리케이션 생성 및 초기화."""
    app = FastAPI(
        title="Antigravity Auth Server",
        description="로컬 우선 AI 채팅 앱을 위한 소셜 로그인 인증 서버",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS 미들웨어 설정
    if settings.CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[str(origin) for origin in settings.CORS_ORIGINS],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # 커스텀 예외 핸들러 등록
    register_exception_handlers(app)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception("서버 내부 오류 발생: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": "InternalServerError", "detail": str(exc)},
        )

    # 라우터 마운트
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["System"])
    async def health_check():
        """헬스 체크 엔드포인트."""
        return {"status": "ok"}

    return app


app = create_app()
