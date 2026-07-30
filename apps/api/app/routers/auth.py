"""
Роутер аутентификации: register, login, refresh, logout, me.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.base import BaseModel  # noqa: F401
from app.models.tenant import Tenant, User, UserTenant
from app.schemas.auth import (
    RefreshRequest,
    TokenResponse,
    UserLogin,
    UserMe,
    UserRegister,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    """Регистрация нового пользователя + создание tenant."""
    # Проверка уникальности email
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Создать tenant (компанию)
    tenant = Tenant(
        name=body.company,
        plan="trial",
        trial_ends_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(tenant)
    await db.flush()

    # Создать пользователя
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
    )
    db.add(user)
    await db.flush()

    # Связать пользователя с tenant (Owner)
    user_tenant = UserTenant(
        user_id=user.id,
        tenant_id=tenant.id,
        role="owner",
        joined_at=datetime.now(timezone.utc),
    )
    db.add(user_tenant)
    await db.commit()

    # Выпустить токены
    access_token = create_access_token(str(user.id), str(tenant.id))
    refresh_token = create_refresh_token(str(user.id))

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """Вход — возвращает JWT-токены."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Обновить last_login
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    # Найти tenant и роль
    ut_result = await db.execute(
        select(UserTenant).where(UserTenant.user_id == user.id)
    )
    user_tenant = ut_result.scalars().first()

    access_token = create_access_token(
        str(user.id),
        str(user_tenant.tenant_id) if user_tenant else None,
    )
    refresh_token = create_refresh_token(str(user.id))

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    """Обновить access-токен по refresh-токену."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    access_token = create_access_token(user_id)
    new_refresh = create_refresh_token(user_id)

    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@router.post("/logout")
async def logout():
    """Выход — клиент удаляет токен на своей стороне."""
    return {"status": "ok"}


@router.get("/me", response_model=UserMe)
async def me(
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(_get_current_token),  # TODO: добавить Depends
):
    """Текущий пользователь."""
    # Заглушка — будет заменена после добавления auth-dependency
    user_id = token.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ut_result = await db.execute(
        select(UserTenant, Tenant)
        .join(Tenant, UserTenant.tenant_id == Tenant.id)
        .where(UserTenant.user_id == user.id)
    )
    row = ut_result.first()
    if not row:
        raise HTTPException(status_code=404, detail="No tenant found")

    user_tenant, tenant = row
    return UserMe(
        id=str(user.id),
        email=user.email,
        name=user.name,
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
        role=user_tenant.role,
    )


# --- Auth Dependency (будет вынесена в отдельный файл) ---
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()


async def _get_current_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Извлечь и проверить JWT из заголовка Authorization."""
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload
