"""
Pydantic-схемы для BOM, маршрутов и развёртки.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── ProductStructure ──

class BOMNodeCreate(BaseModel):
    """Создание узла BOM."""
    parent_id: Optional[str] = None
    level: int = 0
    node_type: str = Field(default="material", pattern="^(assembly|semi_finished|material)$")
    nomenclature_id: Optional[str] = None
    nomenclature_name: str = Field(min_length=1, max_length=255)
    quantity_per_parent: Decimal = Field(default=1.0, ge=0)
    unit: str = Field(default="pcs")
    is_make_or_buy: str = Field(default="buy", pattern="^(make|buy)$")
    procurement_lead_time_days: Optional[Decimal] = None
    is_phantom: bool = False
    sort_order: int = 0
    routing_id: Optional[str] = None
    order_id: Optional[str] = None
    notes: Optional[str] = None
    ext_id: Optional[str] = None


class BOMNodeUpdate(BaseModel):
    """Частичное обновление узла BOM."""
    nomenclature_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    quantity_per_parent: Optional[Decimal] = Field(default=None, ge=0)
    unit: Optional[str] = None
    routing_id: Optional[str] = None
    order_id: Optional[str] = None
    notes: Optional[str] = None
    ext_id: Optional[str] = None


class BOMNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    project_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None
    level: int
    path: Optional[str] = None
    node_type: str
    nomenclature_id: Optional[str] = None
    nomenclature_name: str
    quantity_per_parent: Decimal
    unit: str
    is_make_or_buy: str
    procurement_lead_time_days: Optional[Decimal] = None
    is_phantom: bool
    sort_order: int
    routing_id: Optional[UUID] = None
    order_id: Optional[UUID] = None
    notes: Optional[str] = None
    ext_id: Optional[str] = None


class BOMTreeOut(BaseModel):
    """Дерево BOM."""
    project_id: Optional[str] = None
    nodes: list[BOMNodeOut]
    total_nodes: int


class BOMUploadResult(BaseModel):
    """Результат массовой загрузки BOM."""
    imported: int
    skipped: int
    errors: list[str]
    root_ids: list[str]


# ── Routing ──

class RoutingOpCreate(BaseModel):
    """Операция в составе маршрута."""
    sequence_number: int
    name: str = Field(min_length=1, max_length=255)
    duration_hours: Decimal = Field(default=0, ge=0)
    setup_hours: Decimal = Field(default=0, ge=0)
    teardown_hours: Decimal = Field(default=0, ge=0)
    resource_type_id: Optional[str] = None
    alternative_resource_types: Optional[str] = None
    output_product: Optional[str] = None
    output_quantity: Decimal = Field(default=1.0, ge=0)
    yield_rate: Decimal = Field(default=1.0, ge=0, le=1)
    predecessors: Optional[str] = None  # "1,3"
    input_materials: Optional[str] = None
    notes: Optional[str] = None
    ext_id: Optional[str] = None


class RoutingCreate(BaseModel):
    """Создание техмаршрута."""
    name: str = Field(min_length=1, max_length=255)
    product_node_id: Optional[str] = None
    spec_id: Optional[str] = None
    variant: str = "Основной"
    is_default: bool = True
    notes: Optional[str] = None
    ext_id: Optional[str] = None
    operations: list[RoutingOpCreate] = Field(default_factory=list)


class RoutingOpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    routing_id: UUID
    sequence_number: int
    name: str
    duration_hours: Decimal
    setup_hours: Decimal
    teardown_hours: Decimal
    resource_type_id: Optional[str] = None
    output_product: Optional[str] = None
    output_quantity: Decimal
    yield_rate: Decimal
    predecessors: Optional[str] = None
    notes: Optional[str] = None
    ext_id: Optional[str] = None


class RoutingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    product_node_id: Optional[str] = None
    variant: str
    is_default: bool
    total_setup_hours: Decimal
    notes: Optional[str] = None
    ext_id: Optional[str] = None
    operations: list[RoutingOpOut] = Field(default_factory=list)


class RoutingList(BaseModel):
    items: list[RoutingOut]
    total: int


# ── BOM Explosion ──

class BOMExplodeRequest(BaseModel):
    """Запрос на развёртку BOM в операции."""
    project_quantity: Decimal = Field(default=1.0, ge=0)
    spec_id: Optional[str] = None  # nomenclature_id корневого узла


class ExplodedOpOut(BaseModel):
    temp_id: str
    name: str
    duration_base: Decimal
    duration_unit: str = "hour"
    setup_time: Decimal = Decimal("0")
    teardown_time: Decimal = Decimal("0")
    operation_type: str = "production"
    output_product: Optional[str] = None
    output_quantity: Optional[Decimal] = None
    yield_rate: Decimal = Decimal("1.0")
    resource_type_id: Optional[str] = None
    is_milestone: bool = False
    source_node_path: str = ""


class ExplodedDepOut(BaseModel):
    predecessor_temp_id: str
    successor_temp_id: str
    dependency_type: str = "FS"
    lag_hours: Decimal = Decimal("0")


class BOMExplosionOut(BaseModel):
    """Результат развёртки BOM."""
    operations: list[ExplodedOpOut]
    dependencies: list[ExplodedDepOut]
    materials: list[dict]
    warnings: list[str]


class BOMExplodeAndSaveRequest(BaseModel):
    """Развернуть BOM и сохранить как операции проекта."""
    project_quantity: Decimal = Field(default=1.0, ge=0)
    spec_id: Optional[str] = None


class BOMExplodeAndSaveOut(BaseModel):
    created_operations: int
    created_dependencies: int
    materials_count: int
    warnings: list[str]
