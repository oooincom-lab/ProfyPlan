# ProfyPlan CCM — Спецификация архитектуры (План + Динамика)

> Версия: 2.1 | Дата: 2026-08-08 | Статус: реализовано (CPM Lite + Resource Leveling + Справочники + Рабочий стол), проектируется (Heavy CCM)

## 1. Концепция

ProfyPlan использует двухслойную архитектуру «План + Динамика» для всех уровней планирования:

- **План** — предварительный расчёт (что если). Замороженный Baseline, против которого меряется факт.
- **Динамика** — рабочий граф с фиксацией фактического выполнения, автозакрытием цепочек и пересчётом прогноза.

Эта модель тиражируется на оба уровня:
- **CPM Lite** — однопроектный критический путь (✅ реализовано)
- **Heavy CCM** — мультипроектный граф с BOM, ресурсами и снабжением (⚠️ реализовано: merge + resource-leveling + календари; проектируется: полный BOM→CPM, снабжение, batch, ERP-интеграция)

### Три слоя архитектуры CCM

| Слой | Назначение | Статус |
|---|---|---|
| **CPM Engine** | Расчёт ES/EF/LS/LF/TF/FF, критпуть | ✅ |
| **Resource Engine** | SGS-выравнивание, календари, конфликты | ✅ |
| **APS Engine** | CP-SAT/OR-Tools оптимизация, batch scheduling | 🔲 Post-MVP |

### Уровни зрелости по тарифам

| Функция | Старт | Про | Корпоратив |
|---|---|---|---|
| CPM (расчёт) | ✅ | ✅ | ✅ |
| Сетевой график | ✅ | ✅ | ✅ |
| **Диаграмма Ганта** | ✅ | ✅ | ✅ |
| PERT + риски | — | ✅ | ✅ |
| Multi-Project CCM | — | ✅ | ✅ |
| BOM-развёртка | — | ✅ | ✅ |
| Resource Leveling | — | ✅ | ✅ |
| Baseline / Actual / Forecast | — | ✅ | ✅ |
| Экспорт JSON для ERP | — | ✅ | ✅ |
| Batch Scheduling | — | — | ✅ |
| Bottleneck Analysis | — | — | ✅ |

> ⚠️ Гант и сетевой график — средства **визуализации**, а не методы расчёта. Доступны на всех тарифах.

---

## 2. Модель данных (полная)

### 2.0 ext_id — внешний идентификатор для ERP-интеграции

**Все создаваемые сущности должны иметь поле `ext_id: str | None`** — внешний идентификатор из ERP/1С. Это мост для обратной интеграции:

- При импорте из Excel — заполняется из колонки «Внешний ID»
- При экспорте в ERP — возвращается в JSON
- Без `ext_id` ERP не сможет сопоставить свои данные с результатами ProfyPlan

**Сущности с ext_id:**
- `projects.ext_id`
- `operations.ext_id`
- `resources.ext_id`
- `product_structure_nodes.ext_id` (BOM-узлы)
- `routing_templates.ext_id` (техмаршруты)

### 2.1 PlanBaseline — замороженный снимок плана

```
plan_baselines
├── project_id     → FK projects
├── version        → int (автоинкремент)
├── name           → str
├── snapshot_data  → JSONB (граф + CPM-результат на момент заморозки)
├── is_active      → bool
├── notes          → text
└── created_by     → FK users
```

**Поведение:**
- При создании Baseline фиксируется полный граф в `snapshot_data`
- Только один Baseline может быть активным на проект
- Baseline неизменяем — только создаётся новый с инкрементом версии

### 2.2 ActualExecution — факт по операции

```
actual_executions
├── operation_id       → FK operations (уникальный)
├── fact_start         → datetime
├── fact_end           → datetime
├── quantity_completed → decimal
├── quantity_defect    → decimal
├── status             → enum: not_started | in_progress | completed | delayed | cancelled
├── deviation_reason   → text
├── comment            → text
├── source             → enum: manual | auto_closed | google_sheets | erp_sync
├── recorded_by        → FK users
├── recorded_at        → datetime
├── updated_at         → datetime (автообновление)
└── edit_count         → int
```

### 2.3 InterProjectDependency — межпроектная связь

```
inter_project_dependencies
├── source_project_id / source_operation_id
├── target_project_id / target_operation_id
├── dependency_type  → FS | SS | FF | SF
├── lag_hours        → decimal
├── lag_unit         → hour | day
├── created_by       → manual | auto_from_bom | auto_from_resources | auto_from_common_semi_finished
└── notes
```

**Типы автоматического создания:**
- `auto_from_bom` — связь между последней операцией дочернего BOM-узла и первой операцией родительского
- `auto_from_resources` — конфликт ресурсов между проектами (одна и та же единица оборудования)
- `auto_from_common_semi_finished` — несколько заказов потребляют один и тот же полуфабрикат

### 2.4 ProductStructure (BOM-узел) — НОВОЕ

```
product_structure_nodes
├── id              → UUID
├── ext_id          → str | None (внешний ID из ERP)
├── parent_id       → FK self | None (NULL = корень изделия)
├── specification_id → FK product_specifications | None
├── name            → str
├── node_type       → enum: assembly | semi_finished | material | phantom
├── quantity_per_parent → decimal (норма расхода на 1 родительскую единицу)
├── unit            → str (кг, шт, м, л)
├── procurement_lead_time → decimal | None (дни, только для material)
├── is_make_or_buy  → enum: make | buy
├── sort_order      → int
└── notes           → text
```

**Типы узлов:**
- `assembly` — сборочная единица (имеет дочерние узлы + техмаршрут)
- `semi_finished` — полуфабрикат собственного изготовления (имеет техмаршрут)
- `material` — покупной материал (нет техмаршрута, есть срок поставки)
- `phantom` — фантомный узел: существует только в конструкторской документации, не имеет своего маршрута; его материалы «всплывают» в родительский узел
- `routing_template_id` — FK routing_templates | None

### 2.5 ProductSpecification (спецификация как справочник) — НОВОЕ

```
product_specifications
├── id              → UUID
├── ext_id          → str | None
├── name            → str
├── product_name    → str (название изделия)
├── tenant_id       → FK
└── created_at
```

Спецификация — **переиспользуемый шаблон**. Одна спецификация на «Редуктор Р-200» применяется к 10 разным заказам. При создании заказа: `production_order.specification_id → развернуть BOM`.

### 2.6 ProductionOrder (заказ на производство) — НОВОЕ

```
production_orders
├── id              → UUID
├── ext_id          → str | None (ID заказа из 1С: «ЗНП-001»)
├── project_id      → FK projects
├── specification_id → FK product_specifications
├── quantity        → decimal (объём заказа: 100 шт)
├── start_date      → date (плановый запуск)
├── due_date        → date (срок отгрузки)
├── priority        → enum: low | normal | high | critical
├── client          → str | None
└── status          → enum: draft | planned | in_progress | completed
```

**При создании заказа система:**
1. Берёт спецификацию
2. Разворачивает BOM × quantity → потребности в материалах
3. Разворачивает маршруты × quantity → граф операций
4. Применяет start_date → привязка к календарю
5. Запускает CPM → ES/EF/LS/LF/критпуть

### 2.7 RoutingTemplate (техмаршрут) — НОВОЕ

```
routing_templates
├── id              → UUID
├── ext_id          → str | None
├── node_id         → FK product_structure_nodes (BOM-узел типа make)
├── variant_name    → str | None (название варианта, если их несколько)
├── is_default      → bool
└── created_at
```

Один BOM-узел может иметь **несколько вариантов маршрута**: например, корпус можно лить (маршрут А) или сваривать (маршрут Б). CPM-граф строится для выбранного варианта.

### 2.8 RoutingOperation (операция маршрута) — НОВОЕ

```
routing_operations
├── id              → UUID
├── routing_id      → FK routing_templates
├── sequence_number → int (порядковый номер в маршруте)
├── name            → str
├── duration_hours  → decimal
├── resource_type_id → FK | None
├── output_product  → str | None (ID номенклатуры — что производит)
├── output_qty      → decimal | None (сколько производит за цикл)
├── yield_rate      → decimal (default 1.0, 0.95 = 5% брака)
├── predecessor_seq → int | None (№ предыдущей операции в маршруте)
└── additional_materials → JSONB | None [{material_id, qty, unit}]
```

### 2.9 Operation (расширение существующей) — ПОЛЯ ДОБАВЛЯЮТСЯ

К существующей модели `operations` добавляются поля:

```
operations (новые поля)
├── ext_id              → str | None
├── operation_type      → enum: production | procurement | inspection | storage (default: production)
├── output_product      → str | None (ID номенклатуры)
├── output_qty          → decimal | None
├── yield_rate          → decimal (default 1.0)
├── input_materials     → JSONB | None [{material_id, qty, unit}]
├── is_milestone        → bool (default false)
├── milestone_date      → datetime | None (контрольная дата)
├── batch_group_key     → str | None (ключ группировки для batch scheduling)
├── phase_id            → FK project_phases | None (этап, к которому относится операция)
└── department_id       → FK departments | None (подразделение выполнения)
```

**Типы операций:**
- `production` — производственная операция (загружает внутренние ресурсы)
- `procurement` — операция снабжения (загружает календарь поставщика, не загружает внутренние ресурсы)
- `inspection` — контроль качества (загружает ресурс ОТК)
- `storage` — межоперационное хранение (нулевая трудоёмкость, длительность = время пролёживания)

### 2.10 SupplierCalendar — календарь поставщика — НОВОЕ

```
supplier_calendars
├── id              → UUID
├── operation_id    → FK operations (для procurement-операций)
├── name            → str
└── slots           → relationship → SupplierCalendarSlot
```

Аналогично `ResourceCalendar`, но для внешних поставщиков. Поставщик может работать 6/1, иметь праздники другой страны, отгружать только по средам.

### 2.11 Milestone (контрольная точка) — НОВОЕ

Milestone — это операция с `is_milestone=true` и нулевой длительностью. Отмечает ключевые события:
- «Запуск заготовительного производства»
- «Готовность оснастки»
- «Отгрузка первой партии»
- «Акт сдачи-приёмки»

При multi-project merge milestones из разных проектов накладываются на общую временную шкалу.

### 2.12 ProjectPhase (этап проекта / строительства) — НОВОЕ

```
project_phases
├── id                  → UUID
├── project_id          → FK projects
├── name                → str ("Этап 1: Земляные работы")
├── sequence            → int (порядок)
├── depends_on_phase_id → FK self | None (этап Б только после этапа А)
├── lag_hours           → decimal | None (технологический перерыв между этапами)
├── status              → enum: planned | in_progress | completed
└── notes               → text
```

**Поведение:**
- Включается через флаг проекта `projects.uses_phases` (default false)
- Если `uses_phases = false`: поле `operations.phase_id` игнорируется, CPM считает без этапов, импорт не требует вкладки с этапами
- Если `uses_phases = true`: CPM forward pass учитывает зависимости между этапами — ES всех операций этапа = max(ES по CPM, EF последней операции предыдущего этапа + lag)
- Статус этапа автообновляется: все операции completed → этап completed
- Веха между этапами автоматически отображается на Ганте
- При импорте Excel добавляется колонка «Этап» в Маршрутах (или отдельная вкладка для стройки)

**Для строительства:** этапы жёстко секвенируют граф — нельзя начать стены без фундамента. Для производства: можно не использовать, milestone-операций достаточно.

### 2.13 Department (подразделение / структурная единица) — НОВОЕ

```
departments
├── id                  → UUID
├── tenant_id           → FK tenants
├── name                → str ("Цех №3" / "Строительный участок А" / "Склад ГП")
├── type                → enum: workshop | construction_site | warehouse | brigade | section | office
├── parent_id           → FK self | None (иерархия: Завод → Цех → Участок)
├── capacity_per_day    → decimal | None (человеко-часы / маш-часы / м² в сутки)
├── location            → str | None ("Корпус Б, 2 этаж")
└── notes               → text
```

**Привязки:**
- `resources.department_id → FK departments | None` — ресурс территориально привязан к подразделению
- `operations.department_id → FK departments | None` — операция выполняется в конкретном подразделении

**Влияние на CPM и ресурсное выравнивание:**
1. **Resource scoping** — ресурс с `department_id=Цех3` не может быть назначен на операцию с `department_id=Цех5`. CPM проверяет соответствие перед назначением
2. **Inter-department lag** — если операция Б в другом подразделении после операции А, добавляется транспортное время (настраивается в календаре или глобально)
3. **Department capacity** — при SGS-выравнивании проверяется не только доступность конкретного ресурса, но и общая загрузка подразделения (capacity_per_day). Если цех на 100% — операция сдвигается
4. **Bottleneck на уровне подразделений** — анализ показывает: «Цех №3 перегружен (95%), Цех №5 недогружен (30%)» — можно перебросить ресурсы

**Типы подразделений:**
- `workshop` — цех (производство)
- `construction_site` — строительный участок / площадка
- `warehouse` — склад
- `brigade` — бригада (может перемещаться между объектами)
- `section` — участок внутри цеха
- `office` — офис / административное

### 2.14 Project (расширение) — НОВОЕ ПОЛЕ

```
projects (новое поле)
└── uses_phases         → bool (default false) — включает этапное планирование
```

### 2.15 OrderGroup (группа заказов) — НОВОЕ

Группа заказов — визуальное объединение для удобства отображения на временной шкале. Не влияет на расчёты. Аналог папки в Google Диске — опциональна, создаётся по желанию.

```
order_groups
├── id              → UUID
├── project_id      → FK projects
├── name            → str ("Основное производство")
├── sort_order      → int (порядок на экране)
└── notes           → text
```

**Правила:**
- Группа — опциональна. Заказы и пулы могут быть напрямую в проекте без группы
- Группа содержит заказы И/ИЛИ пулы
- Один заказ/пул — только в одной группе
- Группа добавляет визуальный разделитель на временной шкале, не участвует в CPM/CCM

### 2.16 OrderPool (пул заказов) — НОВОЕ

Пул заказов — расчётное объединение для CCM. Все заказы внутри пула объединяются в общий граф, ресурсы становятся общими, критический путь пересчитывается для всего пула. Сдвиг одного заказа в пуле влияет на все остальные.

```
order_pools
├── id              → UUID
├── project_id      → FK projects
├── group_id        → FK order_groups | None (пул может быть в группе или напрямую в проекте)
├── name            → str ("Корпусное производство")
└── notes           → text
```

**Правила размещения заказа в проекте:**
- Заказ либо в группе напрямую (`group_id`), либо в пуле (`pool_id`), либо в корне проекта (оба NULL)
- CONSTRAINT: `(group_id IS NOT NULL AND pool_id IS NULL) OR (group_id IS NULL AND pool_id IS NOT NULL) OR (group_id IS NULL AND pool_id IS NULL)`
- Заказ не может быть одновременно в группе и в пуле
- Пул может быть в группе или напрямую в проекте

**Расширение production_orders:**
```
production_orders (новые поля)
├── group_id         → FK order_groups | None
└── pool_id          → FK order_pools | None
```

**Пример дерева проекта:**
```
Проект «Редуктор Р-200»
├── Заказ «P1: Р-200 ×100»          ← в корне проекта (без группы)
├── Заказ «P2: Р-200 ×50»           ← в корне проекта
├── Пул «Корпусное»                ← CCM: P3+P4 общий граф
│   ├── Заказ «P3: Корпус ×200»
│   └── Заказ «P4: Корпус ×150»
└── Группа «Снабжение»            ← просто визуальная группировка
    ├── Заказ «M1: Чугун»
    └── Пул «Метизы»
        ├── Заказ «M2: Болты»
        └── Заказ «M3: Гайки»
```

---

## 3. Состояния узлов (4 базовых + 1 специальное)

### 2.17 Nomenclature (справочник номенклатуры) — НОВОЕ ✅

```
nomenclature
├── id              → UUID
├── tenant_id       → FK tenants
├── project_id      → FK projects | None
├── name            → str (название)
├── code            → str | None (внутренний код)
├── article         → str | None (VARCHAR 100 — артикул поставщика)
├── ntype           → enum: product | material | semi_finished | service
├── unit            → str (pcs / kg / m — строковый, для быстрого ввода)
├── unit_id         → FK units | None (связь с единицей измерения)
├── description     → text | None
├── is_active       → bool
└── ext_id          → str | None
```

**Типы номенклатуры:**
- `product` — готовая продукция / объект планирования
- `material` — сырьё / материал
- `semi_finished` — полуфабрикат собственного изготовления
- `service` — услуга / работа

**Примечания:**
- `code` — короткий внутренний код (например «R-200»)
- `article` — полный артикул поставщика, может быть длинным (до 100 символов)
- `unit` — строковое поле для быстрого ввода; `unit_id` — ссылка на справочник единиц измерения

### 2.18 Units (справочник единиц измерения) — НОВОЕ ✅

```
units
├── id              → UUID
├── tenant_id       → FK tenants
├── code            → str (код ОКЕИ: "796", "166")
├── symbol_int      → str (международный символ: "pcs", "kg")
├── symbol_ru       → str (русский символ: "шт", "кг")
├── name_ru         → str (название RU: "Штука")
├── name_en         → str (название EN: "Piece")
├── factor          → float (множитель к базовой единице)
├── is_base         → bool (базовая единица группы)
├── is_active       → bool
```

**Особенности:**
- Bilingual (RU/EN) — задел под английскую версию сайта
- Предзагружено 30 единиц из ОКЕИ (шт, кг, г, т, м, мм, см, км, л, мл, м³, п.м, м², кВт⋅ч, кВт, нед, сут, ч, мин, с, пар, упак, компл, дюж, рул, лист, МВт⋅ч и др.)
- Сидирование через `POST /v1/units/seed`

### 2.19 DataImport — универсальный компонент импорта ✅

