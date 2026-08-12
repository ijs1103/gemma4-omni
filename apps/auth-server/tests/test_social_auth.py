import pytest
from unittest.mock import AsyncMock, patch
from app.services.auth.social_service import SocialAuthService, _in_memory_oauth_state

@pytest.mark.asyncio
async def test_start_login_in_memory_fallback():
    """Redis가 비활성화되었을 때 인메모리 폴백으로 OAuth state가 저장되는지 검증한다."""
    service = SocialAuthService()
    
    # Force _get_redis to fail/raise to test in-memory fallback
    with patch.object(service, '_get_redis', side_effect=Exception("Redis connection error")):
        response = await service.start_login(provider="google", redirect_uri="http://localhost/callback", platform="web")
        
        assert response.authorize_url is not None
        assert "state=" in response.authorize_url
        assert len(_in_memory_oauth_state) > 0

@pytest.mark.asyncio
async def test_start_login_invalid_provider():
    """지원되지 않는 소셜 프로바이더에 대해 예외가 발생하는지 검증한다."""
    service = SocialAuthService()
    
    with pytest.raises(Exception):
        await service.start_login(provider="unsupported_provider", redirect_uri="http://localhost/callback", platform="web")
