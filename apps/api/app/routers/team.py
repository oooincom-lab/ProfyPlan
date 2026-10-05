"""Команда организации (блок 6.34, фаза 1): список, приглашения, роли, отключение.

Права: список видит любой участник; приглашать и управлять могут владелец и
администратор. Владельца нельзя отключить или понизить (передача владения —
отдельное действие, здесь её нет). Приглашение живёт 14 дней и принимается по
ссылке из письма: новый сотрудник задаёт пароль, существующий — вводит свой.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import aiosmtplib
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_membership
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.models.invitation import Invitation
from app.models.tenant import Tenant, User, UserTenant
from app.routers.auth import _tenants_for
from app.schemas.auth import TokenResponse

router = APIRouter(prefix="/v1/team", tags=["team"])

ASSIGNABLE_ROLES = ("admin", "planner", "viewer")
INVITE_TTL_DAYS = 14


def _require_manager(m: UserTenant) -> None:
    if (m.role or "").lower() not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Недостаточно прав: нужно быть владельцем или администратором")


def _public_base(request: Request) -> str:
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin:
        return origin
    referer = request.headers.get("referer") or ""
    parts = referer.split("/")
    if len(parts) >= 3 and parts[2]:
        return parts[0] + "//" + parts[2]
    return "https://profyplan.ru"


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _send_invite_email(to_email: str, tenant_name: str, role: str, link: str) -> bool:
    """Письмо-приглашение. Возвращает False, если почта не настроена или не ушла."""
    if not (settings.smtp_host and settings.smtp_password):
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = settings.smtp_user
        msg["To"] = to_email
        msg["Subject"] = f"[ProfyPlan] Приглашение в «{tenant_name}»"
        role_ru = {"admin": "Администратор", "planner": "Планировщик", "viewer": "Наблюдатель"}.get(role, role)
        body = (
            f"Здравствуйте!\n\n"
            f"Вас приглашают в организацию «{tenant_name}» в ProfyPlan.\n"
            f"Роль: {role_ru}.\n\n"
            f"Чтобы присоединиться, откройте ссылку:\n{link}\n\n"
            f"Ссылка действует {INVITE_TTL_DAYS} дней. Если вы не ждали приглашения — просто проигнорируйте письмо.\n"
        )
        msg.attach(MIMEText(body, "plain", "utf-8"))
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
        )
        return True
    except Exception:
        return False


# ── Схемы ──

class MemberOut(BaseModel):
    id: str            # связь user_tenants (membership)
    user_id: str
    email: str
    name: str
    role: str
    is_active: bool
    joined_at: Optional[datetime] = None
    invited_at: Optional[datetime] = None


class InvitationOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    created_at: Optional[datetime] = None


class TeamOut(BaseModel):
    members: list[MemberOut]
    invitations: list[InvitationOut]
    my_role: str


class InviteIn(BaseModel):
    email: EmailStr
    role: str = "planner"


class InviteResult(BaseModel):
    status: str
    emailed: bool
    invite_link: Optional[str] = None
    repeat: bool = False


class MemberPatch(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class InvitationInfo(BaseModel):
    email: str
    role: str
    tenant_name: str
    status: str  # pending / accepted / revoked / expired


class AcceptIn(BaseModel):
    name: Optional[str] = None
    # Для новых аккаунтов требуется не короче 8 символов (проверяется ниже);
    # для существующих — это их текущий пароль, длина может быть любой.
    password: str = Field(min_length=1, max_length=128)


# ── Эндпоинты ──

@router.get("", response_model=TeamOut)
@router.get("/", response_model=TeamOut)
async def team_list(
    m: UserTenant = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(UserTenant, User)
            .join(User, UserTenant.user_id == User.id)
            .where(UserTenant.tenant_id == m.tenant_id)
            .order_by(UserTenant.created_at)
        )
    ).all()
    order = {"owner": 0, "admin": 1, "planner": 2, "viewer": 3}
    members = [
        MemberOut(
            id=str(ut.id),
            user_id=str(u.id),
            email=u.email,
            name=u.name,
            role=ut.role,
            is_active=(ut.is_active is not False),
            joined_at=ut.joined_at,
            invited_at=ut.invited_at,
        )
        for ut, u in rows
    ]
    members.sort(key=lambda x: (order.get((x.role or "").lower(), 9), x.email.lower()))

    invs = (
        await db.execute(
            select(Invitation)
            .where(Invitation.tenant_id == m.tenant_id, Invitation.status == "pending")
            .order_by(Invitation.created_at.desc())
        )
    ).scalars().all()
    invitations = [
        InvitationOut(id=str(i.id), email=i.email, role=i.role, status=i.status, created_at=i.created_at)
        for i in invs
    ]
    return TeamOut(members=members, invitations=invitations, my_role=m.role)


@router.post("/invite", response_model=InviteResult)
async def invite_member(
    body: InviteIn,
    request: Request,
    m: UserTenant = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
):
    _require_manager(m)
    role = (body.role or "planner").lower()
    if role not in ASSIGNABLE_ROLES:
        raise HTTPException(400, "Роль может быть: администратор, планировщик, наблюдатель")
    email = body.email.strip().lower()

    existing = (
        await db.execute(
            select(UserTenant)
            .join(User, UserTenant.user_id == User.id)
            .where(UserTenant.tenant_id == m.tenant_id, func.lower(User.email) == email)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Пользователь с таким email уже в команде")

    tenant = (await db.execute(select(Tenant).where(Tenant.id == m.tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Организация не найдена")

    inv = (
        await db.execute(
            select(Invitation).where(
                Invitation.tenant_id == m.tenant_id,
                Invitation.status == "pending",
                func.lower(Invitation.email) == email,
            )
        )
    ).scalar_one_or_none()

    repeat = inv is not None
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    if inv:
        inv.role = role
        inv.token = token
        inv.expires_at = expires
        inv.invited_by = m.user_id
    else:
        inv = Invitation(
            tenant_id=m.tenant_id,
            email=email,
            role=role,
            token=token,
            invited_by=m.user_id,
            expires_at=expires,
        )
        db.add(inv)
    await db.commit()

    link = f"{_public_base(request)}/invite?token={token}"
    emailed = await _send_invite_email(email, tenant.name, role, link)
    return InviteResult(status="ok", emailed=emailed, invite_link=(None if emailed else link), repeat=repeat)


@router.delete("/invitations/{invitation_id}")
async def revoke_invitation(
    invitation_id: str,
    m: UserTenant = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
):
    _require_manager(m)
    inv = (
        await db.execute(
            select(Invitation).where(Invitation.id == invitation_id, Invitation.tenant_id == m.tenant_id)
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Приглашение не найдено")
    inv.status = "revoked"
    await db.commit()
    return {"status": "ok"}


@router.patch("/members/{membership_id}")
async def update_member(
    membership_id: str,
    body: MemberPatch,
    m: UserTenant = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
):
    _require_manager(m)
    row = (
        await db.execute(
            select(UserTenant).where(UserTenant.id == membership_id, UserTenant.tenant_id == m.tenant_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Участник не найден")
    if str(row.id) == str(m.id):
        raise HTTPException(400, "Нельзя менять свою роль или доступ")
    actor_admin = (m.role or "").lower() == "admin"
    target_owner = (row.role or "").lower() == "owner"
    if actor_admin and target_owner:
        raise HTTPException(403, "Администратор не может менять владельца")

    if body.role is not None:
        role = body.role.lower()
        if role not in ASSIGNABLE_ROLES:
            raise HTTPException(400, "Роль может быть: администратор, планировщик, наблюдатель")
        if target_owner:
            raise HTTPException(409, "Передача владения — отдельное действие")
        row.role = role
    if body.is_active is not None:
        if target_owner and body.is_active is False:
            raise HTTPException(409, "Нельзя отключить владельца организации")
        row.is_active = bool(body.is_active)
    await db.commit()
    return {"status": "ok"}


@router.get("/invitation/{token}", response_model=InvitationInfo)
async def invitation_info(token: str, db: AsyncSession = Depends(get_db)):
    inv = (await db.execute(select(Invitation).where(Invitation.token == token))).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Приглашение не найдено")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == inv.tenant_id))).scalar_one_or_none()
    expired = bool(inv.expires_at and _as_utc(inv.expires_at) < datetime.now(timezone.utc))
    status = "expired" if (inv.status == "pending" and expired) else inv.status
    return InvitationInfo(
        email=inv.email,
        role=inv.role,
        tenant_name=tenant.name if tenant else "",
        status=status,
    )


@router.post("/invitation/{token}/accept", response_model=TokenResponse)
async def accept_invitation(token: str, body: AcceptIn, db: AsyncSession = Depends(get_db)):
    inv = (await db.execute(select(Invitation).where(Invitation.token == token))).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Приглашение не найдено")
    if inv.status != "pending":
        raise HTTPException(409, "Приглашение уже использовано или отозвано")
    if inv.expires_at and _as_utc(inv.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(410, "Срок приглашения истёк")

    email = inv.email.strip().lower()
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if user:
        if not user.is_active:
            raise HTTPException(403, "Учётная запись отключена")
        if not verify_password(body.password, user.hashed_password):
            raise HTTPException(401, "У вас уже есть аккаунт — введите пароль от него")
    else:
        if len(body.password) < 8:
            raise HTTPException(400, "Пароль — не короче 8 символов")
        name = (body.name or "").strip() or email.split("@")[0]
        user = User(email=inv.email.strip(), hashed_password=hash_password(body.password), name=name)
        db.add(user)
        await db.flush()

    now = datetime.now(timezone.utc)
    ut = (
        await db.execute(
            select(UserTenant).where(UserTenant.user_id == user.id, UserTenant.tenant_id == inv.tenant_id)
        )
    ).scalar_one_or_none()
    if ut and ut.is_active is not False:
        raise HTTPException(409, "Вы уже в этой организации — просто войдите")
    if ut:
        ut.is_active = True
        ut.role = inv.role
        ut.joined_at = now
    else:
        db.add(UserTenant(user_id=user.id, tenant_id=inv.tenant_id, role=inv.role, joined_at=now))

    inv.status = "accepted"
    inv.accepted_at = now
    await db.commit()

    tenants = await _tenants_for(db, user.id)
    return TokenResponse(
        access_token=create_access_token(str(user.id), str(inv.tenant_id)),
        refresh_token=create_refresh_token(str(user.id)),
        tenants=tenants,
    )