Переиспользуемый компонент для импорта данных из буфера обмена в любой справочник.

**Режимы:**
- 📋 Из буфера — Ctrl+V парсинг TSV/CSV/Excel, автосопоставление полей
- ✍️ Ручной ввод — форма с вкладками (проектируется)

**Алгоритм сопоставления полей:**
1. Точное совпадение с каноническим именем → 100%
2. Поиск в словаре синонимов → 95%
3. Подстрока → 70%
4. Расстояние Левенштейна ≤ 2 → 50%

**Настройки (на каждый справочник, localStorage):**
- Порог уверенности (по умолчанию 50%)
- Включение/выключение: синонимы, подстрока, нечёткий поиск

**Словари синонимов:**
- `NOMENCLATURE_SYNONYMS` — name, code, article, ntype, unit, description
- `RESOURCE_SYNONYMS` — name, resource_type, unit, capacity_per_unit, capacity_unit
- `UNIT_SYNONYMS` — code, symbol_int, symbol_ru, name_ru, name_en

---

## 3. Состояния узлов (4 базовых + 1 специальное)

| Состояние | Визуализация | Семантика |
|---|---|---|
| `not_started` | Серый полупрозрачный, тонкий контур | Плановая операция, факт не зафиксирован |
| `in_progress` | Синий полупрозрачный + янтарный пунктирный контур | Выполняется, план не нарушен |
| `completed` | Зелёный + янтарный двойной контур | Завершена, связь с планом сохранена |
| `delayed` | Красный полупрозрачный + красный контур | Отклонение от плана |
| `cancelled` | Красный прозрачный + пунктирный контур | Отменена |

**Янтарный двойной путь:** на выполненных рёбрах графа — визуальный маркер пройденного пути.

---

## 4. Логика автозакрытия (Auto-Close Chain)

### Алгоритм
1. Пользователь отмечает операцию как `completed`
2. Система ищет все предшествующие операции (топологический обход назад)
3. Останавливается на первой операции с ручным фактом (`source != 'auto_closed'`)
4. Промежуточные помечаются `completed` с `source = 'auto_closed'`

### Пересчёт при фиксации факта (Forecast Propagation)
При изменении факта система пересчитывает downstream:

| Сценарий | Поведение |
|---|---|
| 🔴 Завершена раньше плана | Ресурс свободен раньше → downstream сдвигается влево |
| 🟡 Завершена позже плана | Все зависимые операции сдвигаются вправо. Если на критпути → сдвигается весь проект |
| ⚪ Идёт с опозданием (fact_start позже, fact_end ещё нет) | ES пересчитывается с фактического времени → новый прогноз финиша |
| ❌ Отменена или брак | Операция + successors исключаются. При браке (yield_rate < 1): потребность в переделке вычисляется автоматически |
| 🔁 Каскадный эффект | Если операция на общем ресурсе → сдвигаются все проекты, использующие этот ресурс |

---

## 5. CPM-движок

### Алгоритм
- Forward Pass → ES / EF
- Backward Pass → LS / LF
- Total Float = LF − EF
- Free Float = min(ES_successors) − EF
- Independent Float = max(0, min(ES_successors) − LF_predecessors − duration)
- Критический путь: все узлы с Total Float ≤ 0

### Типы зависимостей
FS, FF, SS, SF — все с поддержкой lag (часы или дни).

### Обнаружение циклов
Топологическая сортировка (алгоритм Кана). При цикле — ошибка с указанием участников.

---

## 6. BOM-развёртка: ProductStructure → CPM Graph

### Алгоритм bom_to_cpm

```
function bom_to_cpm(node, quantity, routings, graph):
    if node.type == "material":
        op = create_operation(
            name="Закупка: " + node.name,
            operation_type="procurement",
            duration_hours=node.procurement_lead_time * 24,
            output_product=node.ext_id,
            output_qty=node.quantity_per_parent * quantity
        )
        graph.add(op)
        return [op]

    if node.type == "phantom":
        // Фантомный узел: пропускаем, материалы всплывают наверх
        ops = []
        for child in node.children:
            ops.extend(bom_to_cpm(child, quantity * child.quantity_per_parent, routings, graph))
        return ops

    if node.type in ("assembly", "semi_finished"):
        routing = routings[node.id]  // выбранный вариант маршрута
        ops = []
        for rop in routing.operations:
            actual_duration = rop.duration_hours / rop.yield_rate
            op = create_operation(
                name=rop.name,
                operation_type="production",
                duration_hours=actual_duration,
                output_product=rop.output_product,
                output_qty=rop.output_qty * quantity,
                yield_rate=rop.yield_rate
            )
            ops.append(op)
            graph.add(op)
        // Связи внутри маршрута (линейная цепочка)
        for i in range(1, len(ops)):
            graph.add_dependency(ops[i-1], ops[i], "FS")

        // Связи с дочерними узлами
        for child in node.children:
            child_ops = bom_to_cpm(child, quantity * child.quantity_per_parent, routings, graph)
            if child_ops:
                if child.type == "material":
                    // Закупка → первая операция маршрута
                    graph.add_dependency(child_ops[-1], ops[0], "FS")
                else:
                    // Последняя операция дочернего → первая операция родителя
                    graph.add_dependency(child_ops[-1], ops[0], "FS")

        return ops
```

### Учёт yield_rate
- `duration_actual = duration_planned / yield_rate`
- Если `yield_rate < 0.85` → автоматически вставляется операция-дубликат «Переделка брака» с длительностью `duration_planned * (1 - yield_rate)` и FS-связью после основной операции

### Циклические маршруты
BOM — всегда дерево. Маршрут может быть циклическим (деталь после термообработки возвращается на мехобработку). Решение: развернуть цикл в последовательность — «Мехобработка-1 → Термообработка → Мехобработка-2» (разные операции с разными настройками).

### Фантомные узлы
Узлы типа `phantom` не порождают операций — их материалы и полуфабрикаты напрямую связываются с родительским маршрутом.

---

## 7. Multi-Project Merge (CCM)

### Алгоритм
1. Загружаются все операции и зависимости по выбранным проектам
2. Добавляются межпроектные зависимости из `InterProjectDependency`
3. Объединённый граф подаётся на вход CPM-движку

### Объединение одинаковых позиций (Common Items Detection)
При развёртке нескольких заказов система:
1. Ищет BOM-узлы с одинаковым `ext_id` в разных проектах
2. Если тип `material` — предлагает объединить в одну сводную закупку (консолидированное снабжение)
3. Если тип `semi_finished` — предлагает batch scheduling (одна партия изготовления на все заказы)
4. Пользователь подтверждает или отклоняет объединение

### Ресурсное выравнивание
Serial SGS с приоритетами: LS → TF → −duration. Календари ресурсов учитываются через `find_earliest_working_start()`.

---

## 8. Batch Scheduling

### Концепция
Если три заказа требуют изготовления «Вала Ø40», система может:
1. Обнаружить одинаковые операции (по `batch_group_key` или `output_product`)
2. Сгруппировать в одну партию
3. Рассчитать экономию: вместо трёх переналадок — одна
4. Скорректировать CPM-граф: операции объединяются, successors получают обновлённые ES

### Алгоритм
```
function detect_batches(operations):
    groups = group_by(operations, key=batch_group_key or output_product)
    for each group:
        if len(group) > 1:
            total_qty = sum(op.output_qty)
            setup_time = group[0].setup_hours
            runtime = group[0].runtime_per_unit * total_qty
            suggest_merge(group, setup_time + runtime)
```

### Пользовательский опыт
- Система **предлагает** объединение — не применяет автоматически
- Показывает экономию: «3 переналадки → 1 переналадка, экономия 4 часа»
- Кнопки: «Объединить» / «Оставить раздельно»

---

## 9. Формат импорта: семивкладочный Excel

Единый шаблон на все режимы. Заполняется что нужно — пустое игнорируется.

**Порядок вкладок:** Настройки → Заказы → BOM → Ресурсы → Маршруты → Этапы → Подразделения

**Обозначения:** `*` = обязательно всегда, `†` = обязательно если `uses_phases=true`, без знака = опционально

### Вкладка 1: Настройки проекта

Одна строка — глобальные параметры.

| Параметр | Значение | Примечание |
|---|---|---|
| Название проекта * | | |
| Режим * | production | `производство` или `строительство` |
| Использовать этапы * | false | `да` / `нет` |
| Методы расчёта | cpm | через запятую: `cpm`, `pert`, `ccpm` |
| Страна | RU | для производственного календаря |

**Логика «Методы расчёта»:**
- Не заполнено → в интерфейсе проекта пользователь сам выбирает метод (CPM / CCPM / PERT)
- Заполнено, например `cpm,pert` → система автоматом проставляет оба как предустановку. Пользователь может изменить в любой момент. Это предустановка, не блокировка.

### Вкладка 2: Заказы (Orders)

Плоская таблица — каждая строка = один заказ.

| Заказ ID * | Продукт * | Спецификация | Кол-во * | Старт | Срок | Приоритет | Клиент |
|---|---|---|---|---|---|---|---|
| P1 | Редуктор Р-200 | SPEC-001 | 100 | 01.08.26 | 25.08.26 | high | СибСтрой |

### Вкладка 3: BOM (состав изделия)

Плоская parent-child таблица. Любая глубина вложенности. Можно не заполнять — тогда без BOM (простой список задач).

| Спецификация * | Узел ID * | Родитель | Тип * | Номенклатура * | Ед. | Норма на 1 * | Срок поставки, дн |
|---|---|---|---|---|---|---|---|
| SPEC-001 | 1 | — | сборка | Редуктор Р-200 | шт | 1 | — |
| SPEC-001 | 1.1 | 1 | сборка | Корпус в сборе | шт | 1 | — |
| SPEC-001 | 1.1.1 | 1.1 | материал | Чугун СЧ20 | кг | 45 | 10 |

**Типы:** `сборка`, `полуфабрикат`, `материал`, `фантом` (пропускается при развёртке)

### Вкладка 4: Ресурсы

Справочник. Если не заполнен — ресурсы создадутся автоматически из колонки «Ресурс» в Маршрутах.

| ID ресурса | Название | Тип | Подразделение | Доступно | Ед. |
|---|---|---|---|---|---|
| R-01 | Токарный участок | equipment | Цех №3 | 5 | pcs |
| R-02 | Слесарь | labor | Цех №5 | 8 | pcs |

**Типы ресурсов:** `оборудование`, `персонал`, `бригада`, `инструмент`, `транспорт`

### Вкладка 5: Маршруты

Каждая строка = одна операция. Связь с BOM через «Узел ID».

| Узел ID | № оп. * | Операция * | Ресурс | Этап † | Подразделение | Длит.,ч * | Предш. оп. * | Доп. материал | Расход | Вых. год. |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 1 | Сборка корпуса | Слесарь | 1 | Цех №5 | 6 | — | — | — | 0.98 |
| 1 | 1 | Сборка редуктора | Слесарь | 1 | Цех №2 | 8 | — | — | — | 1.0 |
| 1 | 2 | Контроль | Контролёр | — | ОТК | 2 | 1 | — | — | 1.0 |

**Авто-последовательность:** если «Предш. оп.» не заполнено и операция не первая, система выстраивает цепочку по порядку № оп. (1 → 2 → 3).

### Вкладка 6: Этапы

† Только если `uses_phases = true` в Настройках. Иначе игнорируется.

| Этап † | Название † | Зависит от | Lag, дн |
|---|---|---|---|
| 1 | Земляные работы | — | — |
| 2 | Фундамент | 1 | 0 |
| 3 | Каркас и стены | 2 | 2 |

### Вкладка 7: Подразделения

Всегда опционально. Если заполнено — CPM включает resource scoping и inter-department lag.

| Название | Тип | Родитель | Мощность в сутки | Адрес |
|---|---|---|---|---|
| Цех №3 | workshop | — | 120 чел-ч | Корпус Б |
| ОТК | section | — | 16 чел-ч | Корпус Б |

**Типы:** `цех`, `стройплощадка`, `склад`, `бригада`, `участок`, `офис`

### Правила импорта

1. **Минимальный набор** (6 полей): Название проекта, Режим, Использовать этапы, Заказ ID, Продукт, Кол-во, Операция, Длительность, Предш. оп. — всё остальное опционально
2. **Три уровня сложности:**
   - 🟢 Простой список задач — только Заказы + Маршруты (без BOM, без ресурсов)
   - 🟡 Производство — Заказы + BOM + Ресурсы + Маршруты (без этапов)
   - 🔴 Строительство — Заказы + Ресурсы + Маршруты + Этапы + Подразделения
3. **Частичная загрузка:** можно импортировать только часть вкладок
4. **Автосоздание ресурсов:** если колонка «Ресурс» заполнена в Маршрутах, а вкладка «Ресурсы» пуста — ресурсы создаются автоматически из названий в Маршрутах
5. **Сохранение справочников:** импортированные BOM, маршруты, ресурсы и подразделения сохраняются как справочник для будущих заказов
6. **Валидация:** если `uses_phases=true`, а вкладка «Этапы» пуста или операции без привязки к этапу → ошибка. Остальные несоответствия — предупреждения
7. **ext_id:** колонка «Внешний ID» (если есть) сохраняется во всех сущностях для обратной интеграции с ERP

### Источники данных

- **1С УНФ:** Заказы → «Заказ на производство»; BOM → «Спецификации номенклатуры»; Маршруты → «НСИ → Технологические операции»
- **Google Sheets:** ручное заполнение или скрипт Export → Sheets
- **Ручной ввод:** UI-мастер на фронтенде

---

## 10. Формат экспорта

### Уровень 1: Человеку (Excel / Google Sheets)
- Таблица операций с ES/EF/LS/LF/TF/FF/статус критичности
- Сводка: длительность, критпуть, дата финиша
- Лист «Загрузка ресурсов» — по дням
- Лист «Снабжение» — потребности с датами

### Уровень 2: ERP-системе (JSON MRP)

```
GET /v1/projects/{id}/export/mrp
```

```json
{
  "export_id": "exp-2026-08-01-001",
  "exported_at": "2026-08-01T10:30:00Z",
  "project_id": "P1",
  "total_duration_hours": 184.5,
  "projected_finish": "2026-08-25T16:00:00+03:00",

  "operations": [{
    "ext_id": "ЗНП-001",
    "operation_number": 1,
    "name": "Литьё корпуса",
    "planned_start": "2026-08-01T08:00:00+03:00",
    "planned_end": "2026-08-03T17:00:00+03:00",
    "duration_hours": 26,
    "resource": "R-01",
    "resource_ext_id": "РЦ-Литьё",
    "is_critical": true,
    "total_float_hours": 0,
    "status": "planned"
  }],

  "material_requirements": [{
    "material_ext_id": "Чугун СЧ20",
    "quantity": 4500,
    "unit": "кг",
    "required_by_date": "2026-08-01",
    "for_operations": ["ЗНП-001"]
  }],

  "resource_load": [{
    "resource_ext_id": "РЦ-Литьё",
    "date": "2026-08-01",
    "load_percent": 100,
    "utilized_hours": 8,
    "available_hours": 8
  }]
}
```

### Уровень 3: Push дельты изменений в ERP

После фиксации факта и пересчёта — ProfyPlan отправляет **только изменившиеся** данные:

```
POST {erp_webhook_url}
```

```json
{
  "event": "plan_updated",
  "project_ext_id": "ЗНП-001",
  "recalculated_at": "2026-08-02T14:00:00Z",
  "trigger": "fact_import",

  "changes": {
    "new_finish": "2026-08-28T16:00:00+03:00",
    "delay_days": 3,

    "changed_operations": [{
      "ext_id": "ОП-0045",
      "field": "planned_end",
      "old_value": "2026-08-15T17:00:00",
      "new_value": "2026-08-17T12:00:00",
      "reason": "Предшествующая операция завершена с опозданием на 2 дня"
    }],

    "updated_material_dates": [{
      "material_ext_id": "Сталь 40Х",
      "required_by_date_old": "2026-08-05",
      "required_by_date_new": "2026-08-08"
    }],

    "completed_operations": [{
      "ext_id": "ОП-0044",
      "fact_start": "2026-08-01T09:30:00",
      "fact_end": "2026-08-02T16:00:00",
      "status": "completed"
    }]
  }
}
```

**Почему push, а не pull:** ERP не должна опрашивать ProfyPlan. ProfyPlan сам отправляет изменения по webhook'у.

---

## 11. Bottleneck Analysis

### Алгоритм
1. После resource-leveling — сортировка ресурсов по загрузке
2. Ресурсы с загрузкой > 80% — узкие места
3. Для каждого узкого места:
   - Список операций, ожидающих этот ресурс
   - Суммарное время ожидания
   - Предложение: «Добавить смену», «Перенести на другой ресурс», «Аутсорсинг»
4. Визуализация: ресурсная гистограмма с красной зоной перегрузки

---

## 12. API-эндпоинты

### 12.1 CPM (реализовано)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/projects/{id}/calculate/cpm` | Расчёт критического пути |

### 12.2 CCM (реализовано)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/ccm/merge` | Multi-project merge |
| POST | `/v1/ccm/projects/{id}/resource-leveling` | Выравнивание ресурсов |
| POST | `/v1/ccm/projects/{id}/recalculate-forecast` | Пересчёт прогноза |
| POST | `/v1/ccm/projects/{id}/baseline` | Создание Baseline |
| GET  | `/v1/ccm/projects/{id}/baselines` | Список Baseline'ов |
| POST | `/v1/ccm/projects/{id}/facts` | Импорт факта |

### 12.3 Actual Execution (реализовано)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/operations/{id}/actual` | Факт по операции |
| PUT  | `/v1/operations/{id}/actual` | Сохранить факт |
| POST | `/v1/operations/{id}/auto-close` | Автозакрытие |
| POST | `/v1/operations/{id}/unclose` | Отмена автозакрытия |

