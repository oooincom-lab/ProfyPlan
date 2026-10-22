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
from app.models.integration import IntegrationConnection
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
    """Извлечь tenant_id из JWT. Агентские токены сюда не допускаются."""
    if token.get("scope") == "agent":
        raise HTTPException(status_code=403, detail="Agent token is only allowed for integration endpoints")
    tenant_id = token.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="No tenant in token")
    return UUID(tenant_id)


async def get_integration_tenant_id(
    token: dict = Depends(get_current_token),
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """tenant_id для интеграции: обычный JWT или агентский токен с проверкой jti."""
    tenant_id = token.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="No tenant in token")
    if token.get("scope") == "agent":
        connection_id = token.get("connection_id")
        jti = token.get("jti")
        if not connection_id or not jti:
            raise HTTPException(status_code=401, detail="Invalid agent token")
        try:
            conn = await db.get(IntegrationConnection, UUID(connection_id))
        except Exception:
            conn = None
        settings = (conn.settings or {}) if conn else {}
        if not conn or not conn.is_active or settings.get("agent_token_jti") != jti:
            raise HTTPException(status_code=401, detail="Agent token revoked or inactive")
        if str(conn.tenant_id) != str(tenant_id):
            raise HTTPException(status_code=401, detail="Agent token tenant mismatch")
    return UUID(tenant_id)


async def get_current_membership(
    token: dict = Depends(get_current_token),
    db: AsyncSession = Depends(get_db),
) -> UserTenant:
    """Связь пользователя с организацией из токена: роль и статус (блок 6.34)."""
    user_id = token.get("sub")
    tenant_id = token.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="No tenant in token")
    row = (
        await db.execute(
            select(UserTenant).where(
                UserTenant.user_id == user_id,
                UserTenant.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=403, detail="No access to this tenant")
    if row.is_active is False:
        raise HTTPException(status_code=403, detail="Доступ к организации отключён")
    return row
