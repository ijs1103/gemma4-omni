"""사용자(User) 리포지토리.

users 테이블에 대한 비동기 CRUD 작업을 제공한다.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    """사용자 모델에 대한 데이터 액세스 메서드를 제공하는 리포지토리."""

    async def get_by_id(self, db: AsyncSession, user_id: UUID) -> User | None:
        """사용자 ID로 사용자를 조회한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user_id: 조회할 사용자의 UUID.

        Returns:
            해당 사용자 모델 인스턴스 또는 None.
        """
        stmt = select(User).where(User.id == user_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def create(
        self,
        db: AsyncSession,
        *,
        display_name: str | None = None,
        primary_email: str | None = None,
        profile_image_url: str | None = None,
    ) -> User:
        """새로운 사용자를 생성한다.

        Args:
            db: 비동기 데이터베이스 세션.
            display_name: 표시 이름.
            primary_email: 대표 이메일 주소.
            profile_image_url: 프로필 이미지 URL.

        Returns:
            생성된 User 모델 인스턴스 (flush 완료, 아직 commit 안 됨).
        """
        user = User(
            display_name=display_name,
            primary_email=primary_email,
            profile_image_url=profile_image_url,
        )
        db.add(user)
        await db.flush()
        return user

    async def update(
        self,
        db: AsyncSession,
        user: User,
        **kwargs: str | None,
    ) -> User:
        """사용자 정보를 부분 업데이트한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user: 업데이트할 User 모델 인스턴스.
            **kwargs: 업데이트할 필드와 값 (예: display_name="홍길동").

        Returns:
            업데이트된 User 모델 인스턴스.
        """
        for field, value in kwargs.items():
            if hasattr(user, field):
                setattr(user, field, value)
        await db.flush()
        return user

    async def delete(
        self,
        db: AsyncSession,
        user: User,
    ) -> None:
        """사용자를 삭제한다 (Cascade에 의해 연관 데이터도 삭제됨).

        Args:
            db: 비동기 데이터베이스 세션.
            user: 삭제할 User 모델 인스턴스.
        """
        await db.delete(user)
        await db.flush()


user_repo = UserRepository()
"""모듈 레벨 싱글턴 인스턴스."""
