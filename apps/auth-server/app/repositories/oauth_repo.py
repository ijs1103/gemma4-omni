"""OAuth 자격증명(OAuthCredential) 리포지토리.

oauth_credentials 테이블에 대한 비동기 CRUD 작업을 제공한다.
제공자로부터 받은 토큰(access, refresh, id_token 등)을 암호화하여 저장·갱신한다.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.oauth_credential import OAuthCredential


class OAuthCredentialRepository:
    """OAuth 자격증명 모델에 대한 데이터 액세스 메서드를 제공하는 리포지토리."""

    async def get_by_social_account_id(
        self,
        db: AsyncSession,
        social_account_id: UUID,
    ) -> OAuthCredential | None:
        """소셜 계정 ID로 OAuth 자격증명을 조회한다.

        Args:
            db: 비동기 데이터베이스 세션.
            social_account_id: 소셜 계정 UUID.

        Returns:
            해당 OAuth 자격증명 또는 None.
        """
        stmt = select(OAuthCredential).where(
            OAuthCredential.social_account_id == social_account_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert(
        self,
        db: AsyncSession,
        *,
        social_account_id: UUID,
        access_token_enc: str | None = None,
        refresh_token_enc: str | None = None,
        id_token_enc: str | None = None,
        token_type: str | None = None,
        scope: str | None = None,
        expires_at: datetime | None = None,
    ) -> OAuthCredential:
        """OAuth 자격증명을 생성하거나 기존 레코드를 갱신한다 (upsert).

        기존 자격증명이 존재하면 전달된 필드만 업데이트하고,
        없으면 새로 생성한다.

        Args:
            db: 비동기 데이터베이스 세션.
            social_account_id: 소셜 계정 UUID.
            access_token_enc: 암호화된 액세스 토큰.
            refresh_token_enc: 암호화된 리프레시 토큰.
            id_token_enc: 암호화된 ID 토큰.
            token_type: 토큰 유형 (예: 'Bearer').
            scope: 인가 범위.
            expires_at: 액세스 토큰 만료 시각.

        Returns:
            생성 또는 갱신된 OAuthCredential 모델 인스턴스.
        """
        credential = await self.get_by_social_account_id(db, social_account_id)

        if credential is None:
            credential = OAuthCredential(
                social_account_id=social_account_id,
                access_token_enc=access_token_enc,
                refresh_token_enc=refresh_token_enc,
                id_token_enc=id_token_enc,
                token_type=token_type,
                scope=scope,
                expires_at=expires_at,
            )
            db.add(credential)
        else:
            # None이 아닌 값만 업데이트하여 기존 값 보존
            update_fields = {
                "access_token_enc": access_token_enc,
                "refresh_token_enc": refresh_token_enc,
                "id_token_enc": id_token_enc,
                "token_type": token_type,
                "scope": scope,
                "expires_at": expires_at,
            }
            for field, value in update_fields.items():
                if value is not None:
                    setattr(credential, field, value)

        await db.flush()
        return credential


oauth_credential_repo = OAuthCredentialRepository()
"""모듈 레벨 싱글턴 인스턴스."""
