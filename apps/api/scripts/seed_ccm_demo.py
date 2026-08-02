"""
Seed-скрипт: демонстрационные данные для CCM Level 1.

Создаёт:
- 3 проекта (заказа на производство) с общими ресурсами
- 3 спецификации (BOM-деревья)
- 3 техмаршрута с операциями
- Развёрнутые CPM-операции в каждом проекте
- Межпроектные зависимости

Запуск:
    cd apps/api
    python -m scripts.seed_ccm_demo
"""
import asyncio
import os
import sys
from decimal import Decimal
from uuid import uuid4

# Добавляем путь к приложению
sys.path.insert(0, '/app')
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.tenant import Tenant, User, UserTenant
from app.models.project import Project
from app.models.resource import Resource
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.product_structure import ProductStructure
from app.models.routing import Routing, RoutingOperation
from app.models.plan_version import PlanBaseline, InterProjectDependency


async def seed_demo(db: AsyncSession):
    """Основная функция заполнения демо-данными."""
    print("Seed CCM Demo — запуск...")

    # === 1. Tenant + User ===
    tenant = Tenant(
        id=uuid4(),
        name="Демо-завод «СибСтройМаш»",
    )
    db.add(tenant)
    await db.flush()

    user = User(
        id=uuid4(),
        email="planner@demo.ru",
        hashed_password="demo_hash",
        name="Планировщик Иван",
    )
    db.add(user)
    await db.flush()

    # Связь user -> tenant
    user_tenant = UserTenant(
        id=uuid4(),
        user_id=user.id,
        tenant_id=tenant.id,
        role="Planner",
    )
    db.add(user_tenant)
    await db.flush()

    print(f"  [OK] Tenant: {tenant.name}")

    # === 2. Ресурсы (общие для всех проектов) ===
    res_defs = [
        ("CNC-01", "ЧПУ-1", "equipment", 5.0, "pcs"),
        ("CNC-02", "ЧПУ-2", "equipment", 8.0, "pcs"),
        ("WELD-01", "Сварочный пост", "equipment", 10.0, "pcs"),
        ("PAINT-01", "Покрасочная камера", "equipment", 15.0, "pcs"),
        ("QC-STATION", "ОТК", "equipment", 20.0, "pcs"),
        ("TEST-BENCH", "Испытательный стенд", "equipment", 6.0, "pcs"),
        ("FURNACE", "Термопечь", "equipment", 3.0, "pcs"),
        ("ASSY-01", "Сборочный пост", "equipment", 4.0, "pcs"),
    ]
    resources = {}
    for ext_id, name, rtype, cap, unit in res_defs:
        res = Resource(
            id=uuid4(),
            tenant_id=tenant.id,
            project_id=None,  # общий ресурс
            name=name,
            resource_type=rtype,
            capacity_per_unit=Decimal(str(cap)),
            unit=unit,
            ext_id=ext_id,
        )
        db.add(res)
        resources[ext_id] = res
    await db.flush()
    print(f"  [OK] Ресурсов: {len(resources)}")

    # === 3. Создаём проекты ===
    project_ids = []
    for pdata in [
        ("P1", "Редуктор Р-200 партия 100", "SPEC-001", 100, "2026-08-01", "2026-08-25", "high", "СибСтрой"),
        ("P2", "Редуктор Р-200 партия 50", "SPEC-001", 50, "2026-08-05", "2026-08-30", "normal", "МеталлТех"),
        ("P3", "Привод П-100 партия 30", "SPEC-002", 30, "2026-08-01", "2026-09-15", "critical", "УралМаш"),
    ]:
        proj = Project(
            id=uuid4(),
            tenant_id=tenant.id,
            name=pdata[1],
            ext_id=pdata[0],
            status="active",
            default_method="cpm",
            due_date=__parse_date(pdata[5]),
            priority=pdata[6],
            customer=pdata[7],
            created_by=user.id,
        )
        db.add(proj)
        project_ids.append(proj)
    await db.flush()
    print(f"  [OK] Проектов: {len(project_ids)}")

    # === 4. BOM-деревья ===
    # SPEC-001: Редуктор Р-200 (для P1 и P2)
    spec_nodes = []
    # Корень
    r200_root = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        nomenclature_id="SPEC-001",
        nomenclature_name="Редуктор Р-200",
        node_type="assembly",
        is_make_or_buy="make",
        quantity_per_parent=Decimal("1"),
        unit="pcs",
        path="1",
    )
    db.add(r200_root)
    await db.flush()
    spec_nodes.append(r200_root)

    # Уровень 1: корпус в сборе
    housing = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=r200_root.id,
        nomenclature_id="N-1001",
        nomenclature_name="Корпус в сборе",
        node_type="semi_finished",
        is_make_or_buy="make",
        quantity_per_parent=Decimal("1"),
        unit="pcs",
        path="1/1",
    )
    db.add(housing)
    spec_nodes.append(housing)

    # Уровень 1: вал-шестерня
    shaft = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=r200_root.id,
        nomenclature_id="N-1002",
        nomenclature_name="Вал-шестерня",
        node_type="semi_finished",
        is_make_or_buy="make",
        quantity_per_parent=Decimal("2"),
        unit="pcs",
        path="1/2",
    )
    db.add(shaft)
    spec_nodes.append(shaft)

    # Материал: сталь 40Х
    steel = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=shaft.id,
        nomenclature_id="M-2001",
        nomenclature_name="Сталь 40Х ø120",
        node_type="material",
        is_make_or_buy="buy",
        quantity_per_parent=Decimal("12"),
        unit="kg",
        procurement_lead_time_days=Decimal("14"),
        path="1/2/1",
    )
    db.add(steel)

    # Материал: чугун СЧ20
    iron = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=housing.id,
        nomenclature_id="M-2002",
        nomenclature_name="Чугун СЧ20",
        node_type="material",
        is_make_or_buy="buy",
        quantity_per_parent=Decimal("45"),
        unit="kg",
        procurement_lead_time_days=Decimal("10"),
        path="1/1/1",
    )
    db.add(iron)

    # Материал: подшипник
    bearing = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=r200_root.id,
        nomenclature_id="M-3001",
        nomenclature_name="Подшипник 6208",
        node_type="material",
        is_make_or_buy="buy",
        quantity_per_parent=Decimal("4"),
        unit="pcs",
        procurement_lead_time_days=Decimal("7"),
        path="1/3",
    )
    db.add(bearing)

    await db.flush()
    print(f"  [OK] BOM-узлов SPEC-001: 6")

    # SPEC-002: Привод П-100 (для P3)
    drive_root = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        nomenclature_id="SPEC-002",
        nomenclature_name="Привод П-100",
        node_type="assembly",
        is_make_or_buy="make",
        quantity_per_parent=Decimal("1"),
        unit="pcs",
        path="1",
    )
    db.add(drive_root)
    await db.flush()

    drive_shaft = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=drive_root.id,
        nomenclature_id="N-1002",
        nomenclature_name="Вал-шестерня",
        node_type="semi_finished",
        is_make_or_buy="make",
        quantity_per_parent=Decimal("1"),
        unit="pcs",
        path="1/1",
    )
    db.add(drive_shaft)

    drive_steel = ProductStructure(
        id=uuid4(),
        tenant_id=tenant.id,
        parent_id=drive_shaft.id,
        nomenclature_id="M-2001",
        nomenclature_name="Сталь 40Х ø120",
        node_type="material",
        is_make_or_buy="buy",
        quantity_per_parent=Decimal("12"),
        unit="kg",
        procurement_lead_time_days=Decimal("14"),
        path="1/1/1",
    )
    db.add(drive_steel)

    await db.flush()
    print(f"  [OK] BOM-узлов SPEC-002: 3")

    # === 5. Техмаршруты ===
    # Маршрут 1: Вал-шестерня
    r_shaft = Routing(
        id=uuid4(),
        tenant_id=tenant.id,
        name="Изготовление Вал-шестерни",
        product_node_id=shaft.id,
        spec_id="SPEC-001",
        variant="Основной",
        is_default=True,
    )
    db.add(r_shaft)
    await db.flush()

    shaft_ops = [
        RoutingOperation(routing_id=r_shaft.id, sequence_number=1, name="Токарная обработка",
                         duration_hours=Decimal("4"), setup_hours=Decimal("1"),
                         resource_type_id="CNC-01", output_product="N-1002",
                         output_quantity=Decimal("1"), yield_rate=Decimal("0.97")),
        RoutingOperation(routing_id=r_shaft.id, sequence_number=2, name="Термообработка",
                         duration_hours=Decimal("6"), setup_hours=Decimal("0.5"),
                         resource_type_id="FURNACE", predecessors="1",
                         yield_rate=Decimal("1.0")),
        RoutingOperation(routing_id=r_shaft.id, sequence_number=3, name="Шлифовка",
                         duration_hours=Decimal("3"), setup_hours=Decimal("0.5"),
                         resource_type_id="CNC-02", predecessors="2",
                         output_product="N-1002-FIN", output_quantity=Decimal("1"),
                         yield_rate=Decimal("0.99")),
    ]
    for op in shaft_ops:
        db.add(op)

    # Маршрут 2: Корпус в сборе
    r_housing = Routing(
        id=uuid4(),
        tenant_id=tenant.id,
        name="Изготовление Корпуса",
        product_node_id=housing.id,
        spec_id="SPEC-001",
        variant="Основной",
        is_default=True,
    )
    db.add(r_housing)
    await db.flush()

    housing_ops = [
        RoutingOperation(routing_id=r_housing.id, sequence_number=1, name="Фрезеровка",
                         duration_hours=Decimal("4"), setup_hours=Decimal("1"),
                         resource_type_id="CNC-01", yield_rate=Decimal("0.95"),
                         input_materials='[{"id":"M-2002","qty":45,"unit":"kg"}]'),
        RoutingOperation(routing_id=r_housing.id, sequence_number=2, name="Сверление",
                         duration_hours=Decimal("1.5"), setup_hours=Decimal("0.5"),
                         resource_type_id="CNC-02", predecessors="1",
                         output_product="N-1001", output_quantity=Decimal("1"),
                         yield_rate=Decimal("0.98")),
    ]
    for op in housing_ops:
        db.add(op)

    # Маршрут 3: Сборка редуктора
    r_assembly = Routing(
        id=uuid4(),
        tenant_id=tenant.id,
        name="Сборка редуктора",
        product_node_id=r200_root.id,
        spec_id="SPEC-001",
        variant="Основной",
        is_default=True,
    )
    db.add(r_assembly)
    await db.flush()

    assembly_ops = [
        RoutingOperation(routing_id=r_assembly.id, sequence_number=1, name="Сборка редуктора",
                         duration_hours=Decimal("6"),
                         resource_type_id="ASSY-01", yield_rate=Decimal("0.99")),
        RoutingOperation(routing_id=r_assembly.id, sequence_number=2, name="Испытания",
                         duration_hours=Decimal("2"),
                         resource_type_id="TEST-BENCH", predecessors="1",
                         yield_rate=Decimal("1.0")),
    ]
    for op in assembly_ops:
        db.add(op)

    # Маршрут 4: Привод П-100 (сборка)
    r_drive = Routing(
        id=uuid4(),
        tenant_id=tenant.id,
        name="Сборка привода",
        product_node_id=drive_root.id,
        spec_id="SPEC-002",
        variant="Основной",
        is_default=True,
    )
    db.add(r_drive)
    await db.flush()

    drive_ops = [
        RoutingOperation(routing_id=r_drive.id, sequence_number=1, name="Сборка привода",
                         duration_hours=Decimal("8"),
                         resource_type_id="ASSY-01", yield_rate=Decimal("0.98")),
        RoutingOperation(routing_id=r_drive.id, sequence_number=2, name="Испытания",
                         duration_hours=Decimal("3"),
                         resource_type_id="TEST-BENCH", predecessors="1",
                         yield_rate=Decimal("1.0")),
    ]
    for op in drive_ops:
        db.add(op)

    await db.flush()
    print(f"  [OK] Маршрутов: 4, операций маршрута: 9")

    # Привязываем routing_id к BOM-узлам
    shaft.routing_id = r_shaft.id
    housing.routing_id = r_housing.id
    r200_root.routing_id = r_assembly.id
    drive_root.routing_id = r_drive.id
    await db.flush()

    # === 6. Создаём CPM-операции для каждого проекта ===

    def make_op(project, name, duration, setup=0, teardown=0, op_type="production",
                resource_ext_id=None, predecessors=None, ext_id=None, output_product=None):
        op = Operation(
            id=uuid4(),
            tenant_id=tenant.id,
            project_id=project.id,
            name=name,
            duration_base=Decimal(str(duration)),
            setup_time=Decimal(str(setup)),
            teardown_time=Decimal(str(teardown)),
            operation_type=op_type,
            ext_id=ext_id,
            output_product=output_product,
        )
        db.add(op)
        return op

    def link_deps(predecessor, successor, dep_type="FS", lag=0):
        dep = OperationDependency(
            id=uuid4(),
            predecessor_id=predecessor.id,
            successor_id=successor.id,
            dependency_type=dep_type,
            lag_time=Decimal(str(lag)),
        )
        db.add(dep)
        return dep

    def assign_resource(op, resource, role="primary"):
        ass = OperationResource(
            id=uuid4(),
            operation_id=op.id,
            resource_id=resource.id,
            role=role,
        )
        db.add(ass)
        return ass

    # --- P1: Редуктор Р-200 × 100 ---
    p1 = project_ids[0]
    p1_ops = {}

    # Закупка стали (14 дней × 24ч = 336 ч)
    p1_ops["proc_steel"] = make_op(p1, "Закупка: Сталь 40Х (2400 кг)", 336,
                                   op_type="procurement", ext_id="PROC-P1-STEEL")
    # Закупка чугуна (10 дней × 24ч = 240 ч)
    p1_ops["proc_iron"] = make_op(p1, "Закупка: Чугун СЧ20 (4500 кг)", 240,
                                  op_type="procurement", ext_id="PROC-P1-IRON")
    # Закупка подшипников (7 дней × 24ч = 168 ч)
    p1_ops["proc_bearing"] = make_op(p1, "Закупка: Подшипник 6208 (400 шт)", 168,
                                     op_type="procurement", ext_id="PROC-P1-BEARING")

    # Операции вала-шестерни (на 200 шт — норма 1 шт за 4ч, нужно 800ч)
    p1_ops["shaft_turning"] = make_op(p1, "Токарная: Вал-шестерня (200 шт)", 800, 1,
                                      op_type="production", ext_id="P1-OP-001",
                                      output_product="N-1002")
    assign_resource(p1_ops["shaft_turning"], resources["CNC-01"])

    p1_ops["shaft_heat"] = make_op(p1, "Термообработка: Вал-шестерня", 600, 0.5,
                                   op_type="production", ext_id="P1-OP-002")
    assign_resource(p1_ops["shaft_heat"], resources["FURNACE"])

    p1_ops["shaft_grind"] = make_op(p1, "Шлифовка: Вал-шестерня", 300, 0.5,
                                    op_type="production", ext_id="P1-OP-003",
                                    output_product="N-1002-FIN")
    assign_resource(p1_ops["shaft_grind"], resources["CNC-02"])

    # Операции корпуса (на 100 шт — норма 1 шт за 4ч, нужно 400ч)
    p1_ops["housing_mill"] = make_op(p1, "Фрезеровка: Корпус (100 шт)", 400, 1,
                                     op_type="production", ext_id="P1-OP-004")
    assign_resource(p1_ops["housing_mill"], resources["CNC-01"])

    p1_ops["housing_drill"] = make_op(p1, "Сверление: Корпус", 150, 0.5,
                                      op_type="production", ext_id="P1-OP-005",
                                      output_product="N-1001")
    assign_resource(p1_ops["housing_drill"], resources["CNC-02"])

    # Сборка + испытания
    p1_ops["assembly"] = make_op(p1, "Сборка редуктора", 600,
                                 op_type="assembly", ext_id="P1-OP-006")
    assign_resource(p1_ops["assembly"], resources["ASSY-01"])

    p1_ops["test"] = make_op(p1, "Испытания", 200,
                             op_type="quality_check", ext_id="P1-OP-007")
    assign_resource(p1_ops["test"], resources["TEST-BENCH"])

    # Связи P1
    link_deps(p1_ops["proc_steel"], p1_ops["shaft_turning"])
    link_deps(p1_ops["shaft_turning"], p1_ops["shaft_heat"])
    link_deps(p1_ops["shaft_heat"], p1_ops["shaft_grind"])
    link_deps(p1_ops["proc_iron"], p1_ops["housing_mill"])
    link_deps(p1_ops["housing_mill"], p1_ops["housing_drill"])
    link_deps(p1_ops["shaft_grind"], p1_ops["assembly"])
    link_deps(p1_ops["housing_drill"], p1_ops["assembly"])
    link_deps(p1_ops["proc_bearing"], p1_ops["assembly"])
    link_deps(p1_ops["assembly"], p1_ops["test"])

    await db.flush()
    print(f"  [OK] P1: {len(p1_ops)} операций")

    # --- P2: Редуктор Р-200 × 50 ---
    p2 = project_ids[1]
    p2_ops = {}

    p2_ops["proc_steel"] = make_op(p2, "Закупка: Сталь 40Х (1200 кг)", 336,
                                   op_type="procurement", ext_id="PROC-P2-STEEL")
    p2_ops["proc_iron"] = make_op(p2, "Закупка: Чугун СЧ20 (2250 кг)", 240,
                                  op_type="procurement", ext_id="PROC-P2-IRON")
    p2_ops["proc_bearing"] = make_op(p2, "Закупка: Подшипник 6208 (200 шт)", 168,
                                     op_type="procurement", ext_id="PROC-P2-BEARING")

    p2_ops["shaft_turning"] = make_op(p2, "Токарная: Вал-шестерня (100 шт)", 400, 1,
                                      ext_id="P2-OP-001", output_product="N-1002")
    assign_resource(p2_ops["shaft_turning"], resources["CNC-01"])

    p2_ops["shaft_heat"] = make_op(p2, "Термообработка: Вал-шестерня", 300, 0.5,
                                   ext_id="P2-OP-002")
    assign_resource(p2_ops["shaft_heat"], resources["FURNACE"])

    p2_ops["shaft_grind"] = make_op(p2, "Шлифовка: Вал-шестерня", 150, 0.5,
                                    ext_id="P2-OP-003", output_product="N-1002-FIN")
    assign_resource(p2_ops["shaft_grind"], resources["CNC-02"])

    p2_ops["housing_mill"] = make_op(p2, "Фрезеровка: Корпус (50 шт)", 200, 1,
                                     ext_id="P2-OP-004")
    assign_resource(p2_ops["housing_mill"], resources["CNC-01"])

    p2_ops["housing_drill"] = make_op(p2, "Сверление: Корпус", 75, 0.5,
                                      ext_id="P2-OP-005", output_product="N-1001")
    assign_resource(p2_ops["housing_drill"], resources["CNC-02"])

    p2_ops["assembly"] = make_op(p2, "Сборка редуктора", 300,
                                 op_type="assembly", ext_id="P2-OP-006")
    assign_resource(p2_ops["assembly"], resources["ASSY-01"])

    p2_ops["test"] = make_op(p2, "Испытания", 100,
                             op_type="quality_check", ext_id="P2-OP-007")
    assign_resource(p2_ops["test"], resources["TEST-BENCH"])

    # Связи P2
    link_deps(p2_ops["proc_steel"], p2_ops["shaft_turning"])
    link_deps(p2_ops["shaft_turning"], p2_ops["shaft_heat"])
    link_deps(p2_ops["shaft_heat"], p2_ops["shaft_grind"])
    link_deps(p2_ops["proc_iron"], p2_ops["housing_mill"])
    link_deps(p2_ops["housing_mill"], p2_ops["housing_drill"])
    link_deps(p2_ops["shaft_grind"], p2_ops["assembly"])
    link_deps(p2_ops["housing_drill"], p2_ops["assembly"])
    link_deps(p2_ops["proc_bearing"], p2_ops["assembly"])
    link_deps(p2_ops["assembly"], p2_ops["test"])

    await db.flush()
    print(f"  [OK] P2: {len(p2_ops)} операций")

    # --- P3: Привод П-100 × 30 ---
    p3 = project_ids[2]
    p3_ops = {}

    p3_ops["proc_steel"] = make_op(p3, "Закупка: Сталь 40Х (360 кг)", 336,
                                   op_type="procurement", ext_id="PROC-P3-STEEL")

    p3_ops["shaft_turning"] = make_op(p3, "Токарная: Вал-шестерня (30 шт)", 120, 1,
                                      ext_id="P3-OP-001", output_product="N-1002")
    assign_resource(p3_ops["shaft_turning"], resources["CNC-01"])

    p3_ops["shaft_heat"] = make_op(p3, "Термообработка: Вал-шестерня", 180, 0.5,
                                   ext_id="P3-OP-002")
    assign_resource(p3_ops["shaft_heat"], resources["FURNACE"])

    p3_ops["shaft_grind"] = make_op(p3, "Шлифовка: Вал-шестерня", 90, 0.5,
                                    ext_id="P3-OP-003", output_product="N-1002-FIN")
    assign_resource(p3_ops["shaft_grind"], resources["CNC-02"])

    p3_ops["assembly"] = make_op(p3, "Сборка привода", 240,
                                 op_type="assembly", ext_id="P3-OP-004")
    assign_resource(p3_ops["assembly"], resources["ASSY-01"])

    p3_ops["test"] = make_op(p3, "Испытания", 90,
                             op_type="quality_check", ext_id="P3-OP-005")
    assign_resource(p3_ops["test"], resources["TEST-BENCH"])

    # Связи P3
    link_deps(p3_ops["proc_steel"], p3_ops["shaft_turning"])
    link_deps(p3_ops["shaft_turning"], p3_ops["shaft_heat"])
    link_deps(p3_ops["shaft_heat"], p3_ops["shaft_grind"])
    link_deps(p3_ops["shaft_grind"], p3_ops["assembly"])
    link_deps(p3_ops["assembly"], p3_ops["test"])

    await db.flush()
    print(f"  [OK] P3: {len(p3_ops)} операций")

    # === 7. Межпроектные зависимости ===
    # P1 и P2 используют общую закупку стали (можно объединить)
    steel_dep = InterProjectDependency(
        id=uuid4(),
        source_project_id=p1.id,
        source_operation_id=p1_ops["proc_steel"].id,
        target_project_id=p2.id,
        target_operation_id=p2_ops["shaft_turning"].id,
        dependency_type="FS",
        lag_hours=Decimal("0"),
        created_by="auto_from_bom",
        notes="Общий материал Сталь 40Х — предлагается сводная закупка",
    )
    db.add(steel_dep)

    # P1 и P3 используют одну сталь — сводная закупка
    steel_dep2 = InterProjectDependency(
        id=uuid4(),
        source_project_id=p1.id,
        source_operation_id=p1_ops["proc_steel"].id,
        target_project_id=p3.id,
        target_operation_id=p3_ops["shaft_turning"].id,
        dependency_type="FS",
        lag_hours=Decimal("0"),
        created_by="auto_from_bom",
        notes="Общий материал Сталь 40Х — предлагается сводная закупка",
    )
    db.add(steel_dep2)

    # P1 и P2 изготавливают одинаковый Вал-шестерню на CNC-01 → ресурсный конфликт
    res_dep = InterProjectDependency(
        id=uuid4(),
        source_project_id=p1.id,
        source_operation_id=p1_ops["shaft_turning"].id,
        target_project_id=p2.id,
        target_operation_id=p2_ops["shaft_turning"].id,
        dependency_type="FS",
        lag_hours=Decimal("0"),
        created_by="auto_from_resources",
        notes="Общий ресурс CNC-01 для токарной обработки Валов-шестерен",
    )
    db.add(res_dep)

    await db.flush()
    print(f"  [OK] Межпроектных зависимостей: 3")

    # === 8. Создаём baseline для P1 ===
    baseline = PlanBaseline(
        id=uuid4(),
        project_id=p1.id,
        version=1,
        name="Исходный план P1 от 01.08.2026",
        is_active=True,
        snapshot_data={
            "total_duration": 1876,
            "critical_path": [str(p1_ops["proc_steel"].id),
                            str(p1_ops["shaft_turning"].id),
                            str(p1_ops["shaft_heat"].id),
                            str(p1_ops["shaft_grind"].id),
                            str(p1_ops["assembly"].id),
                            str(p1_ops["test"].id)],
            "node_count": len(p1_ops),
        },
    )
    db.add(baseline)
    print(f"  [OK] Baseline P1 создан")

    await db.commit()
    print("\n🎉 Seed CCM Demo завершён!")
    print(f"  Tenant:     {tenant.id}")
    print(f"  User:       {user.id} (planner@demo.ru)")
    print(f"  Проекты:    {[str(p.id) for p in project_ids]}")
    print(f"  Операций:   P1={len(p1_ops)} P2={len(p2_ops)} P3={len(p3_ops)}")
    print(f"  BOM-узлов:  9 (SPEC-001=6, SPEC-002=3)")
    print(f"  Маршрутов:  4")
    print(f"  Ресурсов:   8 (общих)")

    return tenant.id, [str(p.id) for p in project_ids]


def __parse_date(date_str: str):
    """Парсит дату из строки YYYY-MM-DD."""
    from datetime import datetime, timezone
    return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)


async def main():
    """Точка входа."""
    DATABASE_URL = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://profyplan:profyplan@localhost:5432/profyplan",
    )
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        try:
            tenant_id, project_ids = await seed_demo(session)
            print(f"\n[list] Для тестирования CCM:")
            print(f"  POST /v1/ccm/merge  body: {{'project_ids': {project_ids}}}")
            print(f"  POST /v1/ccm/projects/{project_ids[0]}/resource-leveling")
        except Exception as e:
            await session.rollback()
            print(f"[ERR] Ошибка: {e}")
            raise


if __name__ == "__main__":
    asyncio.run(main())