### 12.4 ProductStructure + Routing (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/specifications/import` | Импорт Excel (3 вкладки) |
| GET  | `/v1/specifications` | Список спецификаций |
| GET  | `/v1/specifications/{id}/bom` | BOM-дерево |
| POST | `/v1/specifications` | Создать спецификацию |
| PUT  | `/v1/specifications/{id}` | Обновить спецификацию |
| GET  | `/v1/bom/nodes/{id}/routings` | Варианты маршрутов |
| POST | `/v1/bom/nodes/{id}/routings` | Добавить маршрут |
| GET  | `/v1/production-orders` | Список заказов |
| POST | `/v1/production-orders` | Создать заказ (со спецификацией) |
| POST | `/v1/production-orders/{id}/expand` | Развернуть BOM → CPM |

### 12.5 Procurement / Batch (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/ccm/detect-batches` | Найти кандидаты на объединение |
| POST | `/v1/ccm/apply-batch` | Применить объединение |
| POST | `/v1/ccm/detect-common-procurement` | Сводные закупки |

### 12.6 Export (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/projects/{id}/export/mrp` | JSON для ERP |
| GET  | `/v1/projects/{id}/export/excel` | Excel для человека |
| POST | `/v1/webhooks/erp` | Настроить webhook для push |

### 12.7 Bottleneck (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/ccm/projects/{id}/bottlenecks` | Анализ узких мест |

### 12.8 Phases (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/projects/{id}/phases` | Список этапов проекта |
| POST | `/v1/projects/{id}/phases` | Создать этап |
| PUT  | `/v1/projects/{id}/phases/{phase_id}` | Обновить этап |
| DELETE | `/v1/projects/{id}/phases/{phase_id}` | Удалить этап |

### 12.9 Departments (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/departments` | Список подразделений |
| POST | `/v1/departments` | Создать подразделение |
| PUT  | `/v1/departments/{id}` | Обновить подразделение |
| GET  | `/v1/departments/{id}/load` | Загрузка подразделения |
| GET  | `/v1/departments/{id}/resources` | Ресурсы подразделения |

### 12.10 Order Groups + Order Pools (проектируется)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/projects/{id}/groups` | Список групп проекта |
| POST | `/v1/projects/{id}/groups` | Создать группу |
| PUT  | `/v1/projects/{id}/groups/{group_id}` | Обновить группу |
| DELETE | `/v1/projects/{id}/groups/{group_id}` | Удалить группу |
| POST | `/v1/projects/{id}/pools` | Создать пул (CCM-merge заказов) |
| GET  | `/v1/projects/{id}/pools` | Список пулов |
| POST | `/v1/orders/{id}/move` | Переместить заказ: `{"target": "group", "id": "..."}` или `{"target": "pool", "id": "..."}` или `{"target": "root"}` |

### 12.11 Nomenclature (реализовано ✅)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/nomenclature/` | Список (фильтр: project_id, ntype) |
| POST | `/v1/nomenclature/` | Создать позицию |
| GET  | `/v1/nomenclature/{id}` | Детали позиции |
| PUT  | `/v1/nomenclature/{id}` | Обновить позицию |
| DELETE | `/v1/nomenclature/{id}` | Удалить позицию |

### 12.12 Units — единицы измерения (реализовано ✅)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/units/` | Список единиц |
| POST | `/v1/units/` | Создать единицу |
| PUT  | `/v1/units/{id}` | Обновить единицу |
| DELETE | `/v1/units/{id}` | Удалить единицу |
| POST | `/v1/units/seed` | Засеять 30 единиц ОКЕИ |

---

### 12.13 Resource Events — события мощности ресурса (реализовано ✅) — НОВОЕ
- `GET /v1/resource-events/` — список (фильтры: resource_id, project_id, event_type, active_only, date_from, date_to).
- `POST /v1/resource-events/` — создать событие мощности (201).
- `GET|PUT|DELETE /v1/resource-events/{id}` — получить / изменить / удалить.
- Типы: boost, reduced, breakdown, maintenance, modernization, condition_change, other. Период — timestamp (часы и минуты).

### 12.14 Reports — отчёты по событиям мощности (реализовано ✅) — НОВОЕ
- `GET /v1/reports/lost-hours` — отчёт «потерянные часы по причинам»: параметры `project_id`, `date_from`, `date_to`, `include_global`.
- Возвращает: `totals` (потери/выработка/события), `by_reason` (причина, потери, выработка, события, типы событий, ресурсы), `by_resource` (ресурс, потери, выработка, разбивка по причинам), `events` (журнал).
- Часы считаются по рабочим дням календаря и окну рабочего дня из графика ресурса; формат — дни/часы/минуты.
- Разрез `by_department` (11.09.2026): потери/выработка в разрезе подразделений (по подразделению ресурса), с причинами и ресурсами.

### 12.15 Department Quotas — квоты ресурсов по подразделениям (реализовано ✅) — НОВОЕ
- `GET /v1/department-quotas` — список (фильтры `department_id`, `resource_id`, `active_only`); возвращает названия подразделения и ресурса.
- `POST /v1/department-quotas` — создать/обновить квоту (`department_id`, `resource_id`, `quota_share`), 201.
- `PUT|DELETE /v1/department-quotas/{id}` — изменить / удалить.

### 12.16 Resource Overload — межпроектные конфликты общих ресурсов (реализовано ✅) — НОВОЕ
- `GET /v1/ccm/resource-overload` — по каждому глобальному (общему) ресурсу: использование по проектам (часы с учётом доли мощности проекта и квоты подразделения → эффективные дни, период проекта), попарные пересечения периодов с уровнем серьёзности (≥14 дней — high, ≥5 — medium, >0 — low).
- Возвращает: `resources[]` (id, name, project_count, is_shared, total_hours/total_text, assignments[], conflicts[], has_conflict, overlap_days, severity) и `totals` (shared, conflicted, conflicts).
- Интерфейс: секция «Межпроектные конфликты общих ресурсов» в CCM-дашборде (ресурс, проекты, загрузка, пересечение, конфликты).

### 12.17 Overload Suggestion — предложение сдвига при межпроектном конфликте (реализовано ✅) — НОВОЕ
- `POST /v1/ccm/projects/{project_id}/overload-suggestion` — находит общие ресурсы, которые проект делит с другими проектами в пересекающиеся периоды, и предлагает дату старта (когда ресурс освободится) и пересчитанный финиш. Применение — отдельно (`PUT /v1/projects/{id}` со `start_date`).
- В ответе: `conflicts[]` (ресурс, другой проект, период, дни, серьёзность) и `suggestion` (ресурсы, текущий/предлагаемый старт, сдвиг в днях, дата освобождения, новый финиш, текст).
- Интерфейс: в секции конфликтов CCM — кнопки «Предложить сдвиг» и «Применить сдвиг».
- Важно: ресурсы в маршрутах могут храниться и идентификатором, и именем — предложение сравнивает их по имени ресурса.
- **Авто-план по всем конфликтам (11.09.2026, вечер):** ответ содержит `plan[]` (по каждому ресурсу: когда освободится, с какими проектами, величина перекрытия) и `priority` (приоритет моего проекта, приоритеты конфликтующих, рекомендация `shift_self` / `shift_other` и целевой проект).
- **Приоритет проекта:** поле `priority` (`low` / `normal` / `high`) — доступно в API создания и обновления проекта. Если приоритет выше, чем у конфликтующих проектов, система рекомендует сдвинуть чужой проект; иначе — свой.
- Интерфейс: в CCM показываются план по ресурсам и кнопки «Применить сдвиг мне» / «Ваш проект важнее — сдвинуть «…»».

### 12.18 Resource Loading — загрузка по неделям (реализовано ✅) — НОВОЕ
- `GET /v1/reports/resource-loading?project_id=&weeks=` — спрос по неделям (часы операций из календарного расчёта проекта), доступное время недели (5 рабочих дней × часы дня), процент загрузки и пик.
- Интерфейс: блок «Загрузка по неделям» на экране Ганта проекта (спрос, процент, цветная полоса).

### 12.19 Department Loading — загрузка подразделений (реализовано ✅) — НОВОЕ
- `GET /v1/reports/department-loading?project_id=` — по каждому подразделению: спрос (часы операций, отнесённые к подразделению ведущего ресурса), доступное время (рабочие дни периода × часы/день подразделения × число задействованных ресурсов), процент загрузки, число операций и ресурсов.
- Часы/день берутся из графика подразделения (иначе 8 ч). Формат — дни/часы/минуты.

### 12.20 Multi-leveling — межпроектное выравнивание (реализовано ✅) — НОВОЕ
- `POST /v1/ccm/multi-leveling` (тело: список id проектов) — предложение сдвигов по нескольким проектам сразу: проекты упорядочиваются по приоритету (высокий → низкий), затем по дате старта; конфликтующие по общим ресурсам проекты получают рекомендуемый старт (когда ресурсы освободятся).
- Возвращает `plan[]` (текущий и предлагаемый старт, сдвиг в днях, признак перемещения), `conflicts[]` и `summary`. Применение — отдельным вызовом обновления проекта.

## 13. Фронтенд-компоненты

### 13.1 NetworkGraphV2 (реализовано)
Canvas-рендеринг, состояния узлов, янтарный путь, drag/zoom/hover, Baseline-наложение.

### 13.2 OperationPanel (реализовано)
Боковая панель: статус, даты, количество, причина отклонения, комментарий, аудит.

### 13.3 AutoCloseModal (реализовано)
Диалог автозакрытия с выбором «Всех» / «Только эту».

### 13.4 CCMDashboardV2 (реализовано)
Multi-select проектов, merge, resource-leveling, Baseline.

### 13.5 GanttChart (проектируется) — НОВОЕ
- Интерактивная диаграмма Ганта для любого CPM/CCM-расчёта
- Доступна на всех тарифах (визуализация, не метод расчёта)
- Drag-and-drop редактирование дат
- Цветовое кодирование: серый (план), зелёный (факт), красный (задержка)
- Зависимости стрелками (FS/FF/SS/SF)
- Наложение Baseline полупрозрачным контуром

### 13.6 CPM React Flow (проектируется) — НОВОЕ
- Миграция с iframe на React Flow для CPM-графа
- Живые данные из API
- Единый стиль с CCM-дашбордом

### 13.7 ExcelImportWizard (проектируется) — НОВОЕ
- Drag-and-drop .xlsx файла
- Предпросмотр трёх вкладок
- Валидация с подсветкой ошибок
- Выбор: «Создать новый проект» / «Добавить к существующему»
- Прогресс-бар развёртки BOM → CPM

### 13.8 BatchMergeDialog (проектируется) — НОВОЕ
- Список кандидатов на объединение
- Экономия по каждому
- Кнопки «Объединить выбранные» / «Пропустить»

### 13.9 OrderTimeline (проектируется) — НОВОЕ
- Временная шкала проекта: заказы, пулы, группы — вертикальными полосами
- Каждая полоса = сетевой график заказа или общий граф пула
- Drag-and-drop сдвиг заказа по времени (ручная корректировка старта)
- Визуальные разделители групп
- Сортировка по дате начала
- При сдвиге одиночного заказа — пересчитывается только его CPM. При сдвиге в пуле — пересчитывается весь CCM

### 13.10 Directory UI Components (реализовано ✅) — НОВОЕ

**Страница «Справочники» (view='directories'):**
- Отображает **только сетку плиток** (5 справочников) — без таблицы
- Клик по плитке → открывает полноэкранное модальное окно
- ПКМ на пункте сайдбара → контекстное меню «📋 Открыть список» → модальное окно
- Двойной клик на пункте сайдбара → тоже открывает модальное окно

**Модальное окно справочника:**
- Переключение между справочниками через табы (Номенклатура | Ресурсы | Подразделения | Организации | Календари)
- Кнопка закрытия ✕
- Полноценная таблица DirectoryTable внутри

**DirectoryTable** — переиспользуемая таблица для любого справочника:
- Поиск по названию/коду
- Инлайн-CRUD: добавление строки, редактирование, удаление
- Встроенная кнопка «📋 Импорт» → открывает DataImport
- Настраиваемые колонки через `ColumnDef[]`
- Единый компонент для всех справочников (параметризуется entity, columns, synonyms)

**DirectoryPicker** — dropdown с поиском:
- Выбор записи из справочника
- Поиск по названию
- Отображение кода рядом с названием

**DataImport** — универсальный импорт из буфера:
- Два режима: 📋 Из буфера / ✍️ Ручной ввод
- Автосопоставление заголовков (точное → синоним → подстрока → Левенштейн)
- Цветовая индикация уверенности (зелёный/жёлтый/красный)
- Ручное переназначение столбцов
- ⚙️ Настройки поиска (порог, синонимы, подстрока, нечёткий поиск)
- Настройки в localStorage раздельно для каждого справочника
- Предпросмотр данных перед сохранением (первые 20 строк)
- Предустановленные словари синонимов: NOMENCLATURE_SYNONYMS, RESOURCE_SYNONYMS, UNIT_SYNONYMS

---

### 13.11 CapacityEvents — события мощности ресурса (реализовано ✅) — НОВОЕ
- Блок «События мощности» в карточке ресурса заказа: чипы активных событий, список событий (🟢 форсаж / 🟠 снижение / 🔴 простой), кнопки «＋ Форсаж / ＋ Ограничение / ＋ Простой/поломка», модалка (тип, коэффициент, период в формате ДД.ММ.ГГ ЧЧ:ММ, причина).
- Файл: `components/CapacityEvents.tsx`; встроен в `components/windows/WindowsLayer.tsx` (вкладка «Ресурсы» заказа).

### 13.12 Журнал событий мощности и отчёт по потерям (реализовано ✅) — НОВОЕ
- На экране «📊 Диаграмма Ганта» проекта: блок «События мощности проекта и потери» — итоги (потери/выработка/события), таблица по причинам, журнал событий (ресурс, тип, период ДД.ММ.ГГ (ЧЧ:ММ), коэффициент, причина, потери/выработка).
- В сводке CCM (`CCMDashboardV2`) — колонки «План», «С событиями», «Потери», «Выработка».

### 13.13 Единое дерево заказов: секции «Группы / Пулы / Свободные» (реализовано 11.09.2026) — НОВОЕ
- **Принцип:** «Заказы» — единственный дом дерева заказов проекта. Группы, пулы и свободные заказы — не отдельные списки, а **секции (корневые ветки)** этого дерева. Области «Группы» и «Пулы» остаются для своей работы (маркеры / CCM), а не для дублирования списка.
- **Секции:** 📁 «Группа — <название>», 📦 «Пул — <название>», 🗂 «Свободные (не в группе)». Заголовок секции: сворачивание кликом (▼/▶) и счётчик заказов. Свободные всегда видны последними; у них подсказка «перетащите заказ в группу или пул».
- **Иерархия внутри секции** сохраняется: заказы раскрываются по `parent_order_id` (цепочка), сворачивание поддеревьев работает как раньше.
- **Режим отображения:** секционный (по умолчанию, флаг `orderTreeSections`) и прежний плоский (сохранён как переключатель — старое поведение не удалялось).
- **Режим «Показать все заказы»:** добавляет фильтр по типу (Все типы / Свободные / конкретная группа / конкретный пул) и колонку «ГРУППА / ПУЛ» в таблице.
- **Заказы без найденной группы/пула** (например, объединение удалено) попадают в служебную секцию «Без группы (потерянные)» — данные не теряются.
- **Правило для будущих правок:** при выносе блока рендера строки в локальную функцию (`renderTreeRow`) объявление функции должно находиться в JS-области компонента (до `return`), а вызовы — в JSX; иначе TypeScript падает с TS1382 (проверено на практике).

### 13.14 Сводка расчёта во вкладке «План» панели заказа (реализовано 11.09.2026) — НОВОЕ
- Вкладка «План» правой панели заказа — не заглушка, а **сводка расчёта проекта**: кнопка «▶ Рассчитать план» запускает календарный CPM (`POST /projects/{id}/calculate/schedule`) и показывает результат.
- Состав сводки: KPI (финиш проекта, длительность в днях, число критических операций, число предупреждений); список критического пути (операция, длительность «дни/часы/минуты», время окончания); предупреждения (`blocked` — простой ресурса, `muri` — перегрузка/длительный форсаж).
- Действие «📊 Открыть диаграмму» переводит в полноэкранный Гант того же проекта (существующий экран).
- Состояния: до расчёта — поясняющая подсказка; во время расчёта — кнопка «Расчёт…» (disabled); ошибка (например, меньше двух операций) — сообщение в статусной строке.

### 13.15 Системные подсказки при наведении (UI-стандарт, согласовано 12.09.2026) — НОВОЕ
**Принцип.** Подсказка появляется при наведении (и при фокусе с клавиатуры) на **неочевидный** объект: настройку, реквизит (поле), индикатор/KPI, кнопку-иконку, заголовок колонки, статус, предупреждение, объект диаграммы (операция, маркер, магнит, «призрак», полоса мощности).
**Правило неочевидности.** Подсказка нужна там, где пользователь может не понять смысл, единицу измерения, влияние на результат или что делать дальше. Очевидные подписи (кнопка «Сохранить», «Отмена») подсказок не имеют — иначе подсказки превращаются в шум.

**Единый механизм:**
- Компонент `Hint` — обёртка любого элемента; можно передавать текст напрямую или идентификатор из словаря.
- Словарь текстов `lib/hints.ts` — все подсказки в одном месте: единая формулировка, правка без изменения кода, основа для второго языка.
- Состав подсказки: **название → пояснение (1–2 строки) → пример/диапазон значений (если есть) → «что делать»** (для предупреждений и индикаторов).

**Поведение:**
- Задержка появления ~400 мс; исчезновение при уходе курсора; подсказка не перекрывает сам объект.
- У краёв экрана — автоматический разворот, чтобы не уходила за границу.
- Внутри прокручиваемых областей — вывод поверх интерфейса (портал), чтобы текст не обрезался (в системе много областей с прокруткой).
- Во время перетаскивания (операции, маркера, заказа) подсказки **не показываются** — чтобы не мешать.

