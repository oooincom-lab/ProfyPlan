"""Заявка на ранний доступ (онбординг «по заявке», блок 6.34).

Заявка сохраняется в базе (не теряется даже без почты); письмо администратору —
вспомогательный канал и отправляется, только если SMTP настроен в окружении.
"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.early_access import EarlyAccessRequest as EarlyAccessModel

router = APIRouter(prefix="/v1", tags=["early-access"])


class EarlyAccessRequest(BaseModel):
    email: EmailStr
    name: str = ""
    company: str = ""
    comment: Optional[str] = ""


@router.post("/early-access")
async def early_access(req: EarlyAccessRequest, db: AsyncSession = Depends(get_db)):
    # 1. Заявка — в базу: она не должна зависеть от почты.
    item = EarlyAccessModel(
        email=req.email,
        name=(req.name or "").strip(),
        company=(req.company or "").strip(),
        comment=(req.comment or "").strip() or None,
    )
    db.add(item)
    await db.commit()

    # 2. Письмо администратору — best effort (SMTP настраивается по окружению).
    if settings.smtp_host and settings.smtp_password:
        try:
            admin_msg = MIMEMultipart("alternative")
            admin_msg["From"] = settings.smtp_user
            admin_msg["To"] = settings.admin_email
            admin_msg["Subject"] = f"[ProfyPlan] Заявка: {req.email}"
            body = (
                "Заявка на создание организации\n\n"
                f"Email: {req.email}\n"
                f"Имя: {req.name or '—'}\n"
                f"Компания: {req.company or '—'}\n"
                f"Комментарий: {req.comment or '—'}\n"
            )
            admin_msg.attach(MIMEText(body, "plain", "utf-8"))
            await aiosmtplib.send(
                admin_msg,
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_user,
                password=settings.smtp_password,
            )
        except Exception:
            pass  # заявка уже сохранена — почта не должна ломать ответ

    return {"status": "ok"}
