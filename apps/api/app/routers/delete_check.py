"""
Универсальный эндпоинт проверки удаления: что будет затронуто при удалении сущности.
Возвращает дерево зависимостей: каскадные удаления и блокирующие ссылки.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_tenant_id
from app.models.project import Project
from app.models.production_order import ProductionOrder
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.resource import Resource
from app.models.resource_calendar import ResourceCalendar, ResourceCalendarSlot
from app.models.product_structure import ProductStructure
from app.models.routing import Routing, RoutingOperation
from app.models.nomenclature import Nomenclature
from app.models.unit import Unit
from app.models.order_group import OrderGroup
from app.models.order_pool import OrderPool
from app.models.plan_version import PlanBaseline, ActualExecution, InterProjectDependency

router = APIRouter(tags=["delete-check"])


# ── Map entity_type → model + dependency rules ──────────────────────────

DEPENDENCY_MAP = {
    "project": {
        "model": Project,
        "label": "Проект",
        "name_field": "name",
        "cascade": [
            ("orders", ProductionOrder, "project_id", "specification_name"),
            ("operations", Operation, "project_id", "name"),
            ("resources", Resource, "project_id", "name"),
            ("groups", OrderGroup, "project_id", "name"),
            ("pools", OrderPool, "project_id", "name"),
            ("bom_nodes", ProductStructure, "project_id", "nomenclature_name"),
            ("baselines", PlanBaseline, "project_id", "name"),
        ],
        "blocking": [],
    },
    "nomenclature": {
        "model": Nomenclature,
        "label": "Номенклатура",
        "name_field": "name",
        "cascade": [],
        "blocking": [],  # custom check: string ext_id in product_structures
    },
    "resource": {
        "model": Resource,
        "label": "Ресурс",
        "name_field": "name",
        "cascade": [
            ("calendars", ResourceCalendar, "resource_id", "name"),
        ],
        "blocking": [
            ("operation_resources", OperationResource, "resource_id", "role + operation_id"),
        ],
    },
    "unit": {
        "model": Unit,
        "label": "Единица измерения",
        "name_field": "name_ru",
        "cascade": [],
        "blocking": [
            ("nomenclature", Nomenclature, "unit_id", "name"),
        ],
    },
    "order_group": {
        "model": OrderGroup,
        "label": "Группа заказов",
        "name_field": "name",
        "cascade": [],
        "blocking": [
            ("orders", ProductionOrder, "group_id", "specification_name"),
            ("pools", OrderPool, "group_id", "name"),
        ],
    },
    "order_pool": {
        "model": OrderPool,
        "label": "Пул заказов",
        "name_field": "name",
        "cascade": [],
        "blocking": [
            ("orders", ProductionOrder, "pool_id", "specification_name"),
        ],
    },
    "order": {
        "model": ProductionOrder,
        "label": "Заказ",
        "name_field": "specification_name",
        "cascade": [],
        "blocking": [],
        # orders have no FK dependents; exploded operations are linked to project, not order
    },
    "routing": {
        "model": Routing,
        "label": "Маршрут",
        "name_field": "name",
        "cascade": [
            ("routing_ops", RoutingOperation, "routing_id", "name"),
        ],
        "blocking": [
            ("bom_nodes", ProductStructure, "routing_id", "nomenclature_name"),
        ],
    },
    "operation": {
        "model": Operation,
        "label": "Операция",
        "name_field": "name",
        "cascade": [
            ("deps_as_pred", OperationDependency, "predecessor_id", "dependency_type + successor_id"),
            ("deps_as_succ", OperationDependency, "successor_id", "dependency_type + predecessor_id"),
            ("resources", OperationResource, "operation_id", "role + resource_id"),
        ],
        "blocking": [
            ("actual_executions", ActualExecution, "operation_id", "status"),
            ("inter_project_deps_source", InterProjectDependency, "source_operation_id", "notes"),
            ("inter_project_deps_target", InterProjectDependency, "target_operation_id", "notes"),
        ],
    },
    "resource_calendar": {
        "model": ResourceCalendar,
        "label": "Календарь ресурса",
        "name_field": "name",
        "cascade": [
            ("slots", ResourceCalendarSlot, "calendar_id", "day_of_week"),
        ],
        "blocking": [],
    },
}

# Labels for cascade entries
CASCADE_LABELS = {
    "orders": "Заказы",
    "operations": "Операции",
    "resources": "Ресурсы",
    "groups": "Группы",
    "pools": "Пулы",
    "bom_nodes": "Узлы BOM",
    "baselines": "Версии плана",
    "calendars": "Календари",
    "routing_ops": "Операции маршрута",
    "deps_as_pred": "Зависимости (предшественник)",
    "deps_as_succ": "Зависимости (последователь)",
    "slots": "Слоты",
}

BLOCKING_LABELS = {
    "operation_resources": "Связи операций с ресурсами",
    "nomenclature": "Единицы номенклатуры",
    "orders": "Заказы",
    "pools": "Пулы",
    "bom_nodes": "Узлы BOM",
    "actual_executions": "Фактическое выполнение",
    "inter_project_deps_source": "Межпроектные зависимости (источник)",
    "inter_project_deps_target": "Межпроектные зависимости (цель)",
}


@router.get("/delete-check/{entity_type}/{entity_id}")
def delete_check(
    entity_type: str,
    entity_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
):
    """
    Проверить возможность удаления сущности.
    Возвращает:
    - entity: информация о самой сущности
    - cascade: список объектов, которые будут удалены каскадно
    - blocking: список объектов, которые блокируют удаление (ссылаются на сущность)
    - can_delete: bool
    """
    if entity_type not in DEPENDENCY_MAP:
        raise HTTPException(400, f"Неизвестный тип сущности: {entity_type}")

    info = DEPENDENCY_MAP[entity_type]
    model = info["model"]
    name_field = info["name_field"]

    # 1. Fetch entity itself
    entity = (
        db.query(model)
        .filter(model.id == entity_id, model.tenant_id == tenant_id)
        .first()
    )
    if not entity:
        raise HTTPException(404, f"{info['label']} не найден")

    entity_name = getattr(entity, name_field) if hasattr(entity, name_field) else str(entity.id)

    result = {
        "entity": {
            "type": entity_type,
            "id": str(entity.id),
            "name": str(entity_name),
            "label": info["label"],
        },
        "cascade": [],
        "blocking": [],
        "can_delete": True,
    }

    # 2. Cascade dependencies — count them
    for key, dep_model, fk_field, name_col in info["cascade"]:
        try:
            count = (
                db.query(func.count(dep_model.id))
                .filter(getattr(dep_model, fk_field) == entity_id)
                .scalar()
            )
        except Exception:
            continue

        if count > 0:
            # fetch a few names for display (max 5)
            rows = (
                db.query(dep_model)
                .filter(getattr(dep_model, fk_field) == entity_id)
                .limit(5)
                .all()
            )
            items = []
            for r in rows:
                items.append(_describe_row(r, name_col))

            result["cascade"].append({
                "key": key,
                "label": CASCADE_LABELS.get(key, key),
                "count": count,
                "items": items,
            })

    # 3. Blocking dependencies — count them
    for key, dep_model, fk_field, name_col in info.get("blocking", []):
        try:
            count = (
                db.query(func.count(dep_model.id))
                .filter(
                    getattr(dep_model, fk_field) == entity_id,
                )
                .scalar()
            )
        except Exception:
            continue

        if count > 0:
            rows = (
                db.query(dep_model)
                .filter(getattr(dep_model, fk_field) == entity_id)
                .limit(5)
                .all()
            )
            items = []
            for r in rows:
                items.append(_describe_row(r, name_col))

            result["blocking"].append({
                "key": key,
                "label": BLOCKING_LABELS.get(key, key),
                "count": count,
                "items": items,
            })
            result["can_delete"] = False

    # 4. Custom checks for entities with string-based / non-FK references

    if entity_type == "nomenclature":
        # Check product_structures where nomenclature_id matches ext_id
        ext_id = getattr(entity, "ext_id", None)
        if ext_id:
            bom_count = (
                db.query(func.count(ProductStructure.id))
                .filter(ProductStructure.nomenclature_id == ext_id)
                .scalar()
            )
            if bom_count > 0:
                rows = (
                    db.query(ProductStructure)
                    .filter(ProductStructure.nomenclature_id == ext_id)
                    .limit(5)
                    .all()
                )
                items = [{"name": r.nomenclature_name or "—", "field": "BOM"} for r in rows]
                result["blocking"].append({
                    "key": "bom_nodes",
                    "label": "Узлы BOM (по ext_id)",
                    "count": bom_count,
                    "items": items,
                })
                result["can_delete"] = False

    if entity_type == "order":
        # Check routing_operations where input_materials JSON contains order info
        # Also check if there are operations linked to this order via exploded BOM
        # For now: orders have no FK dependents, so can_delete = True unless we add checks
        pass

    return result


@router.delete("/safe-delete/{entity_type}/{entity_id}")
def safe_delete(
    entity_type: str,
    entity_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
):
    """
    Безопасное удаление: выполняет ту же проверку что и delete-check,
    и удаляет только если нет блокирующих ссылок.
    """
    # Reuse the same check
    check = delete_check(
        entity_type=entity_type,
        entity_id=entity_id,
        tenant_id=tenant_id,
        db=db,
    )

    if not check["can_delete"]:
        raise HTTPException(
            409,
            f"Невозможно удалить: есть {sum(b.get('count', 0) for b in check['blocking'])} блокирующих ссылок",
        )

    info = DEPENDENCY_MAP.get(entity_type)
    if not info:
        raise HTTPException(400, f"Неизвестный тип сущности: {entity_type}")

    model = info["model"]
    entity = (
        db.query(model)
        .filter(model.id == entity_id, model.tenant_id == tenant_id)
        .first()
    )
    if not entity:
        raise HTTPException(404, f"{info['label']} не найден")

    db.delete(entity)
    db.commit()

    return {
        "deleted": {
            "type": entity_type,
            "id": str(entity_id),
            "name": check["entity"]["name"],
        },
        "cascade_removed": check["cascade"],
    }


def _describe_row(row, name_col: str) -> dict:
    """Extract display name from a model row."""
    parts = []
    for part in name_col.split(" + "):
        part = part.strip()
        if part.startswith("'") and part.endswith("'"):
            # literal string
            parts.append(part.strip("'"))
        elif hasattr(row, part):
            val = getattr(row, part)
            parts.append(str(val) if val is not None else "—")
        else:
            parts.append(part)
    return {"name": " · ".join(parts)}