**Доступность:** подсказка доступна с клавиатуры (по фокусу), связана с элементом для скринридеров; на сенсорных устройствах — по длительному нажатию либо по значку «?».

**Настройки подсказок (уровень рабочего стола, наследуются как остальные):** «Показывать подсказки» (да/нет), «Задержка появления» (~400 мс).

**Порядок внедрения (аддитивный, без изменения логики и данных):**
1. Механизм + словарь + стили; демонстрация на секции настроек.
2. Реквизиты форм (справочники, окна ресурсов, квоты, графики работы).
3. Индикаторы и KPI (срок, критический путь, загрузка, потери, эффективная мощность, «свобода плана») — с пояснением «что это и что делать».
4. Результаты расчёта и предупреждения (что означает ⛔ простой / ⚠ перегрузка и какие действия доступны).
5. Таблицы (заголовки колонок), кнопки-иконки, статусы.
6. Объекты диаграмм (операции, маркеры, магнит, «призрак», полоса мощности).

**Совместимость.** Существующие 140 нативных подсказок (`title=`) продолжают работать; при внедрении они постепенно заменяются единым механизмом (нативные показываются с большой задержкой, не оформлены и не переносят текст по строкам — единый механизм этих недостатков лишён).

### 13.16 Локальный стенд и единственный источник адреса API (шаг 0.1, 12.09.2026) — НОВОЕ
**Проблема.** Адрес боевого API был зашит в коде в 32 местах (page.tsx, cpm/page.tsx, прокси-роутере), из-за чего локальный интерфейс обращался к **продовой базе**, а «локальные проверки» фактически шли по боевым данным.
**Решение:**
- Введён единый источник адреса: `API_ORIGIN` вычисляется по хосту — на `localhost` и `127.0.0.1` используется `http://localhost:8000`, в остальных случаях боевой адрес (из `NEXT_PUBLIC_API_URL`). Все зашитые адреса заменены на эту константу.
- Прокси-роут `app/api/[...path]/route.ts` выбирает апстрим по режиму: разработка → локальный API, продакшен → боевой.
- API срезает префикс `/api` у входящего пути (на проде его снимает nginx; при прямом обращении к локальному API префикс остаётся) — совместимость без изменения бизнес-логики.
- Демо-вход настраивается окружением: `NEXT_PUBLIC_DEMO_EMAIL` / `NEXT_PUBLIC_DEMO_PASSWORD` (значения по умолчанию — боевые, на проде не меняются).
**Порядок локальной проверки:**
1. Локальный API: `uvicorn` на 8000 с `DATABASE_URL=...profyplan_local`, запуск скриптом `.openclaw/tmp/run_local_api.py`.
2. Локальный интерфейс: `npm run dev -- -p <свободный порт>` в `apps/web` (`.env.local`: адрес API + локальные креды демо-входа).
3. Вход локальными учётными данными; проверка изоляции — в сетевой панели браузера хост запросов должен быть `localhost:8000`.
4. Локальная база наполнена тестовыми данными (проекты, операции, ресурс с графиком, подразделение, заказы).

### 13.17 Завершение изоляции локального стенда (шаг 0.1, часть 2, 12.09.2026) — НОВОЕ
- **Переведены все оставшиеся места:** 9 файлов (окна `WindowsLayer`, справочники, редакторы пулов и групп, диалог удаления, поля-ссылки, менеджеры ресурсов/графиков/календарей) — зашитых боевых адресов в коде больше нет, остались только объявления констант.
- **Демо-вход параметризован во всех трёх местах** (рабочий стол, страница CPM, дашборд CCM): значения по умолчанию — боевые, локально подменяются окружением.
- **Правило:** любой новый вызов API в интерфейсе обязан использовать общий помощник адреса (`API_ORIGIN` / `API_V1` из `lib/api.ts`), а не литерал. Это гарантирует, что локальная проверка всегда идёт по локальной базе.
- **Проверено:** локально — вход, проекты, заказы, группы, пулы, состав, графики, CCM (использование ресурсов) идут на `localhost:8000` и работают с локальными данными; на проде — всё идёт на боевой адрес, вход и страницы работают.
- **Важно про базы:** локальный API использует отдельную базу `profyplan_local` на локальном PostgreSQL (127.0.0.1); продовая база — отдельный экземпляр в контейнере на сервере. Данные не пересекаются.

### 13.19 Виджеты проекта на дашборде (шаг 1.2, 12.09.2026) — НОВОЕ
На дашборде проекта (над списком групп) — блок «📊 Сводка расчёта проекта» (компонент `ProjectWidgets`).
**Состав:**
- **KPI-строка:** финиш проекта и длительность (календарный расчёт); число операций критического пути и предупреждений; конфликты общих ресурсов с другими проектами (из сводки перегрузок); риск PERT (σ и интервал 68 %).
- **Загрузка по неделям:** полосы загрузки по неделям с процентами и пиком; цвет — зелёный до 80 %, жёлтый до 100 %, красный выше 100 %.
- **События мощности и потери:** суммарные потери и выработка, число событий, разбивка по причинам (первые четыре), первое PERT-предупреждение (например, отсутствие PERT-оценок).
- Кнопка **«▶ Пересчитать»** обновляет все виджеты (расчёт проекта, загрузка, потери, PERT, конфликты).
**Источники (все существуют):** календарный расчёт, отчёт загрузки по неделям, отчёт потерь, PERT-расчёт, сводка перегрузок общих ресурсов.
**Подсказки:** у каждого KPI — пояснение смысла и влияния (до единого механизма подсказок — через нативный `title`).

### 13.20 Портфельные виджеты рабочего стола (шаг 1.3, 12.09.2026) — НОВОЕ
На главном экране (рабочий стол, над блоком «Последние проекты») — блок «🗂 Портфель проектов» (компонент `PortfolioWidgets`).
**Состав:**
- **KPI-строка:** число проектов в портфеле; конфликты общих ресурсов (число ресурсов с пересечениями и общее число конфликтов); потери времени по событиям мощности с выработкой; число событий мощности.
- **Мини-Гант портфеля:** по первым проектам (ограничение — 6, чтобы не нагружать расчёт) строится полоса от старта до финиша проекта; период портфеля указывается в заголовке; полоса оранжевая, если по проекту есть конфликт общих ресурсов; рядом — длительность и число предупреждений расчёта; клик по названию открывает проект.
- **Конфликтные общие ресурсы:** ресурс, перекрытие в днях, цвет по серьёзности, список проектов-участников.
- **Потери по причинам:** первые причины с величиной потерь.
- Кнопка **«▶ Обновить»** пересчитывает весь блок.
**Источники:** сводка перегрузок общих ресурсов, отчёт потерь, календарный расчёт по проектам (ограниченно).
**Особенность:** расчёт по проектам выполняется пачкой при обновлении и ограничен числом проектов — на больших портфелях блок остаётся быстрым.

### 13.21 Дашборд ресурса (шаг 1.4, 12.09.2026) — НОВОЕ
В справочнике ресурсов у каждой строки есть кнопка **«📊»** (в колонке действий, перед «✎»); открывает панель «Ресурс: <название>» (компонент `ResourceDashboard`).
**Состав панели:**
- **KPI:** плановые часы по всем проектам, где задействован ресурс (+ число проектов); часы с учётом эффективной мощности (доля ресурса в проекте × квота подразделения, коэффициент); потери по событиям мощности; дополнительная выработка от форсажа; число событий.
- **Проекты, использующие ресурс:** проект, часы, период; в подсказке — доля мощности и квота.
- **Конфликты по общим ресурсам:** пара проектов, величина перекрытия, период, цвет по серьёзности.
- **Потери по причинам:** причины и величины.
- Кнопка **«▶ Обновить»**.
**Источники:** сводка использования ресурсов, сводка перегрузок общих ресурсов, отчёт потерь (разрез по ресурсам).
**Реализация кнопки:** в общем компоненте таблицы справочника добавлен необязательный обработчик действия строки (`onRowDashboard`) — кнопка появляется только там, где обработчик передан (сейчас — для ресурсов), поэтому остальные справочники не меняются.

### 13.22 Раздел «Отчёты»: загрузка подразделений и межпроектное выравнивание (шаг 1.5, 12.09.2026) — НОВОЕ
Раздел «Отчёты» (был заглушкой) содержит два рабочих отчёта (компонент `ReportsPanel`).
**1. Загрузка подразделений.** Выбор проекта → «▶ Рассчитать» → таблица по подразделениям: спрос, доступное время, **процент загрузки** (цвет: до 80 % зелёный, до 100 % жёлтый, выше — красный), число операций, число задействованных ресурсов, рабочих дней в периоде. Итог: суммарный спрос и пиковая нагрузка (подсвечивается). Доступное время учитывает график подразделения и число задействованных ресурсов.
**2. Межпроектное выравнивание.** Отметить проекты → «▶ Предложить сдвиги» → таблица: проект, приоритет, текущий старт, **предлагаемый старт**, величина сдвига и пометка «сдвигается»; ниже — список конфликтов (пара проектов, дни, ресурс). Порядок проектов определяется приоритетом и датой старта; применение сдвигов — отдельный шаг (фаза 3).
**Правило:** применение сдвигов из выравнивания не выполняется здесь (осознанно) — это следующий шаг плана (3.2).

### 13.23 Фаза 1 (витрины) завершена (12.09.2026)
Итог по фазе: каркас настроек с наследованием (1.1), виджеты проекта (1.2), портфель на рабочем столе (1.3), дашборд ресурса (1.4), интерфейс отчётов (1.5). Все витрины работают на существующих API, новых расчётных сущностей не потребовалось.

## 14. Принципы аудита

1. Каждое изменение факта логируется: `updated_at` + `edit_count`
2. Источник изменения (`source`) всегда известен
3. Baseline неизменяем — создаётся новый с инкрементом версии
4. Автозакрытие не перезаписывает ручные данные
5. `ext_id` сохраняется при импорте и возвращается при экспорте — сквозная прослеживаемость ERP ↔ ProfyPlan

---

## 15. Поэтапный план реализации

### Level 0 — Ядро (✅ завершено)
- CPM-движок (Forward/Backward Pass)
- CRUD проектов, операций, зависимостей
- Auth JWT

### Level 1 — CCM Foundation (✅ завершено)
- Multi-project merge
- Baseline-версионирование
- Auto-close chain
- Resource CRUD + Resource-leveling (SGS)
- Resource calendars
- BOM-импорт + дерево + развёртка (упрощённая)

### Level 2 — Excel Import + Directory UI + CPM Frontend (✅ частично)
1. ✅ **Справочники (Directory UI)** — Nomenclature + Units + DirectoryTable + DirectoryPicker + DataImport
2. ✅ **Группы и Пулы** — модель OrderGroup + OrderPool, API, drag-and-drop на временной шкале
3. ✅ **Рабочий стол** — тёмный дашборд, сайдбар с 9 разделами, мастер проекта, контекстное меню, заказы в дереве
4. 🔲 **Excel-импорт (7-вкладочный)** — замыкает контур «данные → расчёт → визуализация»
5. 🔲 **CPM React Flow** — миграция с iframe на живой граф
6. 🔲 **Ганта** — базовая диаграмма (read-only)
7. 🔲 **Ручной ввод с вкладками** — Заказы | Номенклатура | Ресурсы | Операции
8. 🔲 **Сопоставление с номенклатурой при вставке из буфера** (fuzzy match по имени)
9. 🔲 **Drag-and-drop заказов**
10. 🔲 **Этапы (Phases)** — модель, API, учёт в CPM (под флагом `uses_phases`)
11. 🔲 **Подразделения (Departments)** — модель, API, учёт в resource-leveling
12. 🔲 **E2E-тест на VPS** — прогнать реальные данные через импорт → CPM → CCM → resource-leveling

### Level 3 — Heavy CCM (🔲)
1. **ProductStructure + Routing модели** — полная реализация
2. **BOM→CPM развёртка** — с yield_rate, фантомами, вариантными маршрутами
3. **ext_id на всех сущностях** — мост к ERP
4. **JSON-экспорт MRP** — эндпоинт для ERP
5. **Снабжение** — procurement-операции, календари поставщиков, сводные закупки

### Level 4 — APS Engine (🔲)
1. **Batch scheduling** — группировка одинаковых деталей
2. **Bottleneck-анализ** — выявление узких мест
3. **Push дельты в ERP** — webhook при пересчёте
4. **Milestones** — контрольные точки на графике

### Level 5 — PERT + Риски (🔲)
1. PERT-оценки (O, ML, P)
2. Монте-Карло симуляция
3. Доверительные интервалы, S-кривые

### Level 6 — Excel-экспорт + Интеграции (🔲)
1. Экспорт Ганта / ресурсной ведомости / CPM-таблицы в Excel
2. Google Sheets автосинхронизация
3. CI/CD пайплайн


## 16. Многопередельное производство по заказам (по аналогии с 1С)

### 16.1 Модель: «один заказ = один передел = одно изделие»
- Заказ на производство — документ на одно изделие (готовое или полуфабрикат).
- Каждый заказ (на любом уровне вложенности) содержит:
  - **Состав** — сколько угодно материалов и полуфабрикатов; каждый полуфабрикат — ссылка на свой вложенный заказ.
  - **Маршрут** — сколько угодно операций; у операции — этап (номер + название), подразделение, ресурс, длительность.
- Рекурсия: вложенный заказ сам имеет состав + маршрут; вниз до уровня «только материалы (закупка)».

### 16.2 Связи (двусторонние, уже в модели)
- `ProductStructure.order_id` — полуфабрикат → его заказ-производитель.
- `ProductionOrder.parent_order_id` — заказ → родительский заказ.
- Правило «свой слой»: операции/материалы полуфабриката принадлежат его вложенному заказу, а не родителю (родитель показывает полуфабрикат как ссылку).

### 16.3 Маршрут полуфабриката — вариант А (решено)
Маршрут остаётся на узле BOM (`routing_id`). При создании вложенного заказа узел «переезжает» (order_id → новый заказ), маршрут автоматически оказывается в этом заказе. Дублирования нет.

### 16.4 Создание вложенных заказов — через аномалии (уже реализовано)
- `POST /bom/projects/{id}/validate-structure` → no_routing / no_order / self_order.
- `POST /bom/projects/{id}/nodes/{id}/create-order` → один узел → вложенный заказ (спецификация = полуфабрикат, количество = потребность родителя, единица = как у узла, parent_order_id = владелец, order_id = новый).
- `POST /bom/projects/{id}/create-missing-orders` → массово (строгий/гибкий режим).

### 16.5 Фаза 1 — интерактивный состав (в работе)
- Вкладка «Состав» окна заказа: у полуфабриката ссылка → окно/модалка списка заказов (выбор существующего или «＋ создать заказ»).
- Окно — если включена настройка «окна для списков», иначе модальное окно. Переиспользуется существующее окно списка заказов.
- Фаза 2 (навигация по переделам) и Фаза 3 (разместить в заказы) в окне заказа НЕ нужны — уже реализованы в списке заказов / аномалиях.

### 16.6 Даты (решено)
- `start_date` и `due_date` — обязательные поля, ручной ввод/изменение.
- Кнопка «рассчитать автоматически» заполняет пустые `due_date`: старт + длительность операций маршрута.
- Календарь (черновик): 5-дневная неделя, 8 ч = 1 рабочий день, без праздников. Тонкий календарь — позже.


## 17. Ресурсы, графики работы и производственные календари (решено 2026-08-21)

### 17.1 Модель данных: справочники общие + регистр
- Ресурсы — общий справочник (физические сущности), а НЕ «ресурс под проект».
- Регистр «Ресурсы проекта» (`ProjectResource`): project_id ↔ resource_id (многие-ко-многим) + schedule_id (nullable — переопределение графика).
- Одинаковое имя в справочнике = разные физические ресурсы (две записи, разные инв. номера); один физический ресурс в N проектах = одна запись + N строк регистра.
- Обоснование: нет дублирования, сквозная загрузка/выравнивание ресурсов через проекты, перенос = одна строка регистра (модель 1С: справочник + регистр сведений).

### 17.2 Графики работы (WorkSchedule) — общий справочник шаблонов
- Пользователь создаёт шаблоны сам (полный CRUD).
- Два режима заполнения: «по дням недели» (day_of_week 0–6) и «по циклу» (cycle_length + день цикла).
- Сегменты работы: start_hour / end_hour (end < start = ночная смена через полночь); несколько сегментов в дне = смены; перерыв = разрыв между сегментами или отдельный сегмент «обед».
- production_calendar_id (nullable) — сверка с праздниками.
- Привязка двухуровневая: `Resource.schedule_id` (график по умолчанию) + `ProjectResource.schedule_id` (переопределение под проект). Начинаем с Resource.schedule_id.
- Фронт — единый модуль `WorkScheduleManager` (режимы list / edit + selectMode для выбора). Справочник-список: hover-подсветка строки, «✎» (редактировать) и «🗑» (удалить с подтверждением confirm), двойной клик по строке = редактировать. Создание/редактирование — в отдельном окне `kind='wsched-edit'` (window) либо модальном слое (modal/panel) по глобальной настройке listWinMode; сохранение закрывает окно и обновляет список.
- Режим выбора (для поля «График» у ресурса и в фильтрах): клик по графику возвращает его в поле и закрывает окно; «Удалить» скрыт; «＋ Новый график» доступен.
- Поле «График (по умолчанию)» у ресурса — `ReferenceField(entity='work-schedules')`: ▾ выбор, ⊞ — открыть окно выбора графика, ✎ — открыть окно редактирования выбранного графика (openWschedEdit), ✕ — очистить. Значение в поле = id графика; отображается name.

