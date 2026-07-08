"""SQLAlchemy 2.0 선언적 베이스 클래스.

모든 ORM 모델은 이 Base 클래스를 상속받아야 한다.
Alembic 마이그레이션에서도 이 Base.metadata를 참조한다.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """모든 ORM 모델의 기본 클래스."""

    pass
