"""
Эндпоинт для формы раннего доступа — отправка email через Gmail SMTP.
"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.config import settings

router = APIRouter(prefix="/v1", tags=["early-access"])


class EarlyAccessRequest(BaseModel):
    email: EmailStr


@router.post("/early-access")
async def early_access(req: EarlyAccessRequest):
    if not settings.smtp_host:
        raise HTTPException(status_code=500, detail="SMTP not configured")

    admin_msg = MIMEMultipart("alternative")
    admin_msg["From"] = settings.smtp_user
    admin_msg["To"] = settings.admin_email
    admin_msg["Subject"] = f"[ProfyPlan] Новая заявка раннего доступа: {req.email}"

    body = f"Новая заявка раннего доступа от {req.email}"
    admin_msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        await aiosmtplib.send(
            admin_msg,
            hostname=settin…ost,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settin…ord,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")

    return {"status": "ok", "message": "Заявка принята"}