### 17.3 Производственные календари (ProductionCalendar) — любые страны
- Справочник: country_code + year + строки дней (date, day_type: work/weekend/holiday/preholiday, hours).
- РФ/РБ/РК предзагружены; любую другую страну создаёт пользователь мастером из Excel (универсальный формат: дата / тип дня / часы).
- Импорт из внешнего источника xmlcalendar.ru (JSON: месяцы + переносы `+` / предпраздничные `*` + статистика).
- Служебные поля: `source` (xmlcalendar/base/excel/manual), `status` (ok/fallback/missing/error), `last_error`, `source_synced_at`, `updated_at`.
- Связь: `Resource.country_code` (nullable — своя страна ресурса, может отличаться от проекта) → иначе `Project.country_code` → применяемый календарь (страна + год даты).

### 17.4 Режим окон/модалок (глобальная настройка listWinMode)
- Справочники («Графики», «Произв. календари») — по общему паттерну openDirectory: окно (kind='dir' / 'prodcals') или модалка DirectoryManager.
- Редактор графика — детальная форма: окно (kind='wsched-edit') или модальный слой. Один компонент WorkScheduleManager (mode='edit'), два контейнера.
- Мастер Excel — всегда модалка (пошаговый диалог).
- Назначение на ресурс / регистр «ресурс-проект» — секция внутри окна ресурса, не отдельная точка входа.

### 17.5 Отложено
- `RoutingOperation.resource_type_id` (сейчас строка) → FK на Resource.id — для сквозной загрузки; отдельный рефакторинг, в текущую задачу не входит.

### 17.6 План миграции
1. Справочник WorkSchedule (+ слоты: день_недели ИЛИ день_цикла, start/end, тип сегмента) — заменяет ResourceCalendar как переиспользуемый шаблон.
2. Справочник ProductionCalendar (+ дни: дата, тип, часы) + Excel-мастер.
3. Resource.schedule_id → WorkSchedule; Resource.project_id остаётся nullable (NULL = общий).
4. Регистр ProjectResource (project_id, resource_id, schedule_id nullable).
5. Миграция существующих ResourceCalendar → WorkSchedule (без потери данных).
6. (отложено) resource_type_id → FK.

### 17.7 Жизненный цикл календарей и статусы загрузки
- Разрешение по дате: каждая дата определяет свой год → календарь (страна, год). Переход года — не «переключение», а резолв по дате; через границу года CPM/Gantt работают корректно при наличии календаря N+1.
- Моменты загрузки: (1) начальная предзагрузка текущего года; (2) заблаговременная загрузка N+1 (systemd-timer, ноябрь); (3) ленивая при отсутствии (автогенерация базы); (4) корректировка/обновление по выходу постановлений о переносах.
- Статусная модель (для любого источника): `source` + `status` + `last_error`.
  - `ok` — загружено из внешнего источника (полный календарь: переносы, предпраздничные).
  - `fallback` — только базовая сетка (внешний источник не сработал) → требует загрузки официальных.
  - `missing` — календаря на период нет (напр. N+1) → требуется загрузка.
  - `error` — попытка загрузки (внешней ИЛИ базовой) не удалась → `last_error`.
- Базовый календарь — не финал: `fallback`/`missing` периодически (или по кнопке) повторно пробуют внешний источник → апгрейд до `ok`.
- Порядок автозагрузки: нет календаря → xmlcalendar → успех=`ok` / неудача=базовый(`fallback`, `last_error`) / база тоже упала=`error`.
- Резолвер `resolve_calendar(country, date)`: год из даты → календарь; нет → автозагрузка/база + статус.


### 17.8 Календарное планирование (даты по календарю + графику) — реализовано
- Endpoint `POST /v1/projects/{pid}/calculate/schedule` (роутер calculations.py).
- Алгоритм:
  1. Длительность операции → часы (нормализация по duration_unit: sec/min/hour/day/shift; day=8ч).
  2. «Часов в сутки» операции = график её ресурса (через OperationResource → Resource.schedule_id), иначе 8ч. Недельный график = среднее по дням с работой минус перерывы; цикл (2/2) = сумма часов цикла / длина цикла.
  3. Длительность (ч) → рабочие дни = часы / часов_в_сутки.
  4. CPM считается в рабочих днях (абстрактная шкала, движок calculate_cpm без изменений).
  5. Индекс рабочего дня (0-based) → реальная дата через производственный календарь страны (выходные/праздники пропускаются; предпраздничные 7ч влияют на длительность в днях через календарь при будущем уточнении, сейчас фолбэк Пн-Пт).
- Точка отсчёта: `body.start_date` ?? `project.start_date` (новая колонка, миграция 0016) ?? сегодня.
- Ответ: anchor, country_code, calendar_found, total_duration_days, project_start_date/project_finish_date, nodes[].{duration_days, hours_per_day, early_start_day, early_finish_day, early_start_date, early_finish_date, total_float_days, is_critical}.
- Сервис `app/services/scheduling.py`: normalize_to_hours, schedule_hours_per_day, CalendarResolver (кэш календарей по годам, is_working, фолбэк Пн-Пт), working_day_index_to_date.
- Проверено smoke-тестом: A 16ч@5/2→2дн; B 24ч@2/2(6ч/д)→4дн (выходные пропущены); C 8ч→1дн; итог 7 раб.дней, финиш через календарь РФ.
- Открытый фронтенд: показать early_start_date/early_finish_date в Gantt (следующий шаг).

### 17.9 Фикс Pydantic v2 (важно для любых новых роутеров)
- `XOut.model_validate(orm_obj)` падает 500 если в схеме `id: str`/`project_id: str`, а в ORM — UUID: Pydantic v2 НЕ приводит UUID→str в строгой валидации.
- Паттерн: собирать ответ вручную (`XOut(id=str(o.id), ...)`), как в get/update operations.py.
- Исправлены: create_operation, create_dependency, list_dependencies (коммит 45003b5).

### 17.10 Глобальный справочник ресурсов + регистр-выделение (решено 2026-08-21, вечер)
- Решение для коммерческого продукта: ресурсы — **глобальный справочник** (Resource.project_id = NULL, принадлежит всем проектам) + регистр ProjectResource как **«регистр выделения»**, а не просто привязка.
- Схема регистра (финал): project_id, resource_id, schedule_id (nullable — переопределение графика под проект), **capacity_share** (numeric default 1.0 — доля мощности), **date_from/date_to** (date nullable — период, NULL = весь проект).
- capacity_share и период ЗАКЛАДЫВАЕМ в схему сейчас (nullable, в логике пока не используем) — чтобы не мигрировать при переходе к выравниванию ресурсов.
- Цепочка резолва графика: `ProjectResource.schedule_id ?? Resource.schedule_id ?? 8ч/день`. (Движок /calculate/schedule сейчас читает только Resource.schedule_id — исправить на register-override.)
- Цепочка резолва страны: `Resource.country_code ?? Project.country_code → ProductionCalendar(страна, год даты)` — уже реализовано.
- Дорожная карта (слои): (1) сейчас — глобальный справочник + регистр с графиком; (2) скоро — capacity_share + период → сквозная загрузка по проектам; (3) потом — выравнивание ресурсов (алгоритм, отдельный продукт).
- Текущий скоуп (слой 1): глобальный справочник ресурсов (CRUD без project_id, вью на уровне тенанта) + миграция регистра (capacity_share/date_from/date_to) + UI назначения «ресурс→проект» с переопределением графика + фикс движка на register-override + миграция project-scoped ресурсов без потери.
- НЕ делаем сейчас: слои 2–3 (выравнивание/алгоритм загрузки) — преждевременно до появления кросспроектных данных.

### 17.11 События мощности ресурса (ResourceEvent) — реализовано 2026-09-10
- Назначение: модификаторы мощности ресурса на период. Типы: **boost** (форсаж), **reduced** (снижение), **breakdown** (простой/поломка), **maintenance** (ТО), **modernization** (модернизация), **condition_change** (изменение состояния), **other**. Основа Lean/CCM: muda (потери), muri (перегрузка).
- Модель `resource_events` (миграции 0027, 0028): tenant_id (CASCADE), resource_id (CASCADE), project_id (SET NULL), event_type, **capacity_multiplier** numeric(6,3) (ge=0; **0 = ресурс недоступен**), capacity_absolute numeric(14,3), **reason** (обязательна — трассируемость «почему сдвиг»), related_operation_id (SET NULL), base_document_type / base_document_id (документ-основание, аудит), **date_from / date_to — timestamp (точность до часов и минут)**, is_active.
- API `/v1/resource-events/` (CRUD): GET список (фильтры resource_id, project_id, event_type, active_only, date_from/date_to — пересечение интервалов), POST (201), GET/PUT/DELETE по id. Валидация: date_to >= date_from → 400; reason обязательна.
- UI: компонент `CapacityEvents` в карточке ресурса заказа (вкладка «Ресурсы»). Строка «Мощность: норма ×1.0» + чипы активных на текущий момент событий + список всех событий + кнопки **«＋ Форсаж / ＋ Ограничение / ＋ Простой/поломка»** (в режиме «✏️ Редактировать»). Модалка: тип, коэффициент мощности, период, причина. Клик по событию — редактирование/удаление.
- **Формат периода — единый по системе: ДД.ММ.ГГ (ЧЧ:ММ)**. Поля ввода — текстовые с автоматической маской (НЕ нативные `datetime-local`: они показывают формат локали браузера). Пример: `15.09.26 (08:30) – 16.09.26 (17:45)`.
- Правило расчёта (для учёта в CPM): эффективная длительность `D_eff = D_base / multiplier`; при частичном перекрытии периода — взвешенно по доле перекрытия. При `multiplier = 0` (простой) ресурс недоступен — **деление на ноль запрещено**, операция помечается как невыполнимая в этом окне.
- Предупреждения (план): форсаж > N рабочих дней → предупреждение muri; отчёт «потерянные часы по причинам» (muda) по событиям reduced/breakdown/maintenance.
- **Реализовано (10.09.2026, вечер):**
  - Рабочее окно дня берётся из графика работы (начало смены и её длительность из слотов `work`; перерывы внутри окна), а не из константы 08:00.
  - Единый сервис `app/services/capacity.py` (schedule_window, day_factor, op_day_windows, spread_work_hours, event_work_hours, loss_split, format_duration) — используется всеми расчётами: календарный (Гант), CPM и CCM.
  - Длительность везде считается в **днях, часах и минутах** (`duration_text`, `duration_hours`, `duration_minutes`, `start_datetime`/`finish_datetime` с точностью до минуты; рабочие часы раскладываются по рабочим дням, ночь и выходные пропускаются).
  - `POST /v1/projects/{id}/calculate/cpm` учитывает события мощности так же, как календарный расчёт (Гант и CPM дают одинаковые длительности и коэффициенты).
  - CCM: `GET /v1/ccm/resource-usage` — эффективные часы с событиями, потери (muda) и выработка (muri) с разбивкой по причинам; `GET /v1/ccm/projects/{id}/bottleneck` — длительности через CPM с событиями, потери по ресурсам и эффективная доступность.
  - Отчёт `GET /v1/reports/lost-hours` — итоги, разрез по причинам и ресурсам, журнал событий (часы в днях/часах/минутах).
  - UI: на экране Ганта проекта — блок «События мощности проекта и потери» (итоги, таблица по причинам, журнал событий).
- **Учитываются все ресурсы операции**: форсаж определяет ведущий (primary) ресурс, ограничения (m<1) любого ресурса — как самое узкое звено; событие `multiplier=0` блокирует операцию (предупреждение, срок невыполним).
- **Абсолютная мощность (11.09.2026):** если у события задана `capacity_absolute` вместо коэффициента, множитель считается как отношение к базовой мощности ресурса (`capacity_per_unit`): `m = capacity_absolute / capacity_per_unit`.

### 17.12 Доля мощности ресурса в проекте и квоты подразделений — реализовано 2026-09-11
- **Доля мощности в проекте** (`project_resources.capacity_share`, регистр ProjectResource): сколько мощности ресурса выделено проекту. Учитывается в расчётах (календарный/Гант и CPM) как множитель мощности: `D_eff = D_base / (share × события × квота)`. Пример: доля 0.5 → длительность вдвое больше; доля 0 → ресурс недоступен (предупреждение «срок невыполним»).
- **Квоты ресурсов по подразделениям** (`resource_department_quotas`, миграция 0029): доля мощности ресурса, доступная подразделению (`quota_share` 0..1, уникальность «подразделение + ресурс»). Учитывается для ресурсов, закреплённых за подразделением (`resources.department_id`).
- Итоговый множитель мощности ресурса: `capacity_share (проект) × quota_share (подразделение) × множитель события`. Ведущий ресурс операции задаёт форсаж; ограничения других ресурсов учитываются как узкое звено.
- Итоговый коэффициент и учтённые события возвращаются в узлах расчёта (`capacity_multiplier`, `capacity_events`).
- **Интерфейс квот:** в окне подразделения (окно редактирования записи справочника) — секция «Квоты ресурсов подразделения»: список квот (доля в процентах, правка по потере фокуса, удаление) и добавление ресурса через поле-ссылку. Компонент `DepartmentQuotas.tsx`.
- **CCM:** в сводке использования ресурсов часы пересчитываются по эффективной мощности (поля `capacity_hours`/`capacity_text`/`capacity_factor`), итог «с эффектом событий» считается от них; в интерфейсе — колонка «Мощность». Анализ узких мест уже учитывает долю и квоты (длительности берутся из CPM).
- **Визуализация:** в Ганте под баром операции — полоса эффективной мощности (зелёная — повышение/форсаж, оранжевая — ограничение), с подсказкой коэффициента и его источника (доля проекта / квота подразделения / событие).

### 17.13 Группы: маркеры, закрепления операций, потоки и настройки расчёта (согласовано 12.09.2026)
**Согласованная концепция (заказчик подтвердил):**
- Единица управления — **операция маршрута**, место — **ресурс**. Маркер ставится на ресурсе (в точке освобождения или на свободной доле мощности) и **привязывается к операции**, фиксируя её по времени.
- Сущностью является **закрепление операции** (операция + ресурс + тип ограничения + дата/время), маркер на шкале — его визуальное представление (один источник правды для интерфейса и расчёта).
- **Магнит** при перетаскивании: авто-подтягивание операции к якорю. Набор якорей и радиус — настройка группы.
- **Привязанные (закреплённые) операции статические**: CPM их не сдвигает; оптимизация и пересчёт идут по остальным операциям.
- **Итеративный цикл**: пользователь сдвигает → фиксирует маркером → пересчитывает CPM → следующий заказ. Порядок обхода фиксируется в журнале для воспроизводимости (жадная стратегия).
- **Группа объединяет куст заказов целиком** (заказ со всеми подзаказами) — решено: подзаказы отдельно не выдёргиваются, иначе рвутся связи «полуфабрикат → сборка», разъезжается срок сдачи и ломается отчётность. Гибкость даёт закрепление операций, а не дробление куста.
- **Потоки** (объединение подзаказов/операций по участкам: фундаменты, металл, монтаж) — **делаем сразу**, но **расчёт по потокам включается настройкой группы и по умолчанию выключен**; при включении меняется тактика расчёта группы.

**Настройки расчёта группы (по умолчанию — согласовано):**
1. **Расчёт по потокам** — выключен (включает пользователь при необходимости; меняет тактику расчёта группы).
2. **Магнит и якоря** — каждый якорь включается/выключается отдельно; по умолчанию включены три самых употребительных:
   - **Конец чужой операции на общем ресурсе — ВКЛ** → ограничение «начать не раньше конца этой операции» (встать сразу после того, кто занял ресурс);
   - **Начало свободного окна мощности ресурса — ВКЛ** → «начать не раньше начала окна» (ресурс занят частично, есть свободная доля);
   - **Начало следующей операции — ВКЛ** → «закончить к началу следующей» (встать встык, не разрывая цепочку);
   - **Контрольная дата (веха заказа) — ВЫКЛ** (включается по потребности) → «закончить к дате» / «закончить не позже».
3. **Радиус магнита** — **1 день** по умолчанию; настраиваемое значение с выбором единицы **от минут до дней** (минуты / часы / смены / дни). Влияет на «липкость»: меньше радиус — точнее ручной контроль, больше — удобнее дальние сдвиги, но «хватает» лишнее.
3а. **Шаг прилипания** — 1 день (по умолчанию; вариант — смена/час, по шагу шкалы).
3б. **Приоритет якорей** при нескольких в радиусе — по умолчанию: конец чужой операции → начало свободного окна мощности → начало следующей операции → веха. Первый подходящий выигрывает; выбранный якорь подсвечивается лучом магнита (визуальная обратная связь).
3в. **Подсветка луча магнита** — включена (видно, к какому якорю «прилипнет» операция).
4. **Тип закрепления** — **жёсткое** (CPM обязан соблюсти). Мягкий режим — опция: при конфликте система по умолчанию жертвует **датой закрепления** (сдвигает саму привязку, сохраняя срок заказа); альтернативная опция — жертвовать сроком заказа.
5. **Показывать «цену» перегрузки в ползунке «что если»** — **да** (сокращение срока + снятые конфликты + рост риска перегрузки muri).
6. **Авто-подбор даты и времени закрепления** — **да**: система предлагает **2–3 варианта** точки закрепления с оценкой последствий (эффект на срок, конфликты, загрузка); пользователь выбирает или корректирует. Опция «одна лучшая точка» доступна.
7. **Показывать закрепления на полноэкранном Ганте и в CCM** — **да**.
8. **Порог индикатора «свобода плана»** — предупреждение, когда незакреплённых операций меньше **20%**; порог настраивается (в процентах).

