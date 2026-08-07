"""
API-роутер для импорта данных из Excel.
"""
import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_current_tenant_id
from app.models.tenant import User
from app.services.excel_import import import_excel, ImportResult

excel_router = APIRouter(prefix="/v1/import", tags=["import"])


@excel_router.post("/excel")
async def import_excel_file(
    file: UploadFile = File(...),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Импорт данных из 7-вкладочного Excel-шаблона."""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        return {"ok": False, "errors": ["Файл должен быть .xlsx"]}

    contents = await file.read()
    if len(contents) == 0:
        return {"ok": False, "errors": ["Файл пуст"]}

    result: ImportResult = await import_excel(contents, tenant_id, user.id, db)

    return {
        "ok": result.ok,
        "created": result.created,
        "warnings": result.warnings,
        "errors": result.errors,
    }
