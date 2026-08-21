"""
Роутер аутентификации: register, login, refresh, logout, me, select-tenant.
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
from app.core.deps import get_current_token
from app.models.tenant import Tenant, User, UserTenant
from app.schemas.auth import (
    RefreshRequest,
    SelectTenantRequest,
    TenantInfo,
    TokenResponse,
    UserLogin,
    UserMe,
    UserRegister,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])


async def _tenants_for(db: AsyncSession, user_id) -> list[TenantInfo]:
    """Список тенантов пользователя (id + имя + роль)."""
    ut_rows = await db.execute(
        select(UserTenant, Tenant)
        .join(Tenant, UserTenant.tenant_id == Tenant.id)
        .where(UserTenant.user_id == user_id)
    )
    return [
        TenantInfo(id=str(t.id), name=t.name, role=ut.role)
        for ut, t in ut_rows.all()
    ]


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
        hashed_password=hash_password(body.password),
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

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        tenants=[TenantInfo(id=str(tenant.id), name=tenant.name, role="owner")],
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """Вход — возвращает JWT-токены + список тенантов пользователя."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Обновить last_login
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    # Все тенанты пользователя (мультитенантность)
    tenants = await _tenants_for(db, user.id)
    first = tenants[0] if tenants else None

    access_token = create_access_token(
        str(user.id),
        first.id if first else None,
    )
    refresh_token = create_refresh_token(str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        tenants=tenants,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Обновить access-токен по refresh-токену (с сохранением tenant_id)."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    tenants = await _tenants_for(db, uuid.UUID(user_id))
    first = tenants[0] if tenants else None
    access_token = create_access_token(
        user_id,
        first.id if first else None,
    )
    new_refresh = create_refresh_token(user_id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        tenants=tenants,
    )


@router.post("/select-tenant", response_model=TokenResponse)
async def select_tenant(
    body: SelectTenantRequest,
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(get_current_token),
):
    """Выбрать tenant (для пользователя в нескольких компаниях) — новый access-токен."""
    user_id = token.get("sub")
    ut = await db.execute(
        select(UserTenant).where(
            UserTenant.user_id == uuid.UUID(user_id),
            UserTenant.tenant_id == uuid.UUID(body.tenant_id),
        )
    )
    if not ut.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="No access to this tenant")

    access_token = create_access_token(user_id, body.tenant_id)
    refresh_token = create_refresh_token(user_id)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        tenants=[],
    )


@router.post("/logout")
async def logout():
    """Выход — клиент удаляет токен на своей стороне."""
    return {"status": "ok"}


@router.get("/me", response_model=UserMe)
async def me(
    db: AsyncSession = Depends(get_db),
    token: dict = Depends(get_current_token),
):
    """Текущий пользователь."""
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
