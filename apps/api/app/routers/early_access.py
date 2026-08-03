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
    """Принимает email из формы лендинга и отправляет уведомление администратору."""
    if not settings.smtp_host:
        raise HTTPException(status_code=500, detail="SMTP not configured")

    admin_msg = MIMEMultipart("alternative")
    admin_msg["From"] = settings.smtp_user
    admin_msg["To"] = settings.admin_email
    admin_msg["Subject"] = f"[ProfyPlan] Новая заявка на ранний доступ: {req.email}"
    admin_msg.attach(MIMEText(
        f"""<html><body style="font-family:Arial,sans-serif;color:#E8EEF5;background:#0A1628;padding:20px">
<h2 style="color:#60A5FA">ProfyPlan &mdash; Новая заявка</h2>
<p>Пользователь <strong>{req.email}</strong> оставил заявку на ранний доступ.</p>
<p style="color:#8FA3BD;font-size:12px">IP и User-Agent не зафиксированы.</p>
</body></html>""",
        "html", "utf-8",
    ))

    try:
        await aiosmtplib.send(
            admin_msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settin…ord,
            start_tls=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")

    return {"status": "ok", "message": "Заявка принята"}
