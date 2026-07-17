"""소셜 계정(SocialAccount) 리포지토리.

social_accounts 테이블에 대한 비동기 CRUD 작업을 제공한다.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.social_account import SocialAccount


class SocialAccountRepository:
    """소셜 계정 모델에 대한 데이터 액세스 메서드를 제공하는 리포지토리."""

    async def get_by_provider_and_id(
        self,
        db: AsyncSession,
        provider: str,
        provider_user_id: str,
    ) -> Optional[SocialAccount]:
        """제공자와 제공자측 사용자 ID로 소셜 계정을 조회한다.

        Args:
            db: 비동기 데이터베이스 세션.
            provider: 소셜 제공자 이름 (예: 'google').
            provider_user_id: 제공자 측 고유 사용자 ID.

        Returns:
            해당 소셜 계정 모델 인스턴스 또는 None.
        """
        stmt = select(SocialAccount).where(
            SocialAccount.provider == provider,
            SocialAccount.provider_user_id == provider_user_id,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_user_id(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> list[SocialAccount]:
        """특정 사용자에 연결된 모든 소셜 계정을 조회한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user_id: 사용자 UUID.

        Returns:
            해당 사용자의 소셜 계정 목록.
        """
        stmt = select(SocialAccount).where(SocialAccount.user_id == user_id)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def create(
        self,
        db: AsyncSession,
        *,
        user_id: UUID,
        provider: str,
        provider_user_id: str,
        provider_email: Optional[str] = None,
        email_verified: Optional[bool] = None,
        raw_profile: Optional[dict] = None,
    ) -> SocialAccount:
        """새로운 소셜 계정을 생성한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user_id: 연결할 사용자 UUID.
            provider: 소셜 제공자 이름.
            provider_user_id: 제공자 측 고유 사용자 ID.
            provider_email: 제공자로부터 받은 이메일.
            email_verified: 이메일 인증 여부.
            raw_profile: 제공자 원본 프로필 데이터.

        Returns:
            생성된 SocialAccount 모델 인스턴스.
        """
        social_account = SocialAccount(
            user_id=user_id,
            provider=provider,
            provider_user_id=provider_user_id,
            provider_email=provider_email,
            email_verified=email_verified or False,
            raw_profile=raw_profile or {},
        )
        db.add(social_account)
        await db.flush()
        return social_account

    async def delete(
        self,
        db: AsyncSession,
        social_account_id: UUID,
    ) -> None:
        """소셜 계정을 삭제한다 (연동 해제).

        Args:
            db: 비동기 데이터베이스 세션.
            social_account_id: 삭제할 소셜 계정 UUID.
        """
        stmt = delete(SocialAccount).where(SocialAccount.id == social_account_id)
        await db.execute(stmt)


social_account_repo = SocialAccountRepository()
"""모듈 레벨 싱글턴 인스턴스."""