**Уровни настроек и значения по умолчанию (согласовано):**
- Настройки наследуются по цепочке: **системные значения → настройки рабочего стола (дефолты пользователя/тенанта) → настройки проекта → настройки группы**. Ближайший уровень перекрывает предыдущий.
- В интерфейсе у каждого поля видно, откуда значение: «унаследовано из проекта» / «своё для группы», с кнопками «переопределить» и «вернуть к наследованию».
- Кнопка **«Сделать настройки этой группы значениями по умолчанию»** — переносит текущий набор на уровень рабочего стола (или проекта — на выбор).
- Раздел для правки дефолтов — существующие **«Настройки»** рабочего стола, секция «Планирование и расчёт» (магнит и якоря, закрепления, потоки, индикаторы); там же сброс к системным значениям.
- Хранение: дефолты — на уровне тенанта/пользователя; проект и группа хранят только отклонения (переопределения).

**Тактика расчёта по потокам (предложение на согласовании, обосновано предметной областью):**
- Опора на **поточный метод организации работ**: работы ведутся **захватками (фронтами)**; **ритм бригады** — продолжительность работ на одной захватке; **шаг потока** — время между переходом смежных работ на следующую захватку. Виды потоков: равноритмичные (ритмы равны), кратноритмичные (кратны), разноритмичные (произвольные). В производстве тот же смысл несут **переделы** и передаточные партии.
- **Поток в ProfyPlan** — группа операций, объединённых признаком участка/передела (монтаж, изготовление металла, фундаменты и т. п.). Внутри потока фронты (захватки) — это места/объекты, где работы идут последовательно.
- **Что меняется при включении расчёта по потокам (главное):** внутри потока вводится **непрерывность ресурса** — ресурс, закончив фронт, переходит на следующий фронт **без простоя** (в пределах настраиваемого минимального разрыва). Это и есть «общая очередь на ресурсах внутри потока». Совместная оптимизация операций участка — следствие непрерывности, а не отдельный механизм.
- **Параметры потока:** минимальный разрыв между фронтами (по умолчанию 0 — встык), шаг потока (может быть вычислен из ритмов или задан вручную), приоритет потока при конфликте за общий ресурс.
- **Конфликты между потоками** (общий ресурс нужен двум потокам) решаются сдвигом потока с меньшим приоритетом; закрепления (pin) при этом жёсткие и уважаются обоими потоками.
- **Порядок расчёта:** (1) разложить операции группы по потокам и фронтам; (2) разместить поток по ресурсам с непрерывностью; (3) наложить закрепления как жёсткие ограничения; (4) посчитать CPM внутри операций; (5) согласовать потоки по общим ресурсам; (6) выдать «до/после» и предупреждения.
- **Эффект:** меньше переключений ресурсов между заказами, ровнее загрузка, предсказуемый ритм исполнения. Цена: срок может оказаться **чуть больше**, чем при независимом расчёте кустов (независимый расчёт даёт формально минимальный срок, но рваную загрузку и переходы).
- **Когда включён, когда нет:** по умолчанию **выключен** (кусты считаются независимо — текущее поведение). Включается в настройках группы, когда нужно выровнять ритм исполнения участка.

**Механика закрепления в расчёте:**
- Типы ограничений закрепления: «начать не раньше», «закончить к» (точная дата окончания), «закончить не позже», «окно доступности ресурса».
- В прямом проходе CPM закрепление задаёт нижнюю границу старта, в обратном — верхнюю границу финиша; остальные операции пересчитываются.
- Конфликт закрепления с технологией (предшественник не успевает) → предупреждение с указанием связи и величины расхождения.
- Закрепление можно снять — операция возвращается в оптимизацию (запись в журнал).
- **Индикатор «свобода плана»** — доля незакреплённых операций; предупреждение, когда свободы почти не осталось (оптимизация перестаёт что-либо менять).

**«Что если» по мощности (игровая подача):** ползунок +X% мощности ресурса → мгновенный пересчёт без сохранения: сокращение срока проекта, снятые конфликты, рост риска перегрузки. Фиксация — отдельной кнопкой (создаёт событие мощности или меняет характеристику ресурса).

### 17.14 Настройки планирования с наследованием (шаг 1.1, 12.09.2026) — реализован бэкенд
**Идея.** Все параметры планирования (магнит, закрепления, потоки, «что если», индикаторы, интерфейс) живут в едином реестре и наследуются по уровням: **system → рабочий стол → проект → группа**. Каждый уровень хранит только переопределения; эффективное значение собирается по цепочке, ближайший уровень побеждает.

**Реестр параметров (23, шесть групп):**
- **Потоки:** расчёт по потокам (вкл/выкл, по умолчанию выкл), минимальный разрыв, шаг потока, приоритет потока.
- **Магнит:** четыре якоря (конец чужой операции — вкл, свободное окно мощности — вкл, начало следующей операции — вкл, веха — выкл), радиус (1 день; единицы: минуты/часы/смены/дни), шаг прилипания, показ луча.
- **Закрепления:** тип (жёсткое/мягкое), чем жертвуем в мягком режиме (дата закрепления), авто-подбор (2–3 варианта или лучшая точка), число вариантов, видимость на Ганте и в CCM.
- **Что если:** показывать цену перегрузки в ползунке мощности.
- **Индикаторы:** порог «свободы плана» (20%).
- **Интерфейс:** показывать подсказки, задержка появления (400 мс).

**API `/v1/planning-settings`:**
- `GET` (с `project_id`/`group_id`) — эффективные значения с указанием **источника** каждого (`system`/`workspace`/`project`/`group`) и полный реестр (ключ, тип, значение по умолчанию, заголовок, пояснение — пояснения используются подсказками интерфейса).
- `GET /levels` — значения каждого уровня отдельно плюс эффективные.
- `PUT` — сохранить переопределения уровня; значение `null` **удаляет** переопределение (возврат к наследованию); `{"__promote_to_workspace__": true}` копирует эффективные значения уровня на рабочий стол (кнопка «сделать значениями по умолчанию»).
- `DELETE` (по уровню) — сбросить все переопределения уровня.

**Правило для новых параметров:** добавлять в реестр (`app/services/planning_settings.py`) с типом, значением по умолчанию, заголовком и пояснением; интерфейс и подсказки строятся автоматически по реестру.
**Экран настроек (часть 2):** панель «⚙️ Планирование и расчёт» в разделе «Настройки» рабочего стола (компонент `PlanningSettingsPanel`).
- Переключатель уровня: **Рабочий стол / Проект / Группа**; для проекта и группы — выпадающие списки выбора (загружаются из API).
- Параметры сгруппированы по блокам реестра (Потоки, Магнит, Закрепления, Что если, Индикаторы, Интерфейс).
- У каждого параметра: название, текущее значение, **источник** («своё для рабочего стола» либо «унаследовано: проект/система»), элемент управления и кнопка **↺ «вернуть к наследованию»** (активна только при наличии переопределения).
- Изменение значения сразу создаёт переопределение выбранного уровня; кнопки **«Сделать значениями по умолчанию»** (переносит значения уровня на рабочий стол) и **«Сбросить уровень»**.
- Пояснения параметров выводятся во всплывающей подсказке (до внедрения единого механизма подсказок — через нативный `title`).

### 12.21 Planning Settings — настройки планирования с наследованием (реализовано ✅) — НОВОЕ
- `GET /v1/planning-settings` — эффективные значения + источник + реестр параметров.
- `GET /v1/planning-settings/levels` — значения по уровням (рабочий стол, проект, группа).
- `PUT /v1/planning-settings` — переопределения уровня; `null` сбрасывает к наследованию; поддерживает перенос значений на рабочий стол.
- `DELETE /v1/planning-settings?scope=&scope_id=` — сброс уровня.
- Миграция `0030_planning_settings` (таблица `planning_settings`, JSONB, уникальность по tenant+scope+scope_id).

### 17.15 Закрепления операций, потоки и журнал сдвигов (шаг 2.1, 12.09.2026) — реализованы данные и API
**Таблицы (миграция 0031):**
- **`operation_pins`** — закрепления операций («маркеры»): операция, ресурс (может быть не задан), группа, **тип ограничения** (`start_not_earlier` — начать не раньше, `finish_at` — закончить к дате, `finish_not_later` — закончить не позже, `capacity_window` — окно доступности мощности), дата-время, признак **жёсткости** (жёсткое/мягкое), примечание.
- **`group_flows`** — потоки (участки) группы: название, **минимальный разрыв** между фронтами, **шаг потока** (ритм, может быть не задан — тогда вычисляется), приоритет потока при конфликте за общий ресурс, активность.
- **`group_flow_operations`** — привязка операций к потоку.
- **`group_shift_logs`** — журнал действий: `pin` / `unpin` / `shift` / `promote` / `flow`, полезная нагрузка (что и на сколько сдвинуто, «до/после»), автор, примечание. Нужен для отката, аудита и воспроизводимости итеративного планирования.

**API:**
- `GET /v1/projects/{project_id}/pins` — закрепления проекта (с названиями операции и ресурса).
- `POST /v1/pins`, `PUT /v1/pins/{id}`, `DELETE /v1/pins/{id}` — создать (201), изменить, снять; каждое действие пишет запись в журнал.
- `GET /v1/groups/{group_id}/flows`, `POST /v1/flows`, `PUT|DELETE /v1/flows/{id}` — потоки группы.
- `POST /v1/flows/{flow_id}/operations?operation_id=…`, `DELETE /v1/flows/{flow_id}/operations/{operation_id}` — привязка и отвязка операций.
- `GET /v1/projects/{project_id}/shift-log?limit=` — журнал действий по проекту.

**Правило:** закрепление делает операцию статической для расчёта (CPM её не двигает) — это реализуется на шаге 2.2.

### 12.22 Pins / Flows / Shift Log — закрепления, потоки, журнал (реализовано ✅) — НОВОЕ
- `GET /v1/projects/{project_id}/pins` — список закреплений (фильтр `group_id`).
- `POST /v1/pins` (201), `PUT /v1/pins/{id}`, `DELETE /v1/pins/{id}` (204) — CRUD закреплений; все действия журналируются.
- `GET /v1/groups/{group_id}/flows`, `POST /v1/flows` (201), `PUT /v1/flows/{id}`, `DELETE /v1/flows/{id}` — потоки (участки).
- `POST /v1/flows/{flow_id}/operations?operation_id=…` (201), `DELETE /v1/flows/{flow_id}/operations/{operation_id}` (204).
- `GET /v1/projects/{project_id}/shift-log?limit=` — журнал сдвигов и закреплений.

### 17.16 Расчёт CPM с закреплениями (шаг 2.2, 12.09.2026) — реализовано
**Как применяются закрепления в календарном расчёте:**
- **«начать не раньше»** и **«окно доступности мощности»** задают **нижнюю границу старта** операции: она не может начаться раньше указанного момента (в прямом проходе CPM старт поднимается до границы).
- **«закончить к дате»** и **«закончить не позже»** задают **верхнюю границу финиша**: в обратном проходе финиш ограничивается сверху.
- Границы выражаются в рабочих днях от начала проекта: дата закрепления переводится в индекс рабочего дня, к нему добавляется доля рабочего дня (от **начала смены** по графику, а не от полуночи).
- **Закрепление на нерабочий день** (выходной/праздник) переносится на ближайший рабочий день вперёд — иначе ограничение «съезжало» бы назад.
- Закрепления учитываются вместе с мощностями: сначала применяются доли/квоты и события мощности, затем накладываются закрепления (единый пересчёт).
**Что возвращает расчёт (дополнения):**
- `pins` — применённые закрепления (операция, тип, дата-время, жёсткость, позиция в рабочих днях);
- в узлах операций — `is_pinned`, `pin_min_start`, `pin_max_finish`;
- `plan_freedom` — «свобода плана»: всего операций, закреплено, процент свободы и **порог из настроек** (по умолчанию 20 %);
- предупреждение **`pin_violation`** — если операция не успевает к закреплённому сроку (с указанием расхождения в часах); предупреждение **`low_freedom`** — если свобода плана ниже порога.
**Правило:** закреплённая операция считается статической — расчёт не сдвигает её «раньше/позже» закрепления, пересчитываются остальные операции.

## 20. Интерфейс: навигация, графики, инструменты, сценарии, хелп-зона (решено 12.09.2026)

**Основа раскладки:** четыре зоны рабочего стола (навигация; контекст и действия; рабочая область; окна поверх) и пять уровней иерархии: Портфель → Проект → Куст (группа/пул) → Заказ → Операция.

**Окна сохраняются.** 13 существующих видов окон остаются основным способом параллельной работы: сравнить два заказа, держать состав изделия рядом с планом, править справочники не уходя с рабочего места. Инспектор выделенного объекта — **дополнительная сворачиваемая панель**, а не замена окон; любое окно можно «прикрепить» к панели, если оно мешает графику. Рейка объектов вместо дерева проектов не вводится.

**Единый расчёт.** Одна кнопка «▶ Рассчитать» с явно указанной областью (заказ / куст / проект / портфель) вместо разных названий в разных местах.

**Графики — это виды рабочего поля, а не страницы.** Сеть CPM переносится в рабочую область как вид, страница `/cpm` **удаляется**. Внешние адреса-двойники (`/cpm`, `/ccm`, `/ccm-v2`) и статические страницы доставки (`/plan.html`, `/report.html`) убираются из проекта: каждый инструмент живёт в рабочем столе, дублирующие входы — мусор. Вместо перенаправлений — один обработчик «страница переехала», который предлагает открыть рабочий стол. Единая шкала времени, единые единицы (дни/часы/минуты) и общая легенда на всех видах.

**Разделы аналитики разделяются:** «CCM · Пулы» (узкое звено, простои на переходах, буфер куста) и «CCM · Портфель» (конкуренция за общие ресурсы, предложения сдвига) + «Отчёты» (потери часов, загрузка по неделям и подразделениям). Справочники и настройки — отдельно от аналитики.

**Новый раздел «Инструменты»:** сеть CPM, сценарии «что если», сравнение версий плана, журнал изменений, Monte-Carlo/PERT, экспорт. Из сущности инструменты вызываются с уже подставленным контекстом.

**Версия и сценарий — постоянно в шапке:** «Версия v4 · Сценарий „…“» и кнопки «сохранить», «сравнить», «применить». Применение сценария создаёт новую версию плана. Сценарий — это набор изменённых условий (события мощности, доли и квоты, закрепления, поток, настройки) плюс отдельный расчёт и сравнение с текущим планом или версией; новая математика не требуется.

**Принятые решения (вопросы концепции):**
1. Сценарий по умолчанию **локальный** (один куст или ресурс); кнопка «расширить до портфеля», когда изменённый ресурс используется другими проектами.
2. История версий **линейная**, хранение последних **20** версий на проект.
3. Порог алерта по ресурсу — **настраиваемый**, по умолчанию **105 %**.
4. Локальные расчёты — синхронно, портфельные — **в фоне с уведомлением**.
5. Авто-закрепление система только **предлагает**; применяет пользователь.

**Порядок внедрения по риску:** шаг 0 — единая кнопка расчёта и разделение меню; шаг 1 — сеть CPM как вид области, удаление `/cpm` и адресов-двойников, чистка ссылок на лендинге; шаг 2 — хлебные крошки контекста и переключатели «маркеры / события мощности / поток»; шаг 3 — инспектор выделенного объекта как сворачиваемая панель (окна не трогаем); шаг 4 — версия и сценарий в шапке, журнал изменений в постоянном месте. **Не делаем сейчас:** замену окон инспектором, рейку вместо дерева, переработку оболочки.

**Когда делаем (привязка к порядку работ, решено 12.09.2026):**
- **Шаг 8.1** (единая кнопка расчёта, разделение меню аналитики, раздел «Инструменты») и **шаг 8.2** (сеть CPM как вид области, удаление страницы `/cpm` и внешних адресов-двойников) — **сразу, до шага 2.3**: это только фронтенд, низкий риск, две сборки, и они снимают путаницу в навигации, которая мешает проверке полигонов.
- **Шаг 8.3** (хлебные крошки контекста, переключатели «маркеры / события мощности / поток») — **вместе с шагом 2.3**: шкала группы по ресурсам создаёт то место, к которому эти переключатели относятся.
- **Шаг 8.4** (инспектор выделенного объекта, «прикрепить окно») — **после шага 2.5**: к этому моменту известно, какие свойства операции показывать (закрепление, резерв, ресурс).
- **Шаг 8.5** (версия и сценарий в шапке, сценарии «что если», журнал изменений) — **после шага 2.9** (ползунок «что если»), перед фазой 3: сценарии опираются на механику «что если», а журнал уже пишется с шага 2.1.

**Хелп-зона (в план, не срочно):** раздел «Помощь» с поиском, статьями и примерами, а также контекстная справка по текущему объекту и модулю.

## 21. Фаза 2 «Маркеры и закрепления» — состояние на 12.09.2026

**Сделано и выложено:**
- **2.1** данные: закрепления операций, потоки и журнал действий (миграция `0031`).
- **2.2** расчёт CPM с закреплениями: «начать не раньше» и «окно мощности» — нижняя граница старта, «закончить к/не позже» — верхняя граница финиша; закрепление с нерабочего дня переносится на ближайший рабочий; предупреждения `pin_violation`, индикатор `plan_freedom`.
- **2.3** шкала куста по ресурсам (вид рабочего стола «Шкала куста»): строки — ресурсы, полосы — операции, подсветка общих ресурсов, маркеры закреплений, события мощности, «призрак» прежнего положения; новый эндпоинт `GET /v1/projects/{id}/operations/resources-map` (все ресурсы операций проекта одним запросом).
- **2.4** магнит: перетаскивание полосы с прилипанием к концу соседней операции, началу следующей или сетке дней (радиус 1 день); на отпускании ставится жёсткое закрепление; обычный клик (смещение < 4 px) лишь открывает панель.
- **2.5** постановка и снятие закрепления из панели на шкале: три типа ограничения, переключатель жёсткости, дата и время, показ «до/после» серыми полосами; после каждого действия план пересчитывается.
- **2.6** индикатор «свобода плана» в шапке шкалы: процент, полоса, порог из настроек, число закреплённых операций.
- **2.7** авто-подбор вариантов закрепления в панели: до четырёх вариантов (после предыдущей операции на этом ресурсе, к началу следующей, после события мощности, оставить как в плане) со сдвигом в днях и пометкой «внутри простоя».
- **2.8** расчёт по потокам: операции потока упорядочиваются по плановому старту, следующей задаётся нижняя граница (финиш предыдущей плюс разрыв, не раньше ритма); в ответе расчёта блок `flows` со счётчиком сдвинутых операций; пары, где технология требует обратного порядка, пропускаются с предупреждением `flow_conflict`; если набор ограничений конфликтует, они применяются по одному, конфликтные пропускаются с предупреждением `constraints_skipped`.

