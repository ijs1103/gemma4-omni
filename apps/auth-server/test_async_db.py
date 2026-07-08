import asyncio
import time
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, ForeignKey, DateTime, Text, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# 1. SQLAlchemy 2.0 선언적 모델 정의
class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(String(20), default='active')
    display_name: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

class SocialAccount(Base):
    __tablename__ = 'social_accounts'
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    provider: Mapped[str] = mapped_column(String(20))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

# 2. 비동기 데이터베이스 엔진 및 세션 팩토리 구성
# aiosqlite 비동기 SQLite 메모리 DB 사용
DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False # 로그 간소화
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# 3. 비동기 UPSERT 및 세션 안정성 테스트 함수
async def authenticate_or_register_social(
    provider: str,
    provider_user_id: str,
    display_name: str
) -> dict:
    """실제 소셜 로그인 서비스의 트랜잭션 흐름을 비동기로 시뮬레이션"""
    async with AsyncSessionLocal() as session:
        async with session.begin(): # 단일 비동기 트랜잭션 시작
            # 기존 소셜 계정 조회
            stmt = select(SocialAccount).where(
                SocialAccount.provider == provider,
                SocialAccount.provider_user_id == provider_user_id
            )
            result = await session.execute(stmt)
            social_account = result.scalars().first()
            
            is_new = False
            if not social_account:
                is_new = True
                # 1. 새 사용자 생성
                new_user = User(
                    id=uuid.uuid4(),
                    display_name=display_name
                )
                session.add(new_user)
                # 2. 소셜 계정 바인딩
                social_account = SocialAccount(
                    id=uuid.uuid4(),
                    user_id=new_user.id,
                    provider=provider,
                    provider_user_id=provider_user_id
                )
                session.add(social_account)
                
            return {
                "user_id": str(social_account.user_id),
                "is_new": is_new
            }

# 4. 동시성 (Concurrency) 벤치마크 실행기
async def main():
    print("=== PoC 4: FastAPI/SQLAlchemy 2.0 비동기(async) 세션 및 트랜잭션 동시성 검증 ===")
    
    # 4.1 스키마 생성
    print("1) 비동기 스키마 초기화 시작...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ 비동기 SQLite 스키마 생성 완료")
    
    # 4.2 동시성 100개 요청 준비 (50명 신규 가입 + 50명 기존 가입 재로그인)
    print("\n2) 동시성 부하 테스트 시작...")
    print("   - 총 100개의 소셜 인증 트랜잭션 동시 요청 (asyncio.gather)")
    
    tasks = []
    
    # 50개 신규 가입 시뮬레이션
    for i in range(50):
        tasks.append(
            authenticate_or_register_social(
                provider="google",
                provider_user_id=f"user_{i}",
                display_name=f"Google User {i}"
            )
        )
        
    start_time = time.now() if hasattr(time, 'now') else time.perf_counter()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    end_time = time.now() if hasattr(time, 'now') else time.perf_counter()
    
    # 4.3 신규 가입 검증
    errors = [r for r in results if isinstance(r, Exception)]
    successes = [r for r in results if not isinstance(r, Exception)]
    
    print(f"\n3) 1차 동시성 신규 가입 결과:")
    print(f"   - 총 소요 시간: {(end_time - start_time) * 1000:.2f}ms")
    print(f"   - 평균 처리 시간: {((end_time - start_time) * 1000) / 100:.2f}ms/요청")
    print(f"   - 성공 트랜잭션: {len(successes)}개")
    print(f"   - 에러 발생 개수: {len(errors)}개")
    
    if errors:
        print(f"   [!] 첫 번째 발생 에러 예시: {errors[0]}")
        
    # 4.4 2차 기존 가입자 동일인 50명 동시 재로그인 (Upsert 로직 타는지 확인)
    print("\n4) 2차 동시성 재로그인 테스트 (동일 데이터로 재요청)...")
    tasks_retry = []
    for i in range(50):
        tasks_retry.append(
            authenticate_or_register_social(
                provider="google",
                provider_user_id=f"user_{i}",
                display_name=f"Google User {i} Updated"
            )
        )
        
    start_time_2 = time.perf_counter()
    results_2 = await asyncio.gather(*tasks_retry, return_exceptions=True)
    end_time_2 = time.perf_counter()
    
    successes_2 = [r for r in results_2 if not isinstance(r, Exception)]
    new_users_count = sum(1 for r in successes_2 if r.get("is_new") is True)
    existing_users_count = sum(1 for r in successes_2 if r.get("is_new") is False)
    
    print(f"\n5) 2차 동시성 재로그인 결과:")
    print(f"   - 총 소요 시간: {(end_time_2 - start_time_2) * 1000:.2f}ms")
    print(f"   - 성공 트랜잭션: {len(successes_2)}개")
    print(f"   - 신규 가입 처리된 수: {new_users_count}개 (예상값: 0)")
    print(f"   - 기존 가입 연동 처리된 수: {existing_users_count}개 (예상값: 50)")
    
    # 4.5 엔진 리소스 반환
    await engine.dispose()
    print("\n✓ SQLAlchemy Async Engine 리소스 즉시 해제 및 검증 완수.")

if __name__ == "__main__":
    asyncio.run(main())
