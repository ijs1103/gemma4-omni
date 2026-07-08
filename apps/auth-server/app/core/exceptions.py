"""커스텀 예외 및 전역 예외 핸들러 모듈.

OAuth 인증 흐름에서 발생할 수 있는 다양한 에러 상황을 세분화된 예외 클래스로
정의하고, FastAPI 앱에 등록할 수 있는 전역 예외 핸들러를 제공한다.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


# ── 기본 인증 예외 ────────────────────────────────────────────────


class AuthError(HTTPException):
    """인증 관련 기본 예외.

    모든 커스텀 인증 예외의 부모 클래스이다.
    """

    def __init__(
        self,
        detail: str = "인증 오류가 발생했습니다.",
        status_code: int = 401,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail)


# ── OAuth 프로바이더 예외 ─────────────────────────────────────────


class OAuthProviderError(AuthError):
    """OAuth 프로바이더와의 통신 중 발생한 오류."""

    def __init__(self, detail: str = "OAuth 프로바이더 오류가 발생했습니다.") -> None:
        super().__init__(detail=detail, status_code=502)


# ── 토큰 관련 예외 ────────────────────────────────────────────────


class TokenExpiredError(AuthError):
    """토큰이 만료되었을 때 발생하는 오류."""

    def __init__(self, detail: str = "토큰이 만료되었습니다.") -> None:
        super().__init__(detail=detail, status_code=401)


class InvalidTokenError(AuthError):
    """유효하지 않은 토큰일 때 발생하는 오류."""

    def __init__(self, detail: str = "유효하지 않은 토큰입니다.") -> None:
        super().__init__(detail=detail, status_code=401)


# ── 사용자 관련 예외 ──────────────────────────────────────────────


class UserNotFoundError(AuthError):
    """사용자를 찾을 수 없을 때 발생하는 오류."""

    def __init__(self, detail: str = "사용자를 찾을 수 없습니다.") -> None:
        super().__init__(detail=detail, status_code=404)


class DuplicateAccountError(AuthError):
    """이미 존재하는 계정으로 가입을 시도할 때 발생하는 오류."""

    def __init__(self, detail: str = "이미 연결된 소셜 계정입니다.") -> None:
        super().__init__(detail=detail, status_code=409)


# ── OAuth State 예외 ──────────────────────────────────────────────


class InvalidStateError(AuthError):
    """OAuth state 파라미터가 유효하지 않거나 만료되었을 때 발생하는 오류."""

    def __init__(self, detail: str = "유효하지 않은 OAuth state입니다.") -> None:
        super().__init__(detail=detail, status_code=400)


# ── 전역 예외 핸들러 등록 ─────────────────────────────────────────


def register_exception_handlers(app: FastAPI) -> None:
    """FastAPI 앱에 전역 예외 핸들러를 등록한다.

    AuthError 계층의 모든 예외를 일관된 JSON 응답으로 변환한다.

    Args:
        app: FastAPI 애플리케이션 인스턴스.
    """

    @app.exception_handler(AuthError)
    async def auth_error_handler(_request: Request, exc: AuthError) -> JSONResponse:
        """AuthError 및 하위 예외를 처리한다."""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": type(exc).__name__,
                "detail": exc.detail,
            },
        )
