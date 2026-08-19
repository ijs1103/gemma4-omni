"""
테스트용 JWT 발급 스크립트.

apps/auth-server 의 실제 JWT 서명 설정(SECRET_KEY, ALGORITHM, payload 필드명)과
반드시 일치시켜야 서버가 유효한 토큰으로 인식합니다.

사용 전 확인할 것:
  1. apps/auth-server/app/core/ 안의 config.py 또는 security.py 에서
     SECRET_KEY, ALGORITHM 값을 그대로 복사해온다.
     (환경변수로 관리한다면 .env 파일에서 확인)
  2. app/api/deps.py 의 get_current_user 가 토큰에서 어떤 클레임(claim)으로
     user_id 를 읽는지 확인한다 (보통 "sub" 이지만 커스텀일 수 있음).
  3. 실제 DB에 존재하는 user_id 값을 사용해야 한다.
     (없는 유저 ID로 만들면 get_current_user 에서 404/401 날 수 있음)

설치:
  pip install pyjwt
"""

import jwt
from datetime import datetime, timedelta, timezone

# ── 아래 값을 실제 auth-server 설정과 동일하게 맞추세요 ──────────────
SECRET_KEY = "2430c880fa8d595152f3861828ac005b5cc33d51382b800cc737232be62a5abf"   # app/core/config.py 등에서 확인
ALGORITHM = "HS256"                      # 서버와 동일하게
USER_A_ID = "b57da2c8115342e5aaa059c0bc18df43"  # 주상
USER_B_ID = "fb3922c618244f6f99881e77851047d1"  # lj (ajapag@gmail.com)
# ────────────────────────────────────────────────────────────────


def make_token(user_id: str, expires_minutes: int = 60) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,  # get_current_user가 다른 클레임명을 쓰면 여기를 맞춰야 함
        "iat": now,
        "exp": now + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


if __name__ == "__main__":
    token_a = make_token(USER_A_ID)
    token_b = make_token(USER_B_ID)
    print("USER_A_TOKEN=" + token_a)
    print("USER_B_TOKEN=" + token_b)
