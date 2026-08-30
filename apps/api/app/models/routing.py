"""
Модели техмаршрутов: Routing и RoutingOperation.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Routing(BaseModel):
    """Технологический маршрут изготовления."""
    __tablename__ = "routings"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("product_structures.id", ondelete="SET NULL"),
        nullable=True,
    )
    spec_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ID спецификации из ERP
    variant: Mapped[str] = mapped_column(
        String(100), default="Основной"
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    total_setup_hours: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), default=0
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    ext_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Внешний ID из ERP"
    )


class RoutingOperation(BaseModel):
    """Операция в составе технологического маршрута."""
    __tablename__ = "routing_operations"

    routing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    duration_hours: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), default=0
    )
    setup_hours: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), default=0
    )
    teardown_hours: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), default=0
    )

    resource_type_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    alternative_resource_types: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )  # через запятую, для Resource Leveling

    stage: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, comment="Этап (колонка «Этап» вкладки Маршруты)"
    )
    stage_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Название этапа (вкладка «6-Этапы»)"
    )
    department: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Подразделение (колонка «Подразделение» вкладки Маршруты)"
    )

    output_product: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    output_quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=1.0
    )
    yield_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=1.0
    )  # 0.95 = 5% брак

    catalog_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("catalog_operations.id", ondelete="SET NULL"),
        nullable=True,
        comment="Ссылка на каталог операций (Шаг 3 v2.15)",
    )

    stage_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("project_stages.id", ondelete="SET NULL"),
        nullable=True,
        comment="Этап проекта (Шаг 4b)",
    )

    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
        comment="Подразделение (Шаг 4b)",
    )

    predecessors: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # "1,3" — sequence_number предшественников

    input_materials: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # JSON: [{"id":"...","qty":100,"unit":"kg"}]

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    ext_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Внешний ID из ERP"
    )
