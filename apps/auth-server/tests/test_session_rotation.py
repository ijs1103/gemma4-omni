import pytest
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.auth.session_service import SessionService, SessionRevokedError
from app.core.exceptions import InvalidTokenError

@pytest.mark.asyncio
async def test_session_create_and_refresh(db_session: AsyncSession):
    """정상적인 세션 생성 및 Refresh Token Rotation 갱신을 검증한다."""
    session_service = SessionService()
    user_id = uuid4()
    original_refresh_token = "test_refresh_token_string_123"

    # 1. 세션 생성
    auth_session = await session_service.create_session(
        db=db_session,
        user_id=user_id,
        refresh_token=original_refresh_token,
        provider="google"
    )
    assert auth_session.user_id == user_id
    assert auth_session.is_revoked is False

    # 2. 세션 갱신 (Rotation)
    new_access, new_refresh, new_session = await session_service.refresh_session(
        db=db_session,
        old_refresh_token=original_refresh_token
    )

    assert new_access is not None
    assert new_refresh is not None
    assert new_refresh != original_refresh_token
    assert new_session.user_id == user_id
    assert new_session.is_revoked is False

@pytest.mark.asyncio
async def test_session_rotation_reuse_detection(db_session: AsyncSession):
    """이미 폐기된(revoked) 토큰 재사용 시 해당 사용자의 모든 세션이 무효화되는지 검증한다."""
    session_service = SessionService()
    user_id = uuid4()
    token_v1 = "token_version_1"

    # 1. 세션 생성
    await session_service.create_session(
        db=db_session,
        user_id=user_id,
        refresh_token=token_v1,
        provider="google"
    )

    # 2. 1회 갱신 -> token_v1 은 revoked 됨, token_v2 생성됨
    _, token_v2, _ = await session_service.refresh_session(
        db=db_session,
        old_refresh_token=token_v1
    )

    # 3. 이미 revoked 된 token_v1 으로 다시 갱신 시도 (공격자 재사용 시나리오)
    with pytest.raises(SessionRevokedError):
        await session_service.refresh_session(
            db=db_session,
            old_refresh_token=token_v1
        )

    # 4. 공격 시도로 인해 정상 token_v2 도 무효화되어 갱신 불가해야 함
    with pytest.raises((InvalidTokenError, SessionRevokedError)):
        await session_service.refresh_session(
            db=db_session,
            old_refresh_token=token_v2
        )
