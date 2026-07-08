from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import InvalidTokenError, UserNotFoundError
from app.db.session import get_db_session
from app.models.user import User
from app.repositories.user_repo import user_repo
from app.services.auth.token_service import token_service

# Bearer 토큰 추출을 위한 HTTPBearer (Swagger UI와 연동됨)
# scheme_name을 설정하여 Swagger UI에서 보기 좋게 표시할 수 있습니다.
bearer_scheme = HTTPBearer(auto_error=False)

# 의존성 타입 힌트
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]

async def get_current_user(
    db: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]
) -> User:
    """헤더의 JWT를 검증하고 현재 인증된 사용자를 반환한다.
    
    Raises:
        InvalidTokenError: 헤더가 없거나 토큰이 유효하지 않은 경우.
        NotFoundError: DB에서 사용자를 찾을 수 없는 경우.
    """
    if not credentials or not credentials.credentials:
        raise InvalidTokenError("액세스 토큰이 제공되지 않았습니다.")
    
    # 1. JWT 유효성 검증 및 페이로드 디코딩
    payload = token_service.verify_access_token(credentials.credentials)
    
    # 2. 사용자 식별자(sub) 추출
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise InvalidTokenError("토큰에 사용자 식별 정보가 없습니다.")
        
    try:
        user_id = UUID(user_id_str)
    except ValueError:
        raise InvalidTokenError("유효하지 않은 사용자 ID 형식입니다.")
        
    # 3. DB에서 사용자 조회
    user = await user_repo.get_by_id(db, user_id)
    if not user:
        raise UserNotFoundError("사용자를 찾을 수 없습니다.")
        
    if user.status != "active":
        raise InvalidTokenError("비활성화된 계정입니다.")
        
    return user

# 편의를 위한 타입 힌트
CurrentUser = Annotated[User, Depends(get_current_user)]
