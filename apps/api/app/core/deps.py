"""
Зависимости FastAPI: текущий пользователь, tenant, роль.
"""
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.tenant import User, UserTenant

security = HTTPBearer()


async def get_current_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Извлечь и проверить JWT-токен."""
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


async def get_current_user(
    token: dict = Depends(get_current_token),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Получить текущего пользователя из JWT."""
    user_id = token.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def get_current_tenant_id(
    token: dict = Depends(get_current_token),
) -> UUID:
    """Извлечь tenant_id из JWT."""
    tenant_id = token.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="No tenant in token")
    return UUID(tenant_id)
