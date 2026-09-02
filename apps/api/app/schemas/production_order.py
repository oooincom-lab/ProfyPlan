"""
Pydantic-схемы для ProductionOrder и Excel-импорта.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, Field


# ── ProductionOrder ────────────────────────────────────────────

class ProductionOrderCreate(BaseModel):
    ext_id: Optional[str] = None
    specification_id: Optional[str] = None
    specification_name: Optional[str] = None
    quantity: Decimal = Field(default=1.0)
    unit: str = "pcs"
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: str = "normal"
    client: Optional[str] = None
    client_id: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    parent_order_id: Optional[str] = None


class ProductionOrderOut(BaseModel):
    id: str
    tenant_id: str
    project_id: Optional[str] = None
    ext_id: Optional[str] = None
    specification_id: Optional[str] = None
    specification_name: Optional[str] = None
    quantity: Decimal
    unit: str
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: str
    client: Optional[str] = None
    client_id: Optional[str] = None
    notes: Optional[str] = None
    status: str
    group_id: Optional[str] = None
    pool_id: Optional[str] = None
    parent_order_id: Optional[str] = None
    exploded_at: Optional[datetime] = None
    operations_created: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Excel Import — Вкладка 1: Заказы ──────────────────────────

class ExcelOrderRow(BaseModel):
    """Одна строка из вкладки 'Заказы'."""
    ext_id: str = ""
    product: str = ""
    specification: str = ""
    quantity: float = 1.0
    start_date: Optional[str] = None  # "2026-08-01"
    due_date: Optional[str] = None
    priority: str = "normal"
    client: str = ""
    parent_order_id: Optional[str] = None  # ext_id родительского заказа (куст)


# ── Excel Import — Вкладка 2: BOM ─────────────────────────────

class ExcelBOMRow(BaseModel):
    """Одна строка из вкладки 'Состав (BOM)'."""
    specification: str = ""  # к какой спецификации относится
    node_id: str = ""        # ext_id узла (напр. "1.1.1")
    parent_id: str = ""       # ext_id родителя (пусто = корень)
    node_type: str = "material"  # assembly / semi_finished / material / phantom
    nomenclature: str = ""
    unit: str = "pcs"
    qty_per_parent: float = 1.0
    procurement_days: Optional[float] = None
    is_phantom: bool = False
    order_id: Optional[str] = None  # ext_id заказа-производителя (куст заказов)


# ── Excel Import — Вкладка 3: Маршруты ────────────────────────

class ExcelRouteRow(BaseModel):
    """Одна строка из вкладки 'Маршруты'."""
    node_id: str = ""         # ext_id узла BOM
    sequence: int = 1
    operation: str = ""
    resource_type: str = ""
    duration_hours: float = 0.0
    setup_hours: float = 0.0
    predecessor_seq: Optional[int] = None
    additional_material: str = ""
    material_qty: float = 0.0
    yield_rate: float = 1.0


# ── Результаты импорта ────────────────────────────────────────

class ImportValidationError(BaseModel):
    row: int
    sheet: str
    field: str
    message: str


class ExcelImportResult(BaseModel):
    orders_created: int = 0
    orders_updated: int = 0
    bom_nodes_created: int = 0
    bom_reused: int = 0
    routings_created: int = 0
    routing_ops_created: int = 0
    nomenclature_created: int = 0
    nomenclature_linked: int = 0
    resources_created: int = 0
    missing_bom_nodes: List[str] = []
    errors: List[ImportValidationError] = []
    warnings: List[str] = []
