import time
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

def generate_mock_apple_private_key() -> str:
    """테스트를 위해 가상의 ECDSA (P-256) Apple Private Key PEM 문자열 생성"""
    private_key = ec.generate_private_key(ec.SECP256R1())
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    return pem.decode('utf-8')

def generate_apple_client_secret(
    private_key_pem: str,
    key_id: str,
    team_id: str,
    client_id: str,
    expires_in_seconds: int = 3600
) -> str:
    """Apple Developer 스펙에 맞춘 client_secret JWT 생성 (ES256 서명)"""
    headers = {
        "alg": "ES256",
        "kid": key_id
    }
    
    current_time = int(time.time())
    payload = {
        "iss": team_id,
        "iat": current_time,
        "exp": current_time + expires_in_seconds,
        "aud": "https://appleid.apple.com",
        "sub": client_id
    }
    
    # ECDSA P-256 프라이빗 키 객체 로드 및 서명
    client_secret = jwt.encode(
        payload,
        private_key_pem,
        algorithm="ES256",
        headers=headers
    )
    return client_secret

def verify_apple_client_secret(client_secret_jwt: str, public_key_pem: str, client_id: str) -> dict:
    """생성된 JWT가 Apple의 스펙에 맞게 해독 및 검증이 가능한지 역검증"""
    decoded = jwt.decode(
        client_secret_jwt,
        public_key_pem,
        algorithms=["ES256"],
        audience="https://appleid.apple.com",
        subject=client_id
    )
    return decoded

def main():
    print("=== PoC 5: Apple client_secret JWT 생성 및 ES256 서명 검증 ===")
    
    # 1. 가상 가중치 정보 정의
    KEY_ID = "ABC123XYZ8"          # Apple Developer Key ID
    TEAM_ID = "TEAMID1234"         # Apple Developer Team ID
    CLIENT_ID = "com.myapp.service" # App Bundle ID or Service ID
    
    print("\n1) 가상의 ECDSA SECP256R1 Private Key 생성 중...")
    private_key_pem = generate_mock_apple_private_key()
    print("✓ 가상 Private Key (.p8 PEM 포맷) 생성 완료")
    
    # 2. Public Key 획득 (검증용)
    private_key_obj = serialization.load_pem_private_key(
        private_key_pem.encode('utf-8'),
        password=None
    )
    public_key_pem = private_key_obj.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')
    
    # 3. client_secret 생성
    print("\n2) Apple client_secret JWT 생성 시작 (ES256 서명 적용)...")
    try:
        jwt_token = generate_apple_client_secret(
            private_key_pem=private_key_pem,
            key_id=KEY_ID,
            team_id=TEAM_ID,
            client_id=CLIENT_ID,
            expires_in_seconds=86400 * 30 # 30일 만료
        )
        print("✓ client_secret JWT 생성 성공!")
        print(f"   - 생성된 JWT (앞 50자리): {jwt_token[:50]}...")
        
        # 4. 역해독 및 검증 수행
        print("\n3) 생성된 JWT 토큰 검증 및 페이로드 해독...")
        decoded_payload = verify_apple_client_secret(
            client_secret_jwt=jwt_token,
            public_key_pem=public_key_pem,
            client_id=CLIENT_ID
        )
        print("✓ JWT 서명 해독 및 유효성 검증 성공!")
        print("   - 해독된 Payload 내용:")
        for k, v in decoded_payload.items():
            if k in ['iat', 'exp']:
                time_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(v))
                print(f"     * {k}: {v} ({time_str})")
            else:
                print(f"     * {k}: {v}")
                
        print("\n✓ Apple client_secret JWT 서명 및 암호학적 검증 완수.")
        
    except Exception as e:
        print(f"✗ 검증 실패: {e}")

if __name__ == "__main__":
    main()
