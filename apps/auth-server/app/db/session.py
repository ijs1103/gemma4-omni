"""비동기 데이터베이스 세션 관리 모듈.

SQLAlchemy 2.0 async 엔진과 세션 팩토리를 설정하고,
FastAPI의 Depends에서 사용할 수 있는 세션 제너레이터를 제공한다.
개발 모드에서는 sqlite+aiosqlite를 지원한다.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# SQLite를 사용할 경우 connect_args에 check_same_thread=False를 전달해야 한다.
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

_connect_args: dict = {"check_same_thread": False} if _is_sqlite else {}

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    echo=False,
    connect_args=_connect_args,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    """FastAPI Depends용 비동기 DB 세션 제너레이터.

    요청 처리가 끝나면 세션을 자동으로 닫는다.
    예외 발생 시에도 세션이 정리되도록 try/finally를 사용한다.

    Yields:
        AsyncSession: 비동기 SQLAlchemy 세션.
    """
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