**2.8 подтверждён на проде.** Поток применяется к расчёту и отражается в ответе API:
- **Порядок цепи** — в порядке привязки операций планировщиком (не по сортировке и не по датам): так поведение предсказуемо и совпадает с замыслом.
- **Ограничение:** каждой следующей операции задаётся нижняя граница старта — не раньше финиша предыдущей плюс разрыв потока, и не раньше ритма; граница считается так же, как у закреплений (индекс рабочего дня от якоря).
- **Проверка:** поток из двух операций с разрывом 30 дней — следующая операция сдвинулась с 06.09.2027 на 10.01.2028 (внутри расчёта `es` 236.25 → 334.64 дн), предшественник не изменился.
- **Защиты:** пары, где технология требует обратного порядка, пропускаются (`flow_conflict`); конфликтующий набор ограничений применяется поштучно (`constraints_skipped`), а не отбрасывается молча.
- **В ответе** по каждому потоку видно: число операций, разрыв, ритм, приоритет, сколько операций сдвинуто и по каждой границе — требуемая позиция, прежняя позиция и признак «кусается».

**Уроки диагностики:** идентификаторы операций в расчёте и в ответе сопоставляются без учёта регистра; первая версия проверки сравнивала не ту операцию пары, из-за чего казалось, что поток «не работает».

**2.9 «Что если» по мощности — сделано.** В расчёт добавлен параметр `power_factor` (множитель мощности всех ресурсов, 0.5–1.5): длительности пересчитываются без записи в план, в ответе есть блок `what_if`. В шапке шкалы куста — ползунок «Что если — мощность ресурсов», кнопки «Прикинуть» и «Сбросить» и строка сравнения: «Сценарий ×1.5: финиш … (обычный план: …)». Проверка на полигоне A: база ×1.0 — 23.08.2028, ×1.5 — 27.01.2028, ×0.7 — 15.06.2029; данные плана не меняются.

**8.4 инспектор выделенной операции — сделано.** Панель выделенной операции показывает: имя, ресурс, плановые сроки, длительность, критичность («задержка сдвигает проект» или «есть резерв»), резерв в днях, признак закрепления; ниже — варианты закрепления, поле даты, переключатель жёсткости, снятие закрепления. Окна при этом сохранены полностью, инспектор их не заменяет.

**8.5 версии плана — сделано (базовая часть).** В шапке шкалы — блок «Версии плана»: список сохранённых версий (номер, название, дата, признак активной) и кнопка «💾 Сохранить версию» — текущий план замораживается через существующий механизм версий. Сценарии «что если» работают рядом (ползунок мощности). Сравнение версий «было/стало» и применение сценария как новой версии — уточняются при тестировании.

**Фаза 2 закрыта полностью** (шаги 2.1–2.9 и интерфейсные 8.1–8.6). **2.9** ползунок «что если» по мощности, затем интерфейсные **8.4** инспектор выделенного объекта (окна сохраняются) и **8.5** версии и сценарии в шапке.

**Из интерфейсных шагов выложены:** 8.1 (единая кнопка «▶ Рассчитать», разделение меню аналитики, раздел «Инструменты»), 8.2 (сеть CPM как вид рабочего поля, входы из Ганта и «Инструментов»), 8.3 (хлебные крошки контекста и переключатели «маркеры / события мощности / поток»), 8.6 (удалены адреса-двойники и страницы доставки, добавлена страница «переехало»).

## 22. Термины: типы операций и типы ресурсов (решено 13.09.2026)

**Продукт не отраслевой.** ProfyPlan применяется в промышленности, логистике, транспорте, добыче, сельском хозяйстве, услугах — поэтому все типы и формулировки должны быть нейтральными и совпадать с общепринятыми понятиями планирования (activity/wait/milestone, internal/external resource, capacity).

**Три типа операций:**
- **Работа** — есть исполнитель и она занимает его мощность (activity/operation: механообработка, перевозка, бурение, посев, монтаж). Значение по умолчанию.
- **Ожидание** — время идёт без исполнителя: поставка, согласование, оформление, карантин, отлёжка, остывание, транзит (wait/lag/queue time). Применяется там, где по TPrmBOM задан срок поставки.
- **Веха** — контрольная точка с нулевой длительностью (milestone: приёмка, сдача, готовность к отгрузке).

**Два типа ресурсов:**
- **Собственный** — мощность под нашим управлением (станок, цех, бригада, транспорт, поле, скотоместо).
- **Внешний (по договору)** — мощность другой организации: перевозчик, субподрядная бригада, арендованная техника, контрактный цех, буровая подрядная организация. Работает по тем же правилам: доступная мощность по договору, доля в проекте, квоты, события мощности, участие в межпроектных конфликтах и в отчётах по загрузке.

**Правило выбора:** есть исполнитель, чью занятость или задержку надо учитывать → это **работа** с ресурсом (собственным или внешним). Время идёт без исполнителя → **ожидание** (ресурс не нужен). Нужно зафиксировать точку → **веха**.

**Отображение:** на шкале куста — три группы строк: «Ресурсы», «Внешние ресурсы», «Ожидания и поставки». В отчёте по загрузке подразделений считаются только работы с ресурсами; ожидания показываются отдельной колонкой в днях без процентов. Вехи — ромбами на шкале и Ганте.

**Работы (объём):** 1) тип операции работа/ожидание/веха — S; 2) тип ресурса собственный/внешний — S; 3) три группы строк на шкале куста — M; 4) отчёт по загрузке без искажения ожиданиями — S; 5) импорт читает типы из шаблона, в шаблонах колонки «Тип операции» и «Тип ресурса» — S; 6) вехи нулевой длительности с отображением ромбом — S.

## 23. Сверка решений (13.09.2026): что дописано в план

При сверке всех документов обсуждения выявлены пункты, которые были решены, но не попали в промт и план. Они зафиксированы здесь:
1. **Вариант B раскладки** (план слева + аналитика справа) — опция после базовой раскладки; реализуется как расширение, а не замена.
2. **Вариант C: рабочие места** — сохранённые раскладки (Планировщик / Аналитик / Портфель) поверх оконного режима: рабочее место = сохранённый набор окон.
3. **Лента потока** — визуализация потока (фронты и ритм) на шкале куста; опирается на расчёт потоков (шаг 2.8).
4. **Хранение версий** — линейная история, до 20 версий на проект.
5. **Лендинг, мелкие доработки** — кнопка «Запросить демо», строка масштаба расчёта, дисциплина ведения ленты обновлений (одна строка на релиз).
6. **Единая модель графиков** — общая шкала времени и легенда на всех видах (частично сделано на шкале куста); S-кривая план/факт и буфер куста — в плане.

Сводная таблица «решение → состояние → где записано» вынесена в отдельный документ сверки. Ничего из решённого не потеряно: всё, что не реализовано, зафиксировано в плане; сознательно отложено только то, что перечислено в §20 (замена окон инспектором, рейка объектов, переработка оболочки).

## 24. Заказы, группы и пулы в интерфейсе (решено 13.09.2026, уточнено)

**Решение:** заказ — основная сущность планирования и общий раздел проекта. Группы и пулы — **способы объединения заказов** для совместного расчёта (куст с общими ресурсами), а не самостоятельные разделы. Дробить их на отдельные рубрики нельзя: это дробит одну и ту же работу и путает планировщика.

**Один раздел «Заказы», пять режимов просмотра (переключатель в шапке раздела):**
1. **Все заказы** — плоский список всех заказов проекта со всеми действиями (цепочка, ресурсы, состав).
2. **Свободные** — заказы, не входящие ни в группу, ни в пул (сейчас это блок внутри списка). Именно они подлежат объединению в куст.
3. **По группам** — те же заказы, сгруппированные по кустам; здесь создание, переименование и удаление группы.
4. **По пулам** — представление пулов с перетаскиванием заказов.
5. **Требуют внимания** — заказы, по которым расчёт выдал предупреждения: просроченный срок, конфликт ресурсов, попадание в простой. Данные уже считаются расчётом.

**Фильтры и статусы неготовности (важно различать):**
- **не развёрнут** — у заказа нет операций (состав не развёрнут), в расчёте он не участвует;
- **не рассчитан** — операции есть, но плана по ним нет или он устарел после изменений;
- **рассчитан** — есть актуальный результат.
Фильтр в шапке раздела: «все / только неготовые», с раздельным выбором «не развёрнутые», «не рассчитанные».

**Подсветка неготовых:**
- строка заказа — мягкий фон и цветная метка слева, статус-чип в строке («не развёрнут» / «не рассчитан» / «рассчитан»);
- в шапке раздела счётчик «неготовых: N» и кнопка «показать только неготовые»;
- рядом с пунктом «Заказы» в дереве проекта — счётчик неготовых, чтобы это было видно, не открывая раздел.

**Что убирается и что сохраняется:** пункты «Группы» и «Пулы» из дерева проекта убираются, их функции (создание, состав, поток, перетаскивание) переносятся в раздел «Заказы». Вид «Шкала куста» по-прежнему открывается для выбранного куста (группы или пула).

**Куда в плане:** полировка областей (фаза 3) — пять режимов, фильтры неготовности, подсветка и счётчики.

## 25. Вопросы без ответа (сводка 13.09.2026) — ВСЕ ЗАКРЫТЫ

**Статус: все пункты ниже получили решения владельца 13.09.2026, ответы — в §26 и §27.** Раздел оставлен как история (что именно спрашивали и почему это важно), актуальные решения смотрите там же. Открытых вопросов без решения не осталось; всё неосуществлённое переведено в задачи плана (фазы 3–9).

Вопросы задавались по ходу обсуждения, но на момент составления сводки оставались без ответа:
1. CCM: делаем «CCM · Пулы» основным экраном раздела, а межпроектное выравнивание переносим во вкладку «Портфель»? — я предлагал «да» — сейчас в разделе лежит межпроектный экран
2. Буфер куста: считать по критической цепи (агрегированный буфер) или как запас из суммы резервов операций? — от этого зависит формула и показ буфера
3. Нужен ли CCM по пулу без потока — когда заказы независимы, но делят ресурс? — самый частый случай на практике
4. Маркеры при открытии куста: включены по умолчанию? — сейчас реализовано «включены» — нужно подтверждение
5. Строка контекста «Портфель → Проект → Куст → Заказ»: названия и порядок подтверждаем? — реализовано, но без явного согласования
6. Лендинг: добавляем кнопку «Запросить демо» и строку масштаба расчёта? — мелкая доработка, ждёт решения
7. Отладочный режим на проде: выключаем? — сейчас на проде видны служебные пометки и кнопки копирования идентификаторов
8. Временный проект «Тест-план (врем.)» на проде: удалять? — висит с прошлых проверок
9. Магнит: радиус притяжения брать из настроек (сейчас зашит 1 день)? — в реестре настроек параметр есть, в коде — константа
10. Окно «Заказы — проект X»: чинить переключение контекста при выборе другого проекта? — замечено раньше, не закрыто

**Внешние условия (нужны действия владельца):**
11. CI/CD: нужны секреты GitHub (доступ к серверу и реестру) — автоматическая сборка и деплой — ждёт твоего действия
12. Выгрузка в Google Sheets: нужен JSON-ключ сервисного аккаунта — ждёт твоего действия

Остальное либо уже в плане, либо отменено: варианты B и C раскладки, «прикрепить окно», S-кривая, лента потока и буфер куста — в плане; сравнение версий и применение сценария — в плане; типы операций и ресурсов — шесть шагов; пять режимов раздела «Заказы» — фаза 3; хелп-зона — фаза 9; замена окон инспектором, рейка и переработка оболочки — не делаем.

## 26. Решения по открытым вопросам (13.09.2026)

1. **CCM · Пулы — основной экран раздела аналитики.** Межпроектное выравнивание переносится во вкладку «Портфель». Реализуется в фазе 3.
2. **Буфер куста — агрегированный буфер критической цепи.** Формула: буфер = коэффициент × сумма резервов операций куста (коэффициент по умолчанию 0,5, настраивается). Показывается отдельной полосой в конце куста, с индикатором «съедено N %». Сумма резервов как «буфер» не используется — это лишь мера свободы.
3. **CCM по пулу без потока — нужен.** Различаем два вида: пул-поток (технологическая связь: ритм и разрыв) и пул-группа (заказы независимы, но делят ресурс). Для пул-группы показываем: занятость ресурса по заказам, простой на переходах, узкое звено и эффект очерёдности («выстроить в очередь» против «давать параллельно»). Реализация — на том же экране «CCM · Пулы» с переключателем вида «поток / смена ресурса».
4. **Маркеры включены по умолчанию**, но сам признак «показывать маркеры при открытии» выносится в настройки (уровни: рабочий стол / проект / группа).
5. **Строка контекста «Портфель → Проект → Куст → Заказ» подтверждена.**
6. **Лендинг: кнопку «Запросить демо» и строку масштаба не добавляем** (решение владельца). Лента обновлений остаётся.
7. **Отладочный режим на проде сохраняется**, включается настройкой. Агенту он не мешает — работать с ним можно.
8. **Временный проект «Тест-план (врем.)» остаётся** как тестовый, владелец удалит сам.
9. **Радиус магнита берётся из настроек**; значение по умолчанию — 1 день, пользователь меняет сам (единицы: от минут до дней).
10. **Окно «Заказы — проект X»:** при выборе другого проекта содержимое окон, привязанных к проекту, обновляется; в заголовке окна показывается проект. Решение ожидает подтверждения владельца (пояснение отправлено).
11. **CI/CD работает (проверено 13.09.2026).** Владелец добавил секреты `SSH_HOST`, `SSH_USER`, `SSH_KEY`. Workflow `.github/workflows/deploy.yml` по пушу в master (и по кнопке «Run workflow») заходит на сервер, приводит его к `origin/master` (fetch + reset --hard — сервер своей истории не ведёт), пересобирает `api` и `web`, перезапускает и проверяет доступность. **Правило деплоя: правки отправляются пушем в master, патчи по SSH больше не используются.** Владельцу отправлено пояснение (автоматическая сборка и выкладка по пушу; нужны секреты репозитория: адрес сервера, пользователь, SSH-ключ). (автоматическая сборка и выкладка по пушу; нужны секреты репозитория: адрес сервера, пользователь, SSH-ключ). Пока деплой ручной.
12. **Интеграции — в настройках проекта.** Загрузка и выгрузка (в том числе Google Sheets) настраиваются пользователем в разделе «Интеграции» настроек проекта: модуль подключения, проверка связи, сохранение параметров для текущего проекта. Секреты хранятся по проекту и не показываются в открытом виде.

## 27. Решения 13.09.2026 (вторая часть)

1. **Буфер куста — агрегированный буфер критической цепи.** Коэффициент буфера выносится в настройки: параметр «Буфер куста, % от суммы резервов операций», значение по умолчанию 50 %. Описание в настройке: «Какую часть резервов операций куста переводим в общий защитный буфер в конце куста. Больше значение — срок устойчивее к задержкам, но общий срок длиннее. 0 — буфер не создаётся, резервы остаются в операциях». В интерфейсе — полоса буфера в конце куста и индикатор «съедено N %».
2. **Подписи окон проектом — обязательны** и уже соблюдены: окна и виды показывают проект в заголовке (например, «Заказы — Полигон A — Мосты (тест)»). Переключение контекста проверено: при выборе другого проекта список заказов перестраивается на него (раньше это казалось дефектом из-за ошибки в автоматическом клике).
3. **Оттенок проекта — одобрено владельцем, реализуется в фазе 3** (вместе с подписями окон и полировкой областей). Каждому проекту присваивается собственный оттенок из фиксированной палитры (6–8 значений в общей гамме, с автоназначением при создании и возможностью сменить). Оттенок применяется к элементам идентичности: строка проекта в дереве, заголовок окна, чип проекта в шапке, тонкая полоса-акцент у панелей; не применяется к элементам со смыслом (критичность, потери, события, конфликты) — иначе смысловые цвета будут конфликтовать. Требование: контраст текста сохраняется, отличия — в пределах 10–15 % насыщенности, чтобы не пестрило.
4. **CI/CD — автоматическая сборка и выкладка.** Создан ключ деплоя (`~/.ssh/profyplan_deploy`), публичная часть добавлена в `authorized_keys` на сервере. Добавлен workflow `.github/workflows/deploy.yml`: по пушу в master и по ручному запуску он заходит на сервер, делает `git pull`, пересобирает `api` и `web` и перезапускает их, после чего проверяет доступность. **Что нужно от владельца:** добавить в репозиторий (Settings → Secrets and variables → Actions) три секрета: `SSH_HOST` = адрес сервера, `SSH_USER` = root, `SSH_KEY` = содержимое файла приватного ключа `~/.ssh/profyplan_deploy` (в чат его не пересылаем — открывается локально).

## 18. Мультитенантность: общая база + tenant_id, аудит изоляции (решено 2026-08-21, вечер)

