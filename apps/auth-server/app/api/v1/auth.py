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
    NativeLoginRequest,
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


from fastapi.responses import HTMLResponse, RedirectResponse

@router.get("/social/mobile-landing")
async def social_mobile_landing(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    """카카오/네이버 모바일 로그인 우회를 위한 HTML 랜딩 페이지.
    
    인앱 브라우저를 앱의 커스텀 스킴으로 리다이렉트 시킵니다.
    """
    query_params = str(request.query_params)
    target_url = f"com.mobile://oauth/callback?{query_params}" if query_params else "com.mobile://oauth/callback"
    
    # Android Chrome 호환용 Intent URL
    intent_url = f"intent://oauth/callback?{query_params}#Intent;scheme=com.mobile;package=com.mobile;end;"
    
    html_content = f"""
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>로그인 완료 중...</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
            * {{
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }}
            body {{
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, #0f0c20 0%, #15102a 50%, #06020f 100%);
                color: #ffffff;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                overflow: hidden;
            }}
            .container {{
                background: rgba(255, 255, 255, 0.03);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 24px;
                padding: 40px 30px;
                width: 90%;
                max-width: 400px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                transform: translateY(0);
                animation: float 6s ease-in-out infinite;
            }}
            @keyframes float {{
                0% {{ transform: translateY(0px); }}
                50% {{ transform: translateY(-10px); }}
                100% {{ transform: translateY(0px); }}
            }}
            .logo-glow {{
                width: 72px;
                height: 72px;
                background: linear-gradient(135deg, #8a2be2 0%, #4a00e0 100%);
                border-radius: 50%;
                margin: 0 auto 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 0 30px rgba(138, 43, 226, 0.5);
                position: relative;
            }}
            .logo-glow::after {{
                content: '';
                position: absolute;
                top: -4px; left: -4px; right: -4px; bottom: -4px;
                border-radius: 50%;
                background: linear-gradient(135deg, #c77dff, #e0aaff);
                z-index: -1;
                opacity: 0.3;
                filter: blur(8px);
                animation: pulse 2s infinite;
            }}
            @keyframes pulse {{
                0% {{ transform: scale(1); opacity: 0.3; }}
                50% {{ transform: scale(1.15); opacity: 0.6; }}
                100% {{ transform: scale(1); opacity: 0.3; }}
            }}
            .logo-icon {{
                font-size: 32px;
            }}
            h1 {{
                font-size: 24px;
                font-weight: 700;
                margin-bottom: 12px;
                background: linear-gradient(135deg, #ffffff 0%, #a2a2d0 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{
                font-size: 14px;
                color: #a2a2d0;
                line-height: 1.6;
                margin-bottom: 30px;
            }}
            .btn {{
                display: inline-block;
                width: 100%;
                padding: 16px;
                background: linear-gradient(90deg, #7b2cbf 0%, #9d4edd 100%);
                color: #ffffff;
                text-decoration: none;
                font-weight: 600;
                border-radius: 14px;
                box-shadow: 0 8px 20px rgba(157, 78, 221, 0.3);
                transition: all 0.3s ease;
                border: none;
                cursor: pointer;
                outline: none;
            }}
            .btn:hover {{
                transform: translateY(-2px);
                box-shadow: 0 12px 24px rgba(157, 78, 221, 0.5);
                background: linear-gradient(90deg, #8f3bf0 0%, #b260f8 100%);
            }}
            .btn:active {{
                transform: translateY(1px);
            }}
            .fallback-text {{
                margin-top: 20px;
                font-size: 12px;
                color: #5c5c8a;
            }}
        </style>
        <script>
            function performRedirect() {{
                const userAgent = navigator.userAgent.toLowerCase();
                const isAndroid = userAgent.indexOf('android') > -1;
                const isChrome = userAgent.indexOf('chrome') > -1;
                
                // 안드로이드 크롬의 경우 공식 인텐트 주소, 그 외엔 일반 커스텀 스킴
                const redirectUrl = (isAndroid && isChrome) ? "{intent_url}" : "{target_url}";
                
                // 자동 리다이렉트 실행
                window.location.href = redirectUrl;
            }}
            
            window.onload = function() {{
                // 0.5초 대기 후 리다이렉트 시도
                setTimeout(performRedirect, 500);
            }};
        </script>
    </head>
    <body>
        <div class="container">
            <div class="logo-glow">
                <span class="logo-icon">✨</span>
            </div>
            <h1>로그인 완료 중</h1>
            <p>안전하게 인증을 완료하고 앱으로 이동하고 있습니다. 잠시만 기다려주세요.</p>
            <a class="btn" href="{target_url}" onclick="performRedirect();">앱으로 돌아가기</a>
            <div class="fallback-text">
                자동으로 이동하지 않을 경우 위의 버튼을 직접 눌러주세요.
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


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


@router.post("/social/{provider}/native-callback", response_model=AuthSessionResponse)
async def native_auth_callback(
    provider: str,
    payload: NativeLoginRequest,
    db: SessionDep,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    """네이티브 SDK 로그인 콜백 처리.

    모바일 네이티브 SDK(카카오, 네이버 등)에서 발급받은
    access_token으로 사용자를 인증하고 세션을 생성한다.
    """
    device_info = request.headers.get("User-Agent")
    ip_address = request.client.host if request.client else None

    session_response = await social_auth_service.authenticate_with_token(
        provider=provider,
        access_token=payload.access_token,
        platform=payload.platform,
        db=db,
        device_info=device_info,
        ip_address=ip_address,
    )

    await db.commit()

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
