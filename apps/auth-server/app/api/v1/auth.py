import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.schemas.auth import (
    AuthSessionResponse,
    AuthUserPayload,
    MessageResponse,
    RefreshRequest,
    RefreshResponse,
    SocialCallbackRequest,
    SocialStartResponse,
)
from app.services.auth.session_service import SessionService
from app.services.auth.social_service import SocialAuthService
from app.services.auth.token_service import token_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Auth"])

# 서비스 인스턴스 (의존성 주입 대신 모듈 레벨에서 초기화하여 사용)
social_auth_service = SocialAuthService()
session_service_instance = SessionService()


class SocialStartQuery(BaseModel):
    redirect_uri: str
    platform: str


from fastapi import Response

@router.get("/social/{provider}/start", response_model=SocialStartResponse)
async def start_login(
    provider: str,
    redirect_uri: str,
    platform: str,
    response: Response,
) -> SocialStartResponse:
    """소셜 로그인 시작 (authorize URL 반환)."""
    # 브라우저가 이전 state를 캐싱하여 재사용하는 것을 방지
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return await social_auth_service.start_login(
        provider=provider,
        redirect_uri=redirect_uri,
        platform=platform,
    )


@router.post("/social/{provider}/callback", response_model=AuthSessionResponse)
async def auth_callback(
    provider: str,
    payload: SocialCallbackRequest,
    db: SessionDep,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    """소셜 로그인 콜백 처리 및 세션 생성."""
    # 기기 정보, IP 추출
    device_info = request.headers.get("User-Agent")
    ip_address = request.client.host if request.client else None

    # 콜백 처리 (사용자 upsert, 토큰 발급)
    session_response = await social_auth_service.authenticate(
        provider=provider,
        payload=payload,
        db=db,
        device_info=device_info,
        ip_address=ip_address,
    )

    # 모든 처리가 성공하면 트랜잭션 커밋
    await db.commit()

    # 웹 클라이언트인 경우 refresh_token을 HttpOnly 쿠키로 설정하고 바디에서 제거
    if payload.platform == "web" and session_response.refresh_token:
        response.set_cookie(
            key="refresh_token",
            value=session_response.refresh_token,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=True,  # HTTPS 강제 (로컬 개발 시 주의 필요, 보통 Nginx 뒤에 있거나 localhost에서는 브라우저가 예외 처리)
            samesite="lax",
        )
        session_response.refresh_token = None

    return session_response


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    db: SessionDep,
    response: Response,
    payload: Optional[RefreshRequest] = None,
    refresh_token_cookie: Annotated[Optional[str], Cookie(alias="refresh_token")] = None,
) -> RefreshResponse:
    """액세스 토큰 갱신 (Refresh Token Rotation)."""
    # RN 등에서 body로 보낸 토큰 또는 웹에서 쿠키로 보낸 토큰 확인
    token_to_use = None
    if payload and payload.refresh_token:
        token_to_use = payload.refresh_token
    elif refresh_token_cookie:
        token_to_use = refresh_token_cookie

    if not token_to_use:
        from app.core.exceptions import InvalidTokenError
        raise InvalidTokenError("리프레시 토큰이 제공되지 않았습니다.")

    new_access, new_refresh, _ = await session_service_instance.refresh_session(
        db=db, old_refresh_token=token_to_use
    )
    
    await db.commit()

    # 쿠키 갱신 로직 (입력받은 곳에 맞춰서 갱신)
    is_web = refresh_token_cookie is not None and (payload is None or not payload.refresh_token)
    
    if is_web:
        response.set_cookie(
            key="refresh_token",
            value=new_refresh,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=True,
            samesite="lax",
        )
        returned_refresh = None
    else:
        returned_refresh = new_refresh

    return RefreshResponse(
        access_token=new_access,
        refresh_token=returned_refresh,
        expires_in=token_service.get_access_token_ttl_seconds(),
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    current_user: CurrentUser,
    db: SessionDep,
    response: Response,
    request: Request,
) -> MessageResponse:
    """로그아웃 (현재 세션 폐기)."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = token_service.verify_access_token(token)
            session_id_str = payload.get("sid")
            if session_id_str:
                from uuid import UUID
                await session_service_instance.revoke_session(db, UUID(session_id_str))
                await db.commit()
        except Exception:
            pass  # 토큰 디코딩 실패 시 무시

    # 쿠키 삭제 (웹 클라이언트)
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return MessageResponse(message="성공적으로 로그아웃되었습니다.")


@router.get("/me", response_model=AuthUserPayload)
async def get_me(
    current_user: CurrentUser,
    db: SessionDep,
) -> AuthUserPayload:
    """내 정보 조회."""
    # 연동된 프로바이더 목록 조회
    from app.repositories.social_repo import social_account_repo
    social_accounts = await social_account_repo.get_by_user_id(db, current_user.id)
    linked_providers = [sa.provider for sa in social_accounts]

    return AuthUserPayload(
        id=str(current_user.id),
        email=current_user.primary_email,
        display_name=current_user.display_name,
        profile_image_url=current_user.profile_image_url,
        linked_providers=linked_providers,
    )


@router.post("/social/{provider}/link", response_model=AuthUserPayload)
async def link_social_account(
    provider: str,
    payload: SocialCallbackRequest,
    current_user: CurrentUser,
    db: SessionDep,
) -> AuthUserPayload:
    """기존 세션에 새로운 소셜 계정 연결."""
    await social_auth_service.link_account(
        provider=provider,
        payload=payload,
        user_id=current_user.id,
        db=db,
    )
    await db.commit()
    
    # 갱신된 내 정보 반환
    from app.repositories.social_repo import social_account_repo
    social_accounts = await social_account_repo.get_by_user_id(db, current_user.id)
    linked_providers = [sa.provider for sa in social_accounts]

    return AuthUserPayload(
        id=str(current_user.id),
        email=current_user.primary_email,
        display_name=current_user.display_name,
        profile_image_url=current_user.profile_image_url,
        linked_providers=linked_providers,
    )


@router.delete("/social/{provider}/unlink", response_model=MessageResponse)
async def unlink_social_account(
    provider: str,
    current_user: CurrentUser,
    db: SessionDep,
) -> MessageResponse:
    """연결된 소셜 계정 해제."""
    from app.repositories.social_repo import social_account_repo
    from app.core.exceptions import OAuthProviderError
    
    social_accounts = await social_account_repo.get_by_user_id(db, current_user.id)
    if len(social_accounts) <= 1:
        raise OAuthProviderError("최소 1개 이상의 소셜 계정이 연결되어 있어야 합니다.")
        
    target_account = next((sa for sa in social_accounts if sa.provider == provider), None)
    if not target_account:
        raise OAuthProviderError(f"{provider} 계정이 연동되어 있지 않습니다.")
        
    # 계정 삭제 (연쇄 삭제로 자격증명도 삭제됨)
    await db.delete(target_account)
    
    # 보안 강화를 위해 해당 사용자의 모든 활성 세션 폐기(강제 로그아웃) - 옵션이지만 보통 권장됨
    # 여기서는 유지하기로 함 (또는 정책에 따라 추가 가능)
    
    await db.commit()
    return MessageResponse(message=f"{provider} 계정 연동이 성공적으로 해제되었습니다.")

@router.delete("/me", response_model=MessageResponse)
async def delete_account(
    response: Response,
    current_user: CurrentUser,
    db: SessionDep,
) -> MessageResponse:
    """현재 사용자의 계정을 탈퇴(삭제)합니다.
    
    계정, 소셜 연동 정보, 세션 데이터 등이 모두 삭제됩니다.
    """
    from app.repositories.user_repo import user_repo
    
    # 1. DB에서 사용자 완전 삭제 (Cascade에 의해 SocialAccount, AuthSession 모두 삭제됨)
    await user_repo.delete(db, current_user)
    await db.commit()
    
    # 2. 쿠키(세션) 무효화
    response.delete_cookie(
        key="refresh_token",
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    
    return MessageResponse(message="계정이 성공적으로 탈퇴 처리되었습니다.")