### 18.1 Решение по масштабированию
- Модель: **Pool** (общая БД + колонка `tenant_id` на каждой таблице). Остаёмся на ней — это стандарт SaaS.
- Отдельная БД на аккаунт (Silo) НЕ нужна сейчас: одна Postgres держит тысячи активных аккаунтов и десятки миллионов записей; нагрузка ProfyPlan лёгкая (чтения + редкие записи).
- Silo/Bridge — только при enterprise-требовании физической изоляции или гигантском тенанте; тогда гибрид (большинство в общей БД, VIP — в своих).
- Вместо «базы на аккаунт» делать: железная tenant-изоляция (18.3), индексы, пул соединений (PgBouncer); при реальном росте — шардирование по tenant_id (2–3 базы на всех, не N баз).

### 18.2 Модель доступа
- JWT несёт `sub` (user_id) + `tenant_id`; `get_current_tenant_id` извлекает tenant_id; каждый тенант-скопленный роутер обязан `Depends(get_current_tenant_id)` + фильтровать ВСЕ запросы по tenant_id.
- Модели С tenant_id: Project, Resource, ProjectResource, Operation, ProductionOrder, OrderGroup, OrderPool, Nomenclature, Unit, Counterparty, WorkSchedule, ProductionCalendar, ResourceEvent, Tenant, UserTenant.
- Модели БЕЗ tenant_id (скоп через родителя): OperationDependency, OperationResource, ActualExecution, PlanBaseline, InterProjectDependency, WorkScheduleSlot, ProductionCalendarDay — для них изоляция обязана идти через родителя (Operation.tenant_id / Project.tenant_id / WorkSchedule.tenant_id).

### 18.3 Аудит изоляции (2026-08-21) — результаты
- **КРИТИЧЕСКИ (исправлено):** `actual.py` (4 эндпоинта факта) не фильтровал по tenant_id — по UUID операции можно было читать/менять чужие ActualExecution и все OperationDependency. Добавлен `get_current_tenant_id`, `_get_operation(tenant_id)`, депсы скоплены по op_ids тенанта.
- **БАГ (исправлено):** `/refresh` выпускал access-токен без tenant_id → после рефреша все тенант-эндпоинты падали в 401. Теперь refresh подтягивает tenant пользователя.
- **Defense-in-depth (сделано):** добавлены tenant_id-фильтры во все display-выборки `Resource`/`WorkSchedule` по id (bom.py развёртка, calculations.py движок, project_resources.py назначение). Теперь ни одна выборка не читает по id без привязки к тенанту.
- Известный gap (не утечка): `get_current_user`/`me` сравнивают UUID без каста (работает, стоит кастить).
- Правило для новых роутеров: любой роутер, работающий с данными тенанта, ОБЯЗАН `Depends(get_current_tenant_id)` и фильтровать ВСЕ выборки/записи по tenant_id (или через родителя с tenant_id). Lookup по ID из URL — всегда с tenant_id.

### 18.4 Выбор тенанта при входе (2026-08-21)
- `login`/`register`/`refresh` возвращают `tenants: [{id, name, role}]` — все компании пользователя.
- Новый эндпоинт `POST /v1/auth/select-tenant` (тело `{tenant_id}`): проверяет членство в UserTenant и выдаёт новый access-токен с выбранным tenant_id; чужой тенант → 403.
- Фронтенд: `api.ts` login/selectTenant (refresh + tenants в localStorage `profyplan_refresh`/`profyplan_tenants`); `page.tsx` при `tenants.length > 1` показывает экран «Выберите компанию», после выбора грузит рабочий стол.
- Смена тенанта = новый access-токен через select-tenant (refresh-токен без tenant, подтягивает tenant из UserTenant).
- Демо-аккаунт (planner@demo.ru) в одной компании → селектор не виден; задел на реальную мультитенантность (нужен flow приглашения во вторую компанию).

## 19. Единый план работ — порядок выполнения (актуален на 12.09.2026)

Весь объём незакрытых работ сведён в один документ-порядок (рабочий стол): **ProfyPlan-единый-план-работ.html**. Промт, план реализации и тест-план ведутся в согласии с ним. Правило: одна волна = один замкнутый проверяемый результат; следующая не начинается, пока текущая не прошла приёмку.

**Фазы (строго по порядку):**
0. **Подготовка и качество.** Починка локального стенда (проверки должны идти по локальной базе, а не по проду), регламент выкладки, резервные копии.
1. **Витрины на готовых данных.** Каркас настроек с наследованием (рабочий стол → проект → группа); виджеты проекта; рабочий стол (портфель); дашборд ресурса/подразделения; интерфейс отчётов загрузки подразделений и межпроектного выравнивания.
2. **Ядро: маркеры и закрепления операций.** Модель закреплений/потоков/журнала; расчёт CPM с закреплениями (жёсткие/мягкие, окна мощности, конфликты); шкала группы по ресурсам с подсветкой общих ресурсов и «призраком до/после»; магнит (якоря, радиус, шаг, приоритет, луч); постановка и снятие закрепления с применением/откатом; индикатор «свобода плана»; авто-подбор закрепления (2–3 варианта); расчёт по потокам (непрерывность ресурса, разрыв, шаг, приоритет потока); «что если» по мощности с ценой перегрузки.
3. **Пулы, CCM и межпроектные сценарии.** CCM в области «Пулы»; применение межпроектного выравнивания одним действием; учёт квот в загрузке подразделений; полировка областей (скрытие пустых «Пулов», уточнение названий).
4. **Диаграммы и оконный режим.** Гант-центр (уровень заказ/группа/пул + вид шкала/сеть/совмещённый); оконный режим расчётов (заглушка → Гант → сеть CPM → CCM-конфликты → сводка); журнал изменений плана (аудит сдвигов).
5. **Дашборд объекта и полировка.** Дашборд объекта с маркерами и состоянием закреплений; иерархия в выпадающем списке (путь «Цех / Площадка»); перетаскивание в дереве справочников.
6. **Подсказки при наведении (UI-стандарт 13.15).** Механизм и словарь текстов; настройки и реквизиты; индикаторы и KPI; результаты расчёта и предупреждения; таблицы, кнопки-иконки, статусы; объекты диаграмм (операция, маркер, магнит, «призрак», полоса мощности).
7. **Приёмка.** Ручные проверки по тест-плану после каждой волны; регулярная проверка бэкапов.

**Соответствие «Итоговой рекомендации» (проверено):** области — перевёрнуты (Заказы = дом дерева, сделано; быстрые действия из «Свободных» — 1.7); Группы = маркеры и сдвижка (фаза 2); Пулы = CCM (3.1–3.2); вариант 1 размещения — сводка в областях (1.6) плюс уже сделанная вкладка «План» в окне заказа; вариант 2 — Гант-центр (4.1); вариант 4 — окна расчётов (4.2); вариант 5 — рабочий стол-портфель (1.3); вариант 3 («расчётный хаб») осознанно не в основной линии (противоречит принципу «область задаёт метод»), делаем по потребности; альтернативы A/B/C — исследовательские, в план не берём.

**Критерий готовности волны (DoD):** реализовано и собрано → проверено на локальном стенде на реальных данных → выложено на прод и проверено → документация обновлена (промт, план, тест-план) → запись в память.

**Зависимости, которые нельзя нарушать:** расчёт с закреплениями ← модель закреплений; шкала группы ← модель и расчёт; постановка закрепления из интерфейса ← шкала и магнит; дашборд объекта и подсказки по маркерам ← фаза 2; применение выравнивания ← интерфейс пулов; починка локального стенда — первым шагом.

## 28. Итоги 16.09.2026 — выделение мышью, архив во всех справочниках, массовое удаление

**Волна:** справочники — единый механизм архива и удобное выделение строк.

**Сделано и собрано (локальный стенд):**
- **Выделение строк мышью (общая таблица справочников).** Убраны чекбоксы из строк и шапки. Обычный клик выбирает одну строку (прошлое выделение сбрасывается). Режим групповых операций включается флажком «Выбрать несколько»; панель действий рендерится первой строкой шапки таблицы («Выбрано: N · 🗄 В архив · ↩︎ Вернуть · 🗑 Удалить · Выделить всё · Снять выделение»). Shift — диапазон, Ctrl/⌘ — точечно, Esc — снять, Ctrl+A — выделить отфильтрованное; выбранная строка — подсветка + полоса слева. В окнах-выборщиках поведение прежнее (клик выбирает одну запись).
- **Архив во всех справочниках (сквозной механизм).** Единый эндпоинт `PATCH /v1/directory/bulk/state {entity, ids, is_active}` + `GET /v1/directory/archivable`. Поле `is_active` добавлено подразделениям и этапам (миграция `0034_archive_directories`). Списки справочников получили `include_archived` с фильтром по умолчанию (архив не попадает в выбор/выпадашки). Фильтр «Активные / Все / Только архивные», кнопка «🗄 / ↩︎» в строке и массовые действия — одинаково во всех справочниках.
- **Мастер массового удаления** (общая таблица): сухой прогон по каждой записи, сводка плана («Будет удалено · Перенесено · В архив · Пропущено»), решения по заблокированным — перенос ссылок (только справочник операций) / архив / пропуск.
- **Значок архива.** У архивных записей рядом с названием — красный значок «⊘» (подсказка при наведении), строка приглушена; во всех справочниках и в панели операций.
- Правила удаления предыдущей волны (проверка связей, перенос ссылок, архив как альтернатива) сохранены.

**DoD:** реализовано и собрано → проверено на локальном стенде → выложено на прод и проверено → документация обновлена (промт, план, тест-план).

**Оговорки:** Shift/Ctrl-клик и вид значка в списке с архивом подтверждаются вручную — автоинструмент не переключает системный фильтр и не отдаёт модификаторы клика.

**Дополнение 5 (17.09.2026): уровень «Кластер» доведён + реквизит «Приоритетный заказ».**
- **Уровень «Кластер» (ранее «Пул») заработал целиком.** Причина дефекта: панель настроек при чтении не передавала выбранный кластер — запись уровня уходила на сервер, а чтение собирало значения без слоя кластера и показывало «по умолчанию (система)». Теперь панель передаёт выбранный кластер и в чтении; подписи источника дополнены кластером; кнопка «сделать значениями по умолчанию» для уровня кластера переносит именно его эффективные значения; экран уровней отдаёт кластер отдельной группой.
- **Реквизит «Приоритетный заказ»** (отдельный от критического пути): собственный признак заказа + наследование по цепочке заказов. Если признак стоит у заказа-родителя, все подчинённые заказы на любой глубине тоже приоритетны; в карточке подчинённого поле заблокировано с пояснением «У заказа-родителя <код> статус приоритетного — изменение запрещено. Снять признак можно только у родителя». Снять признак можно только у того заказа, который держит его сам; при переносе заказа к другому родителю состояние пересчитывается автоматически.
- **Интерфейс реквизита:** в карточке заказа — строка «Приоритетный заказ» (свой / унаследованный от <код> / нет) и крыжик в режиме правки (заблокирован у подчинённых); в списке заказов — значок «⚑» у приоритетного заказа и «⚑⛓» у заказа с унаследованным признаком; служба отдаёт количество подчинённых, которые унаследуют признак.
- **Сводка по проекту:** `GET /v1/production-orders/priority/chain?project_id=…` — сколько заказов приоритетны фактически, у кого признак свой и сколько подчинённых он за собой тянет.
- **Попутно исправлен дефект сохранения заказа:** `PUT /v1/production-orders/{id}` применял к заказу значения по умолчанию схемы вместо присланных полей — частичное обновление (например, только реквизит или только дата) затирало приоритет, количество и единицу. Теперь применяются только явно переданные поля.
- **Якорь старта (шаг 2) сделан.** У приоритетного заказа есть жёсткая дата и время старта: она превращается в закрепление первых операций заказа, поэтому календарный расчёт обязан её соблюсти, а зависимые заказы сдвигаются. Якорь задаётся у заказа, который держит признак; подчинённые наследуют значение и менять его не могут. Каждое изменение пишется в журнал сдвигов вместе с «призраком» до/после (по заказам и по финишу проекта), есть откат к предыдущему значению. Учитываются настройки: «разрешать старт раньше предшественников» (иначе отказ), «сдвигать зависимые заказы», «хранить план до/после и журнал сдвигов».
- **Операции ищутся по телу цепочки**: если операции лежат не на самом приоритетном заказе, а на его подчинённых (типовой случай после развёртки состава), якорь ставится на первые операции всей цепочки.
- **Приоритет по общим ресурсам и окно конфликта (шаг 3) сделаны.** Конфликт — пересечение по времени операций разных заказов на одном ресурсе; считаются по календарному плану. Система показывает предложение по умолчанию и четыре действия: принять предложение (сдвинуть операцию уступающего заказа за приоритетную), сдвинуть якорь вручную, разрешить частичное переплетение, снять приоритетность. Автоматически не разрешается ничего. Правило уступки: приоритетный выше неприоритетного всегда; два приоритетных — по лестнице приоритетов, если включена конкуренция по приоритетам, иначе «кто раньше начал». Отдельно помечаются конфликты, где в окне ресурс имеет нулевую или сниженную мощность. Каждое решение пишется в журнал сдвигов с «призраком» до/после.
- **Осталось по блоку 6.5:** якорь старта с датой и временем, журнал сдвигов и откат, «призрак» до/после, приоритет по ресурсам и окно конфликта, переплетение (разрезание).

**Дополнение 4 (17.09.2026): «Кластер» и уровни настроек.**
- **Переименование «Пул» → «Кластер»** во всех пользовательских текстах (102 вхождения, 17 файлов). Технические имена (таблица, поле привязки заказа, адреса запросов) не тронуты; в модели ресурсов слово оставлено — там иной смысл. Причина: «пул» конфликтовало с «пулом ресурсов/мощностей».
- **Уровни настроек:** политика плана — проект; правила конкуренции за ресурс — кластер; группа — контейнер и точка переопределения для заказов без кластера.
- **Панель настроек:** уровень по умолчанию — «Проект», если открыто из проекта; «спрашивать про наследование приоритета» перенесено в группу «Интерфейс» (это привычка, а не политика).
- **Новые параметры:** «Где задавать политику приоритетных заказов» (проект/кластер/рабочий стол), «Целостность цепочки заказов» (цепочка входит в кластер/группу целиком; варианты жёстко/с вопросом/как раньше), «Свободный заказ — кластер из одного» (одиночный заказ получает общий граф и участвует в выравнивании).
- **Дальше:** уровень настроек «кластер» в цепочке разрешения; реквизит «Приоритетный заказ» (наследование по цепочке, блокировка поля с пояснением); применение целостности цепочки в интерфейсе при добавлении в кластер/группу.

**Дополнение 3 (16.09.2026): «Приоритетный расчёт заказа» — согласовано.**
- **Реквизит «Приоритетный заказ»** (не «критический» — чтобы не путать с критическим путём): целостность (никто не режет), вытеснение остальных, обязательный якорь старта; стоит выше любого приоритета.
- **Наследование:** если приоритетен родитель — все дочерние приоритетны; в дочернем поле заблокировано с пояснением «У заказа-родителя статус приоритетного — изменение запрещено». Снять можно только у родителя; при переносе к другому родителю признак пересчитывается.
- **«Единое тело» = защита, не монолит:** извне не режут, внутрь не влезают другие приоритетные, статус наследуется; внутри сроки живут по своим связям.
- **Настройка проекта «Использование приоритетных заказов»** (раздел настроек, крыжик + поднастройки): разрешать старт раньше предшественников; поведение при перегрузке и нулевой мощности; приоритет по общим ресурсам; разрешать прерывание; минимальный непрерывный участок; сдвигать зависимые; хранить план до/после и журнал.
- **Конкуренция приоритетных по приоритетам** (настройка): выкл. — все равны, «кто раньше начал»; вкл. — лестница приоритетов, при равенстве — кто раньше начал → номер заказа. Неизменно: приоритетные не режут друг друга, приоритетный выше неприоритетного в любом случае.
- **Окно конфликта (4 действия, первым — предложение по умолчанию):** 1) автоподсказка (сдвинуть якорь того, у кого ниже приоритет, при равенстве — позже стартующего); 2) сдвинуть якорь вручную; 3) разрешить частичное переплетение; 4) снять приоритетность с одного. Автоматически не разрешаем ничего.
- **Частичное переплетение:** ресурс делится по сменам/дням внутри окна; предохранители — минимальный участок, шаг чередования, лимит 2–3 операции на ресурс, учёт повторной переналадки, пометка на графике/в журнале; каскад новых переплетений не запускается.
- **Приоритеты заказов:** единый справочник значений и подписей (низкий · обычный · высокий · срочный), проверка на входе, живой priority только как очерёдность; наследование приоритета от родителя — через диалог при изменении у родителя.
- **Подсказки (контекстные) обязательны** для каждого нового поля, крыжика и настройки.

**Дополнение 2 (16.09.2026):** перед фазой 2 закрываем CPM и Гант. Блокер устранён: эндпоинт `/v1/projects/{id}/calculate/cpm` падал с 500 (в коде использовалась неопределённая переменная `body`) — теперь возвращает расчёт (45 операций, критических 15). Осталось по корректности: обработка зависимостей FF/SF в движке CPM (сейчас все 151 связь — FS, поэтому не проявлялось), критический путь как упорядоченный путь, согласование календарного Ганта и сетевого CPM.

**Дополнение (16.09.2026):** единая шапка MDI-окон. Все типы окон (список, справочник, окно-выборщик, календарь ресурса, графики работы, производственные календари, добавить/изменить запись справочника, добавить операцию в маршрут, новый заказ, операция справочника) используют один общий компонент шапки: «Свернуть · Развернуть/Восстановить · Раскладка окон (Snap) · Закрыть». Ранее часть окон рисовала свою шапку без «Раскладки окон», а окно «Операция справочника» не имело рамы вообще. Копий шапки больше нет — новый тип окна получает набор кнопок автоматически.
