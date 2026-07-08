from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers

def create_app() -> FastAPI:
    """FastAPI 애플리케이션 생성 및 초기화."""
    app = FastAPI(
        title="Antigravity Auth Server",
        description="로컬 우선 AI 채팅 앱을 위한 소셜 로그인 인증 서버",
        version="1.0.0",
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

    # 라우터 마운트
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["System"])
    async def health_check():
        """헬스 체크 엔드포인트."""
        return {"status": "ok"}

    return app

app = create_app()
