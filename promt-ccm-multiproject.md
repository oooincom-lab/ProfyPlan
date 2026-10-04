# ProfyPlan CCM — Спецификация архитектуры (План + Динамика)

> Версия: 2.2 | Дата: 2026-09-26 | Статус: реализовано (CPM Lite + Resource Leveling — Serial SGS + Справочники + Рабочий стол; Heavy CCM — merge, resource-leveling и календари), проектируется/не завершено (полный BOM→CPM, снабжение, batch, ERP-интеграция, APS/CP-SAT). Единая шкала статусов — раздел 33.
> Примечание: шапка обновлена 26.09.2026 (была «Версия: 2.1 | Дата: 2026-08-08 | Статус: реализовано (CPM Lite + Resource Leveling + Справочники + Рабочий стол), проектируется (Heavy CCM)») — прежняя редакция не отражала решения 11.09–26.09.2026 и ревизию статусов §33 (дефект C3 реестра сверки).

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

> **Дефект исправлен 26.09.2026 (объединение дубля).** Здесь ошибочно повторялся заголовок «## 3. Состояния узлов (4 базовых + 1 специальное)» — тот же заголовок идёт ниже, с таблицей состояний (дефект C1 реестра сверки). Повторный заголовок снят; раздел «3. Состояния узлов» остаётся один — ниже. Справочники 2.17–2.19 относятся к разделу 2 «Модель данных».

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

> **Сверка с кодом (27.09.2026).** Ниже — проектные эндпоинты; фактически в коде есть: BOM и маршруты (`/v1/bom`), заказы и разворот состава (`/v1/production-orders`, в т.ч. `/expand`), выгрузка для внешних систем (`export/mrp` в `bom.py`), анализ узких мест (`ccm.py`, `services/bottleneck.py`), этапы проекта (`project_stages.py`), подразделения и квоты (`departments.py`, `department_quotas.py`), группы (`planning_pins.py`), перемещение заказов (`/move` в `order_groups.py`). **Не реализовано:** пути `/v1/specifications…`, `detect-batches`, `apply-batch`, `detect-common-procurement`, `export/excel`, `webhooks/erp`. Пометку «проектируется» в заголовках §12.4–§12.10 читать по этой сверке; для сравнения, §12.11 и ниже уже помечены как реализованные.

### 12.4 ProductStructure + Routing (частично реализовано — сверено с кодом 27.09.2026)
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

### 12.5 Procurement / Batch (проектируется — в коде нет)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/ccm/detect-batches` | Найти кандидаты на объединение |
| POST | `/v1/ccm/apply-batch` | Применить объединение |
| POST | `/v1/ccm/detect-common-procurement` | Сводные закупки |

### 12.6 Export (частично: выгрузка для ERP есть, Excel и webhook — нет)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/projects/{id}/export/mrp` | JSON для ERP |
| GET  | `/v1/projects/{id}/export/excel` | Excel для человека |
| POST | `/v1/webhooks/erp` | Настроить webhook для push |

### 12.7 Bottleneck (реализовано)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/ccm/projects/{id}/bottlenecks` | Анализ узких мест |

### 12.8 Phases (реализовано как «этапы проекта»)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/projects/{id}/phases` | Список этапов проекта |
| POST | `/v1/projects/{id}/phases` | Создать этап |
| PUT  | `/v1/projects/{id}/phases/{phase_id}` | Обновить этап |
| DELETE | `/v1/projects/{id}/phases/{phase_id}` | Удалить этап |

### 12.9 Departments (реализовано)
| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/v1/departments` | Список подразделений |
| POST | `/v1/departments` | Создать подразделение |
| PUT  | `/v1/departments/{id}` | Обновить подразделение |
| GET  | `/v1/departments/{id}/load` | Загрузка подразделения |
| GET  | `/v1/departments/{id}/resources` | Ресурсы подразделения |

### 12.10 Order Groups + Order Pools (частично реализовано)
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

**Сквозное требование (Дополнение 10).** Контекстная справка — обязательный элемент интерфейса: у каждого элемента (крыжик, переключатель, поле, пресет, кнопка, значок, маркер на графике) она отвечает на четыре вопроса — что делает, на что влияет, значение по умолчанию, как вернуть как было; тексты хранятся централизованно. Подробно — «Дополнение 10. Сквозные требования к графикам: условное форматирование и контекстная справка» (раздел 31).

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

> **Шкала устарела (25.09.2026).** Пометки / (и проценты готовности) в этом разделе — старая бинарная шкала «сделано в коде». Она отменена разделом 33 «Определение готовности: ступени и единая шкала статусов» и больше не применяется. Список сохранён как исторический срез на 2026-08-17; актуальные статусы ведутся только по шкале §33: **«Выложено на прод, проверено» · «Готово локально, проверено» · «Готово частично» · «В работе» · «Не начато» · «Отложено»** (дефект C5 реестра сверки).

### Level 0 — Ядро (завершено)
- CPM-движок (Forward/Backward Pass)
- CRUD проектов, операций, зависимостей
- Auth JWT

### Level 1 — CCM Foundation (завершено)
- Multi-project merge
- Baseline-версионирование
- Auto-close chain
- Resource CRUD + Resource-leveling (SGS)
- Resource calendars
- BOM-импорт + дерево + развёртка (упрощённая)

### Level 2 — Excel Import + Directory UI + CPM Frontend (частично)
1. **Справочники (Directory UI)** — Nomenclature + Units + DirectoryTable + DirectoryPicker + DataImport
2. **Группы и Пулы** — модель OrderGroup + OrderPool, API, drag-and-drop на временной шкале
3. **Рабочий стол** — тёмный дашборд, сайдбар с 9 разделами, мастер проекта, контекстное меню, заказы в дереве
4. **Excel-импорт (7-вкладочный)** — замыкает контур «данные → расчёт → визуализация»
5. **CPM React Flow** — миграция с iframe на живой граф
6. **Ганта** — базовая диаграмма (read-only)
7. **Ручной ввод с вкладками** — Заказы | Номенклатура | Ресурсы | Операции
8. **Сопоставление с номенклатурой при вставке из буфера** (fuzzy match по имени)
9. **Drag-and-drop заказов**
10. **Этапы (Phases)** — модель, API, учёт в CPM (под флагом `uses_phases`)
11. **Подразделения (Departments)** — модель, API, учёт в resource-leveling
12. **E2E-тест на VPS** — прогнать реальные данные через импорт → CPM → CCM → resource-leveling

### Level 3 — Heavy CCM
1. **ProductStructure + Routing модели** — полная реализация
2. **BOM→CPM развёртка** — с yield_rate, фантомами, вариантными маршрутами
3. **ext_id на всех сущностях** — мост к ERP
4. **JSON-экспорт MRP** — эндпоинт для ERP
5. **Снабжение** — procurement-операции, календари поставщиков, сводные закупки

### Level 4 — APS Engine
1. **Batch scheduling** — группировка одинаковых деталей
2. **Bottleneck-анализ** — выявление узких мест
3. **Push дельты в ERP** — webhook при пересчёте
4. **Milestones** — контрольные точки на графике

### Level 5 — PERT + Риски
1. PERT-оценки (O, ML, P)
2. Монте-Карло симуляция
3. Доверительные интервалы, S-кривые

### Level 6 — Excel-экспорт + Интеграции
1. Экспорт Ганта / ресурсной ведомости / CPM-таблицы в Excel
2. Google Sheets автосинхронизация
3. CI/CD пайплайн



**Пометки сняты 27.09.2026.** Значки «сделано / нет» выше убраны: они не являются статусами. Актуальные статусы — только в плане реализации (блоки 6.x и фазы 0–9), определение готовности — раздел 33.

| Уровень | Где смотреть фактический статус |
|---|---|
| Level 0–1 (ядро, CPM, CCM-основа) | Фазы 0–2 плана; блок 6.4 (CPM в кусте) |
| Level 2 (справочники, окна, граф, Гант) | Блоки 6.1–6.11 плана |
| Level 3 (Heavy CCM, снабжение, ERP-мост) | Продуктовый задел (решения PO-05, PO-20); блоки 6.16–6.25 |
| Level 4 (APS: batch, узкие места, milestones) | Продуктовый задел (решение PO-20) |
| Level 5 (PERT, Монте-Карло) | Блоки 6.17–6.19 плана |
| Level 6 (выгрузки, интеграции, выкладка) | Блок 6.22 и решения PO-04, PO-19 плана |

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

> **Примечание 30.09.2026.** Маркеры свободны от маршрута; вводятся маршрутные версии (базовый / маркерный) и тип связи «начать после завершения операции X» — см. Дополнение 20 (раздел 43).

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

### 17.14а Planning Settings — настройки планирования с наследованием (реализовано ✅) — НОВОЕ
> *Нумерация исправлена 26.09.2026 (была «12.21»): раздел 12 — это список API-эндпоинтов (12.1–12.20); пункт физически стоит в разделе 17 и повторяет 17.14, поэтому получил номер 17.14а. Содержание не переносилось.*
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

### 17.15а Pins / Flows / Shift Log — закрепления, потоки, журнал (реализовано ✅) — НОВОЕ
> *Нумерация исправлена 26.09.2026 (была «12.22»): раздел 12 — список API-эндпоинтов (12.1–12.20); пункт стоит в разделе 17 и повторяет 17.15, поэтому получил номер 17.15а. Содержание не переносилось.*
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

**Сквозное требование к оформлению графиков (Дополнение 10).** Для любого графика, дашборда, индикатора и панели обязательны правила условного форматирования: возможные состояния, пороги, цвет и значок, место показа — задаются в одном месте и применяются одинаково во всех местах показа; каждое цветовое состояние имеет объяснение (почему помечено и на основании какого расчёта), цвет без объяснения — дефект. Подробно — «Дополнение 10. Сквозные требования к графикам» (раздел 31).

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

> **Уточнение (26.09.2026).** Перечень выше — срез на 12.09.2026. После этого сетевой график CPM был переработан **локально** (блок 6.11 плана) и на прод **не выкладывался**; действующая граница выкладки — `origin/master` = `356b9d1` (17.09.2026), см. раздел 33. Поэтому текущий статус 8.2 — **«Готово локально, проверено»**, а не «выложено» (дефект C8 реестра сверки). Выкладку остальных пунктов перечня (8.1, 8.3, 8.6) в редакции на 12.09.2026 по репозиторию подтвердить нельзя — требует проверки на прод-сервере.

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
11. **CI/CD работает (проверено 13.09.2026).** Владелец добавил секреты `SSH_HOST`, `SSH_USER`, `SSH_KEY`. Workflow `.github/workflows/deploy.yml` по пушу в master (и по кнопке «Run workflow») заходит на сервер, приводит его к `origin/master` (fetch + reset --hard — сервер своей истории не ведёт), пересобирает `api` и `web`, перезапускает и проверяет доступность. **Правило деплоя: правки отправляются пушем в master, патчи по SSH больше не используются.** Владельцу отправлено пояснение (автоматическая сборка и выкладка по пушу; нужны секреты репозитория: адрес сервера, пользователь, SSH-ключ). *«Пока деплой ручной» — устаревшая формулировка; снята 26.09.2026: по содержимому репозитория выкладка автоматическая (см. уточнение ниже).*

   > **Уточнение по CI/CD (26.09.2026, проверено по репозиторию, папка `.github/workflows`).** Противоречие «работает автоматически / деплой ручной» снято: выкладка **автоматическая по пушу в `master`** (плюс возможен ручной запуск кнопкой «Run workflow»). На 26.09.2026 в репозитории было три workflow:
   > - **`deploy.yml`** — рабочий канал выкладки: триггеры — пуш в **`master`** и ручной запуск; SSH на сервер, `git fetch origin master` + `git reset --hard origin/master`, пересборка `api` и `web`, `alembic upgrade head`, проверка доступности. Секреты `SSH_HOST`/`SSH_USER`/`SSH_KEY`.
   > - **`ci.yml`** — рабочий канал проверок: пуш и PR в **`master`**; тесты бэкенда и фронтенд-проверки (`tsc --noEmit`, lint).
   > - **`ci-cd.yml`** — настроен на ветку **`main`, которой в репозитории нет** (рабочая ветка — `master`): сборка и публикация образов в GHCR, деплой через `appleboy/ssh-action` с секретами `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`. Фактически не запускается и с `deploy.yml` конфликтует. **Пометка 27.09.2026:** сценарий под несуществующую ветку `main` **удалён из репозитория 27.09.2026** (коммит `254f23c`, 95 строк); копия сохранена в архив (`ProfyPlan-архив-документов\архив-2026-09-26\ci-cd.yml`). После удаления в `.github/workflows` остаются два сценария: `deploy.yml` (рабочая выкладка) и `ci.yml` (проверки).
   > **Решение владельца (27.09.2026):** `ci-cd.yml` — удалить (ветки `main` в репозитории нет: `git ls-remote --heads origin` → только `master`); копия — в архиве; **удаление выполнено 27.09.2026, коммит `254f23c`**. Автовыкладка срабатывает только при пуше в `origin/master`; на 26.09.2026 локальная ветка впереди `origin/master` (граница выкладки — `356b9d1`, 17.09.2026), поэтому новейшие локальные работы на прод не попадали (дефекты C11 и R15 реестра сверки).
   >
   > **Дополнение (27.09.2026): защита от «502 после пересоздания контейнеров».** Причина сбоя: прокси разрешал имена `web` и `api` один раз при запуске и держал их в памяти; пересоздание контейнеров меняло их внутренние адреса, а прокси продолжал ходить по старым — и всё проксируемое отдавало 502. Внесены две защиты. **(А) Порядок выкладки:** `deploy.yml` после `docker compose up -d --force-recreate api web` перезапускает прокси (`docker compose restart nginx`) и проверяет результат **снаружи по публичному адресу** (`/`, `/workspace`, `/api/v1/health`), а не изнутри сервера. **(Б) Настройки прокси:** `nginx/nginx.conf` использует внутренний DNS Docker (`resolver 127.0.0.11 valid=10s`) и переменную в `proxy_pass` для `web` и `api`, поэтому имена переразрешаются, а не держатся вечно; обработка путей с завершающим слешем (`/api/` для сервиса расчётов) сохранена. Порядок выкладки в `readme.md` дополнен перезапуском прокси и внешней проверкой.

12. **Интеграции — в настройках проекта.** Загрузка и выгрузка (в том числе Google Sheets) настраиваются пользователем в разделе «Интеграции» настроек проекта: модуль подключения, проверка связи, сохранение параметров для текущего проекта. Секреты хранятся по проекту и не показываются в открытом виде.

## 27. Решения 13.09.2026 (вторая часть)

1. **Буфер куста — агрегированный буфер критической цепи.** Коэффициент буфера выносится в настройки: параметр «Буфер куста, % от суммы резервов операций», значение по умолчанию 50 %. Описание в настройке: «Какую часть резервов операций куста переводим в общий защитный буфер в конце куста. Больше значение — срок устойчивее к задержкам, но общий срок длиннее. 0 — буфер не создаётся, резервы остаются в операциях». В интерфейсе — полоса буфера в конце куста и индикатор «съедено N %».
2. **Подписи окон проектом — обязательны** и уже соблюдены: окна и виды показывают проект в заголовке (например, «Заказы — Полигон A — Мосты (тест)»). Переключение контекста проверено: при выборе другого проекта список заказов перестраивается на него (раньше это казалось дефектом из-за ошибки в автоматическом клике).
3. **Оттенок проекта — одобрено владельцем, реализуется в фазе 3** (вместе с подписями окон и полировкой областей). Каждому проекту присваивается собственный оттенок из фиксированной палитры (6–8 значений в общей гамме, с автоназначением при создании и возможностью сменить). Оттенок применяется к элементам идентичности: строка проекта в дереве, заголовок окна, чип проекта в шапке, тонкая полоса-акцент у панелей; не применяется к элементам со смыслом (критичность, потери, события, конфликты) — иначе смысловые цвета будут конфликтовать. Требование: контраст текста сохраняется, отличия — в пределах 10–15 % насыщенности, чтобы не пестрило.
4. **CI/CD — автоматическая сборка и выкладка.** Создан ключ деплоя (`~/.ssh/profyplan_deploy`), публичная часть добавлена в `authorized_keys` на сервере. Добавлен workflow `.github/workflows/deploy.yml`: по пушу в master и по ручному запуску он заходит на сервер, делает `git pull`, пересобирает `api` и `web` и перезапускает их, после чего проверяет доступность. **Что нужно от владельца:** добавить в репозиторий (Settings → Secrets and variables → Actions) три секрета: `SSH_HOST` = адрес сервера, `SSH_USER` = root, `SSH_KEY` = содержимое файла приватного ключа `~/.ssh/profyplan_deploy` (в чат его не пересылаем — открывается локально).

> *Уточнение 26.09.2026: секреты добавлены (см. §26.11); по содержимому репозитория выкладка автоматическая по пушу в `master`. Второй workflow `ci-cd.yml` (ветка `main`) фактически мёртв и конфликтует с `deploy.yml` — **решение владельца 27.09.2026: сценарий удалён, копия в архиве** (ветки `main` в репозитории нет; удаление выполнено 27.09.2026, коммит `254f23c`); подробности в уточнении §26.11.*

## 18. Мультитенантность: общая база + tenant_id, аудит изоляции (решено 2026-08-21, вечер)

> *Место в структуре (пометка 26.09.2026). Раздел физически расположен ниже, после §27 (исторический порядок вставки); по нумерации он следует сразу после §17. Содержание не переносилось, номер не менялся (дефект C2 реестра сверки).*

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

> *Место в структуре (пометка 26.09.2026). Раздел физически расположен ниже, после §27; по нумерации следует после §18. Содержание не переносилось, номер не менялся (дефект C2 реестра сверки). Снимок «актуален на 12.09.2026» описывает волны 0–7 и не обновлялся; текущее планирование — в плане реализации v3.4 (фазы 0–9, блоки 6.x).*

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

**Дополнение 7 (23.09.2026): сетевой график — связи, события и подписи.**
- **Тумблер «Показывать логические связи» удалён как опасный.** Он позволял спрятать связи без ожидания и вместе с ними — критический путь, поэтому снят. Вместо него тумблер «Старт и Финиш»: он прячет ТОЛЬКО служебные события «Старт»/«Финиш», их тонкие пунктирные связи и маркеры обрезки периода. Обычные связи не скрываются никогда.
- **Критический путь рисуется всегда** — независимо от тумблеров и фильтров.
- **Связь без ожидания — широкий штрих-пунктир** (длинный штрих + точка), спокойный стальной цвет; скрыть её нельзя.
- **Число на связи ставится только при ожидании больше нуля**; ноль на связи не подписывается.
- **Подписи всегда при своём узле.** Имя работы — над узлом, «продолжительность + резерв» — под узлом; подпись не «гуляет» по полотну. Наложения снимаются вертикальным сдвигом САМОГО узла вместе с подписями (фиксированный порядок обхода и шаг — результат воспроизводим).
- **Служебные события считаются по видимой части графа.** «Старт» ставится у истинных начал видимого набора, «Финиш» — у истинных завершений; если цепочка продолжается вне периода, вместо значка ставится маркер обрезки «Продолжение вне периода».
- **Укладка «Без пересечений» — честная.** Сообщение о нуле пересечений выводится ТОЛЬКО если ноль подтверждён на итоговой геометрии — той, что рисуется, со всеми связями (операционными и служебными, вместе с маркерами обрезки). Счётчик «пересечения связей» считает лишь операционные связи и по укладкам, поэтому рядом с ним добавлено отдельное число «пересечения линий на схеме» (как рисуется). Если ноль невозможен (непланарный граф) или не подтверждён на итоговой геометрии — в сообщении фактическое число пересечений и пояснение, что именно пересекается.
- **Режим «Без пересечений» не может быть хуже «Обычно».** Перебор стартов «по связям» включается только когда ноль достижим (подграф планарный); на непланарном графе режим использует ту же оптимизацию, что и «Обычно». Разведение подписей выполняется до финальной доводки порядка по счётчику пересечений, поэтому достигнутый результат не пересобирается вертикальным сдвигом узлов.
- **Зафиксированного эталона замеров пока нет.** Числа снимаются заново на зафиксированном коммите; «эталон замеров» в плане — задача, а не факт.
- **Правила качества сетевого графика (26.09.2026).** Структурные проверки графа, коэффициент напряжённости K и стилизация связей и критического пути сведены в «Дополнение 12. Сетевой график: правила качества» (раздел 35).

**Дополнение 6 (21.09.2026): сетевой график — раскладка, качество, режимы.**
- **Две укладки.** У сети CPM две раскладки: хронологическая «По датам» (время работ зафиксировано шкалой) и структурная «По связям» (порядок узлов подбирается по связям, время не держит). Ноль пересечений обещаем только в структурной укладке и только для планарных графов; в хронологической пересечения неизбежны, и их число — минимум при фиксированном времени, а не дефект раскладки.
- **Счётчик качества — один показатель читаемости.** Четыре числа (пересечения, проходы связей сквозь узлы, наложения узлов, плотность) сведены в один показатель читаемости (0…100 %), детали скрыты под значком «i». Отдельная плашка с четырьмя числами убрана — она мешала замыслу «одной строки».
- **Вердикт о планарности — честный.** Слово «минимум» убрано: число пересечений зависит от укладки, поэтому показываем их раздельно — «по датам: … · по слоям: …». Утверждение «граф планарный» выводится только при настоящей проверке планарности; пока её нет — планарность не утверждаем вовсе и ограничиваемся фактическими числами.
- **Внутренние настройки убраны из интерфейса.** Веса критерия (пересечение / проход / наложение), цели по пересечениям и проходам, число проходов оптимизации и порог напряжённости K больше не настраиваются пользователем — это внутренние значения; в интерфейсе остаётся одна настройка раскладки.
- **Правило «режим против фильтра».** Новым режимом считается только то, что отвечает на отдельный вопрос (как «По датам» / «По связям»). Если переключатель не меняет вопрос, а лишь уточняет отбор или вид — это настройка или фильтр, а не режим.
- **Формулировки не обещают невозможного.** Текст в интерфейсе говорит только то, что достижимо в выбранной укладке.
- **Полный граф проекта — непланарный.** На «Полигоне A — Мосты (тест)» сеть 70 операций / 79 связей: необходимое условие Эйлера выполнено (79 ≤ 3·70 − 6 = 204), но укладку без пересечений построить не удалось — граф непланарный. Ноль пересечений недостижим, поэтому работает минимизация; панель выводит вердикт «граф непланарный — ноль пересечений невозможен, достигнутый минимум N».
- **Подграф критического пути — планарный.** Фильтр «только крит. путь» (11 операций / 10 связей) укладывается без пересечений: ноль достижим, вердикт — «планарность подтверждена построением — ноль пересечений достижим в структурной укладке». Ноль пересечений на этом подграфе получен в обеих укладках.
- **Проверка планарности — построением, по нескольким стартам.** Проверка строит укладку без пересечений (метод добавления путей с обходом по граням, Демукрон–Мальгранж–Пертуизе) и контролирует формулу Эйлера; укладка пробуется от нескольких начальных рёбер. Исходы: «планарность подтверждена построением» / «граф непланарный» / «не подтверждена» (защитная ветка — метод не дал ответ). Проверка сверена с эталоном (networkx): ложных срабатываний «планарный» для непланарных графов нет.
- **Ноль пересечений обещаем только для планарных подграфов.** В хронологической укладке «По датам» пересечения неизбежны (время зафиксировано шкалой), в структурной «По связям» порядок подбирается; ноль достижим в структурной и только когда граф планарный. Для непланарного показываем достигнутый минимум, а не обещание нуля.
- **Ноль достигается перебором стартов.** Для планарного подграфа раскладка считается из нескольких детерминированных стартов и берётся лучший по счётчику панели — так укладка выходит из локального минимума одного старта. Проверено: критический путь — 0, простые заказы — 0 (в т.ч. реальный заказ «Полигон B“ — 45 операций / 41 связь). Для непланарного графа старт один (ноль недостижим), поэтому цена перебора не растёт.
- **Числа тестового стенда (подтверждение).** Простой планарный граф: 5 → 0 пересечений. Плотный граф: 211 → 26 (ноль невозможен, работает минимизация). K3,3: 9 → 9 (непланарный — ноль невозможен).
- **Уточнение к пункту «Вердикт о планарности — честный» (см. выше).** Проверка планарности теперь реализована, поэтому формулировка «пока её нет — планарность не утверждаем» снята: панель выводит вердикт по результату построения укладки.

**Дополнение 5 (17.09.2026): уровень «Кластер» доведён + реквизит «Приоритетный заказ».**
- **Уровень «Кластер» (ранее «Пул») заработал целиком.** Причина дефекта: панель настроек при чтении не передавала выбранный кластер — запись уровня уходила на сервер, а чтение собирало значения без слоя кластера и показывало «по умолчанию (система)». Теперь панель передаёт выбранный кластер и в чтении; подписи источника дополнены кластером; кнопка «сделать значениями по умолчанию» для уровня кластера переносит именно его эффективные значения; экран уровней отдаёт кластер отдельной группой.
- **Реквизит «Приоритетный заказ»** (отдельный от критического пути): собственный признак заказа + наследование по цепочке заказов. Если признак стоит у заказа-родителя, все подчинённые заказы на любой глубине тоже приоритетны; в карточке подчинённого поле заблокировано с пояснением «У заказа-родителя <код> статус приоритетного — изменение запрещено. Снять признак можно только у родителя». Снять признак можно только у того заказа, который держит его сам; при переносе заказа к другому родителю состояние пересчитывается автоматически.
- **Интерфейс реквизита:** в карточке заказа — строка «Приоритетный заказ» (свой / унаследованный от <код> / нет) и крыжик в режиме правки (заблокирован у подчинённых); в списке заказов — значок «⚑» у приоритетного заказа и «⚑⛓» у заказа с унаследованным признаком; служба отдаёт количество подчинённых, которые унаследуют признак.
- **Сводка по проекту:** `GET /v1/production-orders/priority/chain?project_id=…` — сколько заказов приоритетны фактически, у кого признак свой и сколько подчинённых он за собой тянет.
- **Попутно исправлен дефект сохранения заказа:** `PUT /v1/production-orders/{id}` применял к заказу значения по умолчанию схемы вместо присланных полей — частичное обновление (например, только реквизит или только дата) затирало приоритет, количество и единицу. Теперь применяются только явно переданные поля.
- **Якорь старта (шаг 2) сделан.** У приоритетного заказа есть жёсткая дата и время старта: она превращается в закрепление первых операций заказа, поэтому календарный расчёт обязан её соблюсти, а зависимые заказы сдвигаются. Якорь задаётся у заказа, который держит признак; подчинённые наследуют значение и менять его не могут. Каждое изменение пишется в журнал сдвигов вместе с «призраком» до/после (по заказам и по финишу проекта), есть откат к предыдущему значению. Учитываются настройки: «разрешать старт раньше предшественников» (иначе отказ), «сдвигать зависимые заказы», «хранить план до/после и журнал сдвигов».
- **Операции ищутся по телу цепочки**: если операции лежат не на самом приоритетном заказе, а на его подчинённых (типовой случай после развёртки состава), якорь ставится на первые операции всей цепочки.
- **Приоритет по общим ресурсам и окно конфликта (шаг 3) сделаны.** Конфликт — пересечение по времени операций разных заказов на одном ресурсе; считаются по календарному плану. Система показывает предложение по умолчанию и четыре действия: принять предложение (сдвинуть операцию уступающего заказа за приоритетную), сдвинуть якорь вручную, разрешить частичное переплетение, снять приоритетность. Автоматически не разрешается ничего. Правило уступки: приоритетный выше неприоритетного всегда; два приоритетных — по лестнице приоритетов, если включена конкуренция по приоритетам, иначе «кто раньше начал». Отдельно помечаются конфликты, где в окне ресурс имеет нулевую или сниженную мощность. Каждое решение пишется в журнал сдвигов с «призраком» до/после.
- **Частичное переплетение (шаг 4) сделано.** Внутри окна пересечения ресурс делится по сменам: операции чередуются участками, первым идёт приоритетный заказ. Предохранители: минимальный непрерывный участок, шаг чередования, лимит прерываний на операцию, лимит участников на ресурсе (2–3), учёт повторной наладки при каждом возврате к чужой операции. Если шаг меньше минимального участка или переплетение выключено настройкой — отказ с понятным объяснением. План участков сохраняется в журнале сдвигов и показывается в карточке заказа; каскад не запускается — остальные конфликты остаются нерешёнными.
- **Блок 6.4 (CPM и Гант) добит 17.09.2026.** Зависимости FF и SF считались неверно: в прямом проходе для них не вычиталась длительность последователя, а в обратном — прибавлялась длительность последователя вместо предшественника, из-за чего поздние сроки и резервы разъезжались. Свободный резерв теперь считается по типу связи, а не как «раннее начало последователя». Критический путь стал путём: узлы с нулевым резервом связываются только «плотными» связями и выстраиваются в упорядоченные цепочки, ветвей может быть несколько (`critical_paths`), а `critical_path` держит самую длинную. Числа сверены на живом проекте: 70 операций, 3968,6 ч, 11 критических, ранние старты вдоль пути не убывают. Соотношение CPM и Ганта зафиксировано и проверено: часы сети делятся на рабочий день — 3968,6 ÷ 8 = 496,1 дн, что совпадает с длительностью проекта на диаграмме.
- **Хвосты приоритетного расчёта закрыты 17.09.2026.** В окне якоря теперь проверяются занятость общих ресурсов и нулевая или сниженная мощность: настройки «при перегрузке» и «при нулевой мощности» решают — предупредить или запретить постановку якоря (при запрете ответ с причиной и перечнем занятых ресурсов). На диаграмме Ганта появилась метка якоря у заказов с жёстким стартом и блок «Переплетение на общих ресурсах»: последняя согласованная раскладка участков с окном, числом участков и переключений, наладкой и предупреждениями. Раскладка показывается, но длительность операции не режется — движок считает операцию целым блоком; это осознанная граница, а не недоделка отображения. Попутно исправлено: страница диаграммы не подгружала список заказов, из-за чего цепочки заказов на ней не отображались.
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

**Дополнение 1 (16.09.2026):** единая шапка MDI-окон. Все типы окон (список, справочник, окно-выборщик, календарь ресурса, графики работы, производственные календари, добавить/изменить запись справочника, добавить операцию в маршрут, новый заказ, операция справочника) используют один общий компонент шапки: «Свернуть · Развернуть/Восстановить · Раскладка окон (Snap) · Закрыть». Ранее часть окон рисовала свою шапку без «Раскладки окон», а окно «Операция справочника» не имело рамы вообще. Копий шапки больше нет — новый тип окна получает набор кнопок автоматически. *(Номер «Дополнение 1» восстановлен 26.09.2026: сквозная нумерация дополнений — 1–7 в разделе 28, 8–12 в разделах 29–35; ранее этот пункт шёл без номера, «Дополнения 1» не существовало — дефект C12 реестра сверки.)*

## 29. Дополнение 8. Сохранённые виды и реестр сохранений (25.09.2026)

**Суть.** Сохранённый вид — именованное сохранение состояния представления рабочего поля (сетевой график CPM, Гант, пулы, общие настройки вида). Пользователь собирает удобный ему вид, даёт ему имя и позже возвращается к нему одним действием вместо ручной перенастройки раскладки, фильтров, периода и ручных позиций узлов.

**1. Личный вид.** Личный вид — именованное сохранение состояния представления. Состав сохранения — тот же конверт настроек, что и у будущего профиля проекта:
- разделы по видам: «сетевой график», «Гант», «пулы», «общее»;
- версия схемы конверта (нужна, чтобы развивать состав без поломки старых записей);
- ручные позиции узлов: идентификатор операции → координаты + подпись раскладки (в какой укладке позиция задана — «по датам» или «по слоям»).

Метаданные вида: имя, автор, дата создания, дата изменения. Конверт — единый формат для личного вида и для будущего профиля проекта: вид — поименованный снимок состояния, профиль проекта — набор значений по умолчанию; механизм хранения и разбора у них общий.

**2. Лимит числа сохранений.** Лимит задаётся в общих настройках (значение по умолчанию — 10) и переопределяется на проект, группу и пул тем же механизмом наследования, что и остальные параметры планирования: параметр `views.saved_limit`, цепочка «система → рабочий стол → проект → группа → пул». При достижении лимита сохранение блокируется с понятным сообщением: сколько сохранений сейчас, каков лимит и откуда он взят, что делать дальше — удалить лишний вид или выгрузить его в файл. Молчаливая перезапись запрещена: ни чужой, ни собственный существующий вид не перезаписывается без явного действия.

**3. Общий вид — только один на пользователя.** Пользователь может сделать общим ровно один свой вид (в рамках проекта). Общий вид появляется в списке общих видов проекта и доступен всем его участникам. Попытка сделать общим второй вид — отказ с пояснением: сначала надо вернуть в личные предыдущий.

**4. Статус общего вида.** Два статуса общего вида:
- **«чтение»** — остальные участники видят и применяют вид, но сохранять в него не могут;
- **«изменение»** — остальные участники могут и применять, и сохранять в него; при этом ведётся журнал изменений (кто и когда менял).

В обоих статусах любому участнику доступно «Сохранить как свой» — от общего вида ответвляется личная копия. Владелец может вернуть вид в личные и сменить статус в любой момент.

**5. Реестр сохранений.** Единый список видов проекта: имя, автор, статус (личный / общий — чтение / общий — изменение), текущий лимит и занятое место. Операции реестра: сохранить, применить, переименовать, сменить статус и доступ, удалить (с подтверждением), экспорт в файл, импорт из файла.

**6. Экспорт и импорт.** Файл — JSON с версией схемы. Экспорт одного вида или всех доступных сразу. Импорт добавляет вид в список; при совпадении имени предлагается переименовать (подставляется «имя (копия)», решение остаётся за пользователем — молчаливой перезаписи нет). Импортированные виды подчиняются тому же лимиту, что и созданные вручную.

**7. Хранение.** Серверная таблица с привязкой к арендатору, проекту и пользователю; содержимое вида — JSON-конверт. В браузере хранится только кэш (последний применённый вид и его конверт); источник истины — сервер. Журнал изменений общего вида хранится рядом с видами (кто, когда, что сделал).

**Границы этапа.** Первый этап — только серверная часть: хранение, API и чтение лимита из общих настроек. Интерфейс (реестр видов, панель сохранения и применения) — следующий этап и опирается на уже готовые адреса API.

**Состояние (25.09.2026).** Серверная часть сделана и проверена на локальном стенде. Хранение — таблицы `saved_views` и `saved_view_logs` (миграция 0037), данные существующих таблиц не тронуты. API `/v1/saved-views`: список, создание, сохранение, получение, переименование, шаринг и смена статуса, удаление с подтверждением, «Сохранить как свой», экспорт, импорт и журнал изменений. Лимит — параметр `views.saved_limit` (по умолчанию 10) в общих настройках с наследованием (система → рабочий стол → проект → группа → пул). Тесты серверной части (6 штук, все проходят): создание вида, упор в лимит, шаринг — не более одного общего вида на пользователя, доступ на чтение и на изменение с журналом, экспорт и затем импорт — содержимое совпадает. Открытие интерфейса реестра видов — следующий этап.

## 30. Дополнение 9. Режим цели (25.09.2026)

**Суть.** Цель — назначенная дата, по которой видно, ведёт ли расчёт к ней. Вводится «режим цели»: три даты, сигналы по разрыву в днях и отдельные места, где у каждого сигнала видно основание. Цель НЕ влияет на расчёт и не переписывает прогноз — она задаёт ориентир и сигнал. Пересчёт «от цели» (обратное планирование) — отдельный явный режим со своим предупреждением, отложенный на потом.

**1. Три даты.**
- **Рабочая дата** — назначенная внутренняя цель: **вход**, задаёт планировщик, меняется свободно.
- **Договорная дата** — обязательство перед заказчиком: **вход**, меняется только под запись с причиной.
- **Оперативная дата** — расчётный результат по фактическому производству и текущему состоянию ресурсов: **выход**, пересчитывается на каждом расчёте.

**2. Оперативная дата считается всегда.** Оперативная дата вычисляется ВСЕГДА, независимо от того, раньше она рабочей или позже. Пустого значения быть не должно ни в интерфейсе, ни в отчётах: пустое поле читается как «не считалось» и уже приводило к дефектам. Опережение — это отдельный сигнал, а не условие существования даты.

**3. Основание каждой цифры.** В любом отчёте и показателе рядом с оперативной датой фиксируется, на какую дату расчёта и по какой версии данных она получена. Без этого цифра невоспроизводима.

**4. Сигналы.**
- **«в графике»** — оперативная раньше рабочей с запасом не меньше порога;
- **«внимание»** — запас меньше порога предупреждения;
- **«под угрозой»** — оперативная позже рабочей;
- **«нарушение»** — оперативная позже договорной;
- **«достигнуто»** — фактический финиш не позже цели;
- **«преодолено»** — фактический финиш раньше цели на величину не меньше порога опережения.

**5. Пороги по умолчанию.** Предупреждение — за 5 дней; «преодолено» — от 3 дней опережения. Значения настраиваемые.

**6. Настройка целей: три фиксированных слота.** Раздел «Цели» в «Проект → Настройки». Именно три ФИКСИРОВАННЫХ СЛОТА, а не поле «количество»: Рабочая и Договорная включены всегда, Перспективная — галочкой «использовать». Причина: при смене количества пришлось бы перенумеровывать и переименовывать уже назначенные даты.

**7. Разделение структуры и значений.** В настройках проекта — только структура (какие цели используем, названия, пороги). Сами даты назначаются там, где живёт субъект цели, то есть на заказе-кусте в его панели.

**8. Субъект цели — заказ-куст.** Цель назначается на заказ-куст целиком; цели на отдельные операции — отдельным этапом позже.

**9. Якоря и назначение.** У якоря появляется обязательное поле «назначение» со значениями «закрепление старта» (существующее поведение) и «целевая дата» (новое). От назначения зависит, влияет ли запись на расчёт: закрепление старта двигает операции, цель НЕ двигает ничего.

**10. Жёсткие правила.**
- цель не влияет на расчёт и не переписывает прогноз;
- изменение целевой даты — это НОВАЯ запись в журнале (кто, когда, с какой на какую, причина), а не правка прежней;
- рабочая дата не может быть позже договорной — выводится предупреждение (не блокировка);
- у каждого сигнала видно основание (дата расчёта и версия данных).

**11. Интерфейс.** Значок со светофором и разрывом в днях на кусте и в сайдбаре; отдельный экран «Цели» по проекту, отсортированный по риску; быстрые действия из значка — показать на диаграмме Ганта, показать на сетевом графике, показать, что мешает (критический путь и конфликты на общих ресурсах).

**Границы этапа (что отложено).** Обратное планирование «от цели» с пересчётом дат (отдельный явный режим с предупреждением); цели на отдельные операции; автоматические рекомендации по достижению цели (второй шаг, после сигналов и разрыва). *(27.09.2026) Рекомендации и применение изменений вынесены из отложенного: спецификация — Дополнение 13, план — блоки 6.14д и 6.14е. Отложенными остаются обратное планирование «от цели» и цели на отдельные операции.*

## 31. Дополнение 10. Сквозные требования к графикам: условное форматирование и контекстная справка (25.09.2026)

**Суть.** Два требования объявляются сквозными: они обязательны для любого блока, который рисует график, дашборд, индикатор или панель. Это не отдельная задача «на потом», а критерий готовности (definition of done): блок не считается сделанным, пока оба требования не выполнены. Требования действуют и для уже сделанных графиков — для сетевого графика назначен отдельный ретрофит (план, блок 6.15).

**Требование 1. «Условное форматирование».** При описании любого графика, дашборда, индикатора или панели в спецификации обязательно указываются правила условного форматирования: какие состояния возможны, по каким порогам они определяются, каким цветом и значком помечаются, где именно показываются.
- Правила задаются в одном месте и применяются одинаково во всех местах показа: график, дашборд, значок в дереве, список. Один и тот же смысл не показывается разными цветами в разных местах.
- Каждое цветовое состояние обязано иметь объяснение: пользователь видит, почему элемент помечен именно так и на основании какого расчёта. Цвет без объяснения считается дефектом.
- Образец оформления — сигналы режима цели (Дополнение 9): состояния «в графике», «внимание», «под угрозой», «нарушение», «достигнуто», «преодолено», с порогами (предупреждение — за 5 дней, преодоление — от 3 дней). Их оформление (цвет + значок + пояснение + основание) берётся за эталон для остальных графиков, дашбордов и панелей.

**Требование 2. «Контекстная справка».** Каждый элемент интерфейса имеет контекстную справку: крыжик, переключатель, поле, пресет, кнопка, значок, маркер на графике.
- Справка отвечает на четыре вопроса: что делает элемент; на что влияет; какое значение по умолчанию; как вернуть как было.
- Доступ — значок вопроса или всплывающая подсказка при наведении; для сложных элементов допускается раскрываемый текст.
- Тексты справки хранятся централизованно (единый словарь), а не разбросаны по коду, чтобы формулировки не расходились между экранами. Механизм и словарь — по UI-стандарту «Системные подсказки при наведении» (раздел 13.15).
- Отсутствие справки у нового элемента интерфейса считается незавершённой работой, а не отдельной задачей на потом.

**Границы этапа.** Требования не вводят новых экранов и не меняют расчёт. Они распространяются на все блоки про графики, дашборды и панели, включая уже сделанные. Ретрофит сетевого графика (панель вида: крыжики, раскладки, режимы, качество, границы периода; индикаторы: честные сообщения о пересечениях, вердикт планарности, маркеры обрезки) выделен в отдельный пункт плана (блок 6.15).

**Состояние (25.09.2026).** Требования закреплены в промте (это дополнение) и в плане (блок 6.15 со сквозным definition of done). Требования действуют как критерий готовности, а не отдельная задача «на потом». Ретрофит сетевого графика выполнен попутно 25.09.2026 (коммит 31b7ccf).

## 32. Эталон замеров сетевого графика CPM (25.09.2026)

**Единственный эталон для сверки.** Снят на коммите `12fba13` (код сетевого графика без изменений с `95e485d`). Стенд: локальный, проект «Полигон A — Мосты (тест)», режим «По слоям», окно 01.01.2027–10.10.2027, масштаб не меньше 62 % (замер на 72 %). Числа — из панели «Качество раскладки» (значок «i»).

| Раскладка | Крыжик «Выравнивать по границам периода» | Пересечения линий на схеме | Пересечения связей (по слоям) | Проходы сквозь узлы | Наложения узлов | Наложения подписей | Плотность |
|---|---|---|---|---|---|---|---|
| Обычно | вкл | 0 | 0 | 0 | 0 | 0 | 2,6 % |
| Плотно | вкл | 0 | 0 | 0 | 0 | авто 0 · было 2 | 2,7 % |
| Плотно | выкл | 0 | 0 | 0 | 0 | авто 0 · было 2 | 2,7 % |
| Без пересечений | вкл | 0 | 0 | 0 | 0 | 0 | 2,6 % |
| Для печати | вкл | 0 | 0 | 0 | 0 | авто 0 · было 5 | 12,9 % |

Дополнительно (полнота): на полном проекте без окна крыжик на числа не влияет (обрезанных узлов нет) — «Плотно» 10 → 10 пересечений связей по слоям, «Обычно» 7 → 7.

**Вывод по «Плотно».** Подозрение «крыжик ухудшает укладку 8 → 13» НЕ подтвердилось: на зафиксированном окне пересечения равны 0 при включённом и выключенном крыжике во всех раскладках. Крыжик действует (пиксельная разница полотна OFF→ON ≈ 21 200 px — маркеры обрезки выносятся на общую вертикаль), но укладку не ухудшает; предохранитель или отключение для «Плотно» не требуется, код графика не менялся.

**Устойчивость переключения (проверено вживую).** Свежая загрузка: крыжик включён по умолчанию, границы выровнены сразу; выключение держится после перезагрузки (off → off); повторное включение применяется (off → on); смена раскладки туда и обратно («Обычно» → «Для печати» → «Обычно») сохраняет и выравнивание, и число пересечений (0 → 0).

**Правило сверки.** Дальше все отчёты по сетевому графику сравниваются только с этой таблицей. Любое расхождение (рост пересечений, проходов сквозь узлы, наложений узлов/подписей) считается регрессией, пока эталон не пересмотрен отдельно и явно.

## 33. Определение готовности: ступени и единая шкала статусов (25.09.2026)

**Назначение.** Это дополнение задаёт, что считать готовностью, и единую шкалу статусов для плана реализации и любых отчётов о ходе работ. Оно отменяет прежнюю практику, при которой статус ставился по признаку «сделано в коде».

**Причина введения.** Ранее статусы ставились по признаку «сделано в коде», без разделения ступеней готовности. Из-за этого блоки, реализованные только локально и не выложенные на прод, помечались как завершённые (✅ / 100 %).

**Ступени готовности (проходить по порядку).**
1. **Реализовано** — код написан и есть в рабочей копии (сама по себе эта ступень завершением не является).
2. **Проверено на локальном стенде** — сборка проходит, проверки типов проходят, поведение проверено на стенде, при необходимости сняты замеры.
3. **Выложено на прод и проверено** — код выложен на прод и проверен там.

**Правило смены статуса.** Статус меняется только по фактическому прохождению ступеней **«реализовано → проверено на локальном стенде → выложено на прод и проверено»**. «Сделано в коде», но не проверено на стенде — это «в работе», а не завершение. Готовое и проверенное только локально, но не выложенное на прод, не может быть выше «готово локально, проверено». Дата ревизии указывается рядом со статусом; процент как доля объёма допустим только рядом с перечнем того, что не сделано.

**Единая шкала статусов (использовать везде).**

| Статус | Что означает |
|---|---|
| **Выложено на прод, проверено** | реализовано, собрано, проверено на стенде, выложено на прод и проверено там |
| **Готово локально, проверено** | реализовано и проверено на локальном стенде (сборка, проверки типов, замеры); на прод НЕ выложено |
| **Готово частично** | часть объёма сделана, часть нет; рядом обязательно перечислено, что осталось |
| **В работе** | начато, результат не предъявлен |
| **Не начато** | только спецификация или упоминание в плане |
| **Отложено** | сознательно перенесено на другой этап; указано, на какой |

**Служебные пометки.** Строки со статусом «документ» отмечают подготовленный документ или спецификацию (кода по ним нет); они не считаются реализацией и учтены в статусе соответствующего блока. Строки со статусом «правило (сквозное)» — закреплённые требования (definition of done), которые применяются на каждой ступени, где трогается график, дашборд или панель.

**Состояние (25.09.2026).** По этой шкале проведена ревизия плана реализации (блоки 6.x и фазы 0–9). Граница выкладки на прод на момент ревизии — состояние `origin/master`, коммит `356b9d1` (17.09.2026); всё, что сделано после, на прод не выкладывалось. Результаты ревизии — в плане (раздел «Итоги ревизии статусов»).

## 34. Дополнение 11. Раздел «Расчёты»: методы, запуски, оценки и актуальность (26.09.2026)

**Суть.** Разрозненные места расчёта сводятся в один раздел «Расчёты»: методы планирования и анализа разводятся по двум независимым осям, каждый расчёт сохраняется как объект с версией входных данных, а расчётные страницы собираются на общем каркасе. Отдельно фиксируются два отсутствующих звена, без которых страницам PERT и Монте-Карло нечего показывать: ввод тройных оценок и выгрузка/загрузка экспертной таблицы. Третье правило — актуальность: устаревшее число никогда не показывается как действующее.

**1. Модель методов: две независимые оси, а не слои.**
- **Логика планирования:** **CPM** (критический путь в проекте или кусте) либо **CCM** (межпроектное объединение: слияние в пул и критическая цепь). CCM — равноправный метод, а НЕ надстройка над CPM: он сочетается с CPM и может применяться без него.
- **Анализ неопределённости:** без анализа, либо **PERT** (аналитическая оценка разброса), либо **Монте-Карло** (симуляция).
- Оси независимы; допустимы любые сочетания. Каждый расчёт хранит обе оси.

**2. Запуск расчёта — объект.** Область (проект / куст / группа / пул), методы (обе оси), параметры, дата и версия входных данных, результат. Запуск — основа сравнения методов, истории и прослеживаемости: по любому показателю видно, на какую дату и по какой версии данных получена цифра.

**3. Раздел «Расчёты» — хаб с вкладками.** Пункт меню «Диаграмма Ганта» переименовывается в «Расчёты». Внутри — хаб с вкладками: **Обзор · Гант · Сеть CPM · PERT · Монте-Карло · CCM · Сравнение · Запуски**.
- **Обновление 30.09.2026.** Вкладки «Сеть CPM» и «CCM» объединены в одну — «Сетевой график» (слои: путь куста, цепь кластера); CCM остаётся методом оси логики. См. Дополнение 19.
- Вкладки, чьи методы выключены в настройках проекта, не скрываются: показываются неактивными с пояснением причины и кнопкой «включить», ведущей в настройки расчёта.
- Единая полоса контекста на всех страницах: область (проект / куст / группа / пул), активные методы, дата и версия данных расчёта, кнопка «Пересчитать», индикатор «есть несохранённые изменения».

**4. Страницы — общий каркас.** Сверху параметры, в центре главное представление, снизу детали и таблицы. Пустых страниц быть не должно: если данных нет, показывается объяснение, чего не хватает, и кнопка перехода к устранению.
- **Обзор.** Итоговый отчёт и аналитика по проекту; сюда переносится шкала куста. Плитки KPI (детерминированный срок, p50/p80/p95, разрыв к цели, конфликты, узкие места); таблица кустов и операций с отклонениями.
- **Гант.** Текущая диаграмма и шкала — встраивается как вкладка.
- **Сеть CPM.** Существующий сетевой график и панель качества.
- **PERT.** Интервалы 68 % и 95 % на шкале времени; диаграмма-торнадо вклада операций в разброс; таблица операций с тремя оценками; отдельный блок предупреждений по операциям без оценок.
- **Монте-Карло.** Наверху — число прогонов и зерно генератора (без зерна результат невоспроизводим); гистограмма и S-кривая с подбором даты по вероятности; таблица процентилей; сравнение с детерминированным расчётом и с PERT.
- **CCM.** Объединённый график по пулу или группе, вклад каждого куста, где и на чём конфликтуют.
- **Сравнение.** Наложение распределений и сроков; таблица методов с разницей в днях.
  - Обновление 30.09.2026: первый срез готов — два запуска из реестра рядом (когда, метод, версия данных, срок, разница B − A, прогоны и p50/p80/p95); наложение S-кривых, когда оба запуска вероятностные; числа только из реестра, PERT и Монте-Карло не усредняются.
  - Обновление 30.09.2026 (номер 2): страница «Настройки расчёта» открывается как вкладка раздела — полоса расчётов и лента вкладок остаются на экране; выйти можно любой вкладкой (отдельная кнопка не нужна — убрана по решению владельца); меню не обязательно.
  - Обновление 30.09.2026 (номер 3): вкладка «Настройки расчёта» показывает только расчётные секции (модель оценки и параметры МК, дата старта, дата плана, режим расчёта); проектные настройки (имя, статус, общие ресурсы, этапы, удаление) — в полной странице настроек из меню, чтобы не мешать работе с расчётом.
  - Обновление 30.09.2026 (номер 4): справка вкладок расчётов дополнена и выверена — отдельная статья «Сравнение»; в статьях отражены интерактивная диаграмма Монте-Карло и восстановление последнего запуска, источник оценок, применение сжатия из разбора, свод контуров, поведение «Настройки расчёта» как вкладки.
  - Обновление 01.10.2026 (номер 5): шаги «Пути расчёта» зеркалят настройки методов и состояния данных (выключенный метод — «впереди», а не «сделан»; Монте-Карло — «сделан» только после прогонов); клик по выключенному шагу ведёт в «Настройки расчёта», по активному — на страницу метода; неожиданные значения вкладок не роняют приложение.
  - Обновление 01.10.2026 (номер 6): журнал применённых сжатий хранится на сервере — список, запись, откат; лимит 100 записей на проект (старые уходят), откат не удаляет запись, а помечает «возвращено» и возвращает прежние оценки операции; журнал переживает перезагрузку. Реестр запусков и сравнение выгружаются в CSV (Excel).
  - Обновление 01.10.2026 (номер 7): блок 6.24 в работе (первый срез) — факт по завершённым операциям («Факт, ч» и дата завершения), «Калибровка по истории»: наблюдения, период, медиана отношения «факт / оценка», применение ×k к оценкам (источник «коэффициент»), заполнение «из истории». Переключатель «использовать исторические данные» управляет подсказками и по умолчанию выключен.
- **Запуски.** Список запусков (когда, метод, область, данные), сравнение двух выбранных, экспорт и импорт. Механику реестра переиспользовать от сохранённых видов — второй похожий реестр не делать.
  - Обновление 01.10.2026 (номер 8): «Калибровка по истории» размещается компактной строкой над таблицей оценок (разворот по клику); из применения коэффициента исключаются строки, заполненные из истории (источник «факт»), — наравне со строками с собственным фактом.
- **Обновление 30.09.2026 (МК-страница).** Гистограмма интерактивна: наведение и клик закрепляют столбец и показывают вероятность уложиться в срок; чипы p50/p80/p95 подсвечивают свой столбец. Последний запуск Монте-Карло сохраняется в реестр (результат, дата, прогоны, зерно) и **восстанавливается при возврате** на вкладку или к проекту — расчёт не сбрасывается; над диаграммой — строка «Последний сохранённый расчёт: …» с переходом в «Запуски». Реестр и страницы не смешивают проекты: до загрузки реестра своего проекта — «нет данных», данные прошлого проекта не подставляются.
  - Обновление 01.10.2026 (номер 9): журнал применений калибровки хранится на сервере (список/запись/откат, лимит 100 записей на проект; откат возвращает прежние оценки всех затронутых строк и помечает запись); в панели — разбивка по типам операций (наблюдения и медиана по каждому типу).

  - Обновление 01.10.2026 (номер 10): калибровка применяется и выборочно — по типу операции (производство, закупка, …), отдельной кнопкой на тип; запись журнала хранит охват применения («все строки» / «тип: название»).
**5. Настройки расчёта проекта.** «Проект → Настройки», раздел «Расчёты»: доступные методы планирования (CPM, CCM), включённый анализ (PERT, Монте-Карло), параметры Монте-Карло по умолчанию, доверительный уровень по умолчанию, переключатель «использовать исторические данные» (по умолчанию выключен, включается только решением пользователя). В коде поле есть: `projects.default_method` со значениями `cpm / pert_cpm / cpm_ccm / pert_ccm` (по умолчанию `cpm`) — задаётся при создании проекта (`apps/api/app/models/project.py`, `apps/api/app/schemas/project.py`). Но это одна строка вместо двух независимых осей (пункт 1), и отдельного раздела настроек расчёта нет: требуется перевести хранение на две оси и добавить настройки. *(Исправлено 27.09.2026 по коду: прежде здесь было сказано, что выбора метода нет вовсе.)*
  - Обновление 01.10.2026 (номер 11): журнал применений калибровки показывает возвращённые записи только по галочке (по умолчанию скрыты, счётчик в подписи; записи не удаляются), возврат выполняется строго по порядку — от последней активной записи к предыдущим (кнопка активна только у неё). В справке статьи «Оценки» описаны: журнал «Применения» с охватом и фильтром возвращённых, выборочное применение по типам, порядок возврата.

  - Обновление 01.10.2026 (номер 12): панель калибровки показывает достоверность медианного коэффициента (высокая/средняя/низкая — по числу наблюдений и разбросу) с предупреждениями о слабой выборке, разбросе и расхождении медиан по типам; перед применением виден масштаб — сколько строк затронет и как изменится их суммарная ожидаемая длительность.
  - Обновление 01.10.2026 (номер 13): панель калибровки показывает состояние (число активных применений и суммарный множитель), предупреждает при накоплении перед новым применением, позволяет вернуть все применения одной кнопкой (откат по порядку, с подтверждением); после применения — подсказка «Пересчитать». В справке — «Порядок калибровки» (как пользоваться) и «Границы применения» (ограничения). Также пояснены поля «Наблюдений» и «Разброс отношений».
  - Обновление 02.10.2026 (номер 14): страница «CCM · Портфель» — карта занятости ресурса (полосы проектов, подсветка перекрытий, свободные окна, статус «занят до… / свободен до…»); восстановлена авторизация запросов страницы. По кнопкам карты занятости и предложения сдвига страница автоматически прокручивается к результату.
  - Обновление 02.10.2026 (номер 15): раздел «CCM · Портфель» разложен на вкладки («Обзор», «Ресурсы и конфликты», «Карта занятости», «Сводный график»); единая таблица общих ресурсов с фильтром «все / только конфликтные»; карта занятости — на своей вкладке; «Объединить» — на «Обзоре» с переходом на «Сводный график».
  - Обновление 02.10.2026 (номер 16): применение сдвига старта сохраняется в журнале (проект, направление, дней, даты до и после) и автоматически пересчитывает затронутый проект; «Вернуть» восстанавливает дату старта, помечает запись «(возвращено)» и пересчитывает проект повторно; журнал виден в «Ресурсах и конфликтах», возврат — по порядку.
  - Обновление 03.10.2026 (номер 17): пересчёт проектов сдвига — список по хронологии занятости ресурсов, кнопки «Пересчитать» и «Пересчитать все по порядку», статусы «требует пересчёта / пересчитан»; галочка «Автопересчёт после сдвигов» (по умолчанию выключена) пересчитывает все проекты сдвига автоматически после каждого сдвига и возврата.
  - Обновление 03.10.2026 (номер 18): на «Карте занятости» под диаграммой — таблица «Проекты и заказы на карте»; заказы проектов чипами-ссылками, клик открывает окно заказа (то же окно, что и из списков, order:openWin).
  - Обновление 03.10.2026 (номер 19): в «Проектах и заказах на карте» показываются только заказы, в маршруте которых есть выбранный ресурс (фильтр по операциям заказа и их ресурсам).
  - Обновление 03.10.2026 (номер 20): сдвиг переносит контур — вместе со стартом проекта на те же +N дней сдвигаются окна заказов (куст целиком: дети вместе с родителем); закреплённые заказы и заказы без дат не переносятся («пропущено»). Мастер сдвига: шаг 1 — проверка (кусты, окна «до → после», что пропустится), шаг 2 — «Сдвинуть всё» (проект + заказы) или «Сдвинуть куст» (только выбранный куст; старт проекта не меняется). Галка «Сдвигать сразу, вместе с заказами» (по умолчанию выключена) применяет сдвиг без промежуточных шагов. Журнал хранит охват и числа перенесённых и пропущенных заказов; «Вернуть» возвращает и старт проекта, и даты заказов. На «Карте занятости» заказ вне окна проекта помечается ⚠.
  - Обновление 04.10.2026 (номер 21): справка «Сдвиги CCM: как работать» — варианты (мастер по шагам и «сразу»), что требуется, где результат, как вернуть; «освободится» у ресурса показывает реальное освобождение (конец окна чужого проекта), а не конец пересечения; метки разделены: «вне диапазона карты» (шкала карты) и «выходит за окно проекта» (окно проекта); после возврата сдвига панель предложения закрывается — устаревший статус не сохраняется.
  - Обновление 04.10.2026 (номер 22): «График сдвига» («призрак» до/после) — кнопка «📊 График» у записи журнала сдвигов и на шаге «Проверка» мастера: окно «что было → что стало» (контур «было» пунктиром, полоса «стало», янтарная зона сдвига, маркер старта проекта, заказы строками с кликом в окно заказа, пропущенные — списком); записи «(возвращено)» показывают историю сдвига; сервер — GET /v1/ccm/shifts/{id} с перенесёнными и пропущенными заказами; дерево заказов (родитель → дети) и раскрытие операций «▸ оп.» из расчёта проекта («было → стало»).
  - Обновление 04.10.2026 (номер 23): призраки «как было» на «Карте занятости» и «Показать на карте» из «Графика сдвига»: галка «Показать „как было“» — по активным (не возвращённым) записям журнала заказы показываются пунктиром на старых датах (подсказка «Было до сдвига: … · сдвинуто на +N дн»), шкала расширяется; после возврата — «активных сдвигов нет»; кнопка «🗺 Показать на карте» в окне графика — закрывает график, открывает карту, включает призраки и подсвечивает заказы записи (снимается крестиком).
  - Обновление 04.10.2026 (номер 24): слой сдвигов на «Сводном графике»: кнопка «Показать сдвиги («было»)» (вкладка «Сводный график» и «Обзор»); узлы проектов с активными сдвигами — янтарный пунктирный ободок, в шапке сводка «+N дн»; в ответ /ccm/merge добавлено поле project_id у узлов (привязка к проекту); сводный граф топологический — календарный перенос показывается пометкой, не смещением; учитывается сумма активных сдвигов проекта (возвращённые — нет).
**6. Ввод тройных оценок (обязательно до страницы PERT).**
- Поля оптимистичной, наиболее вероятной и пессимистичной оценок есть в модели операции и используются расчётом, но в интерфейсе их заполнить негде — фиксируется как факт.
- Ввод — в карточке операции, с мгновенным показом ожидаемой длительности и разброса.
- Проверка: оптимистичная ≤ наиболее вероятная ≤ пессимистичная.
- Каждая оценка хранится с указанием источника: факт (история), эксперт, оценка ИИ.

**7. Экспертная таблица — выгрузка и загрузка.**
- **Выгрузка в Excel:** код и наименование операции, единица измерения, текущая длительность, три оценки, комментарий-обоснование; в шапке — проект и область, дата выгрузки и версия данных (чтобы отличать свежий файл от устаревшего); правила проверки написаны прямо в листе.
- **Загрузка с сухим прогоном и предпросмотром:** что изменится, какие строки не проходят проверку, какие операции не найдены; ничего не записывается до подтверждения; сводка в стиле мастера массового удаления («обновлено · пропущено · ошибок»); повторная загрузка того же файла не ломает данные — сопоставление по идентификатору операции; фиксируется, кто и когда загрузил.

**8. Актуальность расчётов и пересчёт при смене контекста.**
- **Отпечаток входных данных** у расчёта: длительности и тройные оценки, зависимости, календари, состав кластера и пула, закрепления старта, назначения ресурсов.
- При изменении входов расчёты с изменившимся отпечатком автоматически помечаются неактуальными — со списком того, что изменилось.
- **Результаты не удаляются:** прежний расчёт сохраняется в истории и помечается неактуальным. В интерфейсе показывается актуальное число, прошлое — по клику, для сравнения «было / стало». Показывать устаревшее число как действующее запрещено.
- **Размещение куста в кластер:** диалог с последствиями («куст будет рассчитан в составе кластера по выбранному методу; прежние результаты сохранятся в истории и будут помечены неактуальными; цели и сигналы пересчитаются») и две кнопки: «Пересчитать сейчас» (по умолчанию) и «Отложить». После «Отложить» куст и кластер получают признак «требует пересчёта», а отчёты по ним показывают предупреждение вместо голых цифр.
- Обратный случай (вывод куста из кластера) — такой же пересчёт.
- **Цели при пересчёте не сбрасываются:** договорная и рабочая даты — назначения; пересчитываются оперативная дата, разрыв и сигналы. Отдельный сигнал — договорная дата, ставшая недостижимой в составе кластера.
- Правило распространяется на всё, что меняет исходные данные.

**9. ИИ-заполнение оценок (раздел внедрения ИИ-помощника, отдельным блоком).** Явная зависимость от готовности формы экспертной таблицы (пункт 7).
- ИИ предлагает тройные оценки по операциям на основе наименования, типа, ресурса, единицы измерения, похожих операций и, когда есть, фактической истории.
- **Жёсткие правила:** оценка ИИ ВСЕГДА помечается как оценка ИИ и никогда не смешивается молча с экспертной или фактической; предложение всегда с обоснованием (на что смотрел ИИ); обязательное подтверждение человеком (по строке или пакетом) до попадания в расчёт; показывается разница «было → предложено»; проверка оптимистичная ≤ наиболее вероятная ≤ пессимистичная; приоритет источников: факт выше эксперта, эксперт выше предложения ИИ.
- **Риск, который обязательно зафиксировать: слепое доверие.** Если ИИ заполнит всё, разброс превратится в одно мнение модели, а отчёты будут выглядеть обоснованными данными. Поэтому в отчётах всегда видно, какая доля оценок от ИИ, какая от эксперта, какая из истории.
- Ценность ИИ максимальна на «холодном старте» (оценок нет вовсе), на массовых однотипных операциях и как проверка явно нереалистичных оценок.

**10. Очередь работ.** Порядок: (1) реестр сохранённых видов; (2) каркас раздела «Расчёты»; (3) ввод тройных оценок и экспертная таблица; (4) страница PERT; (5) страница Монте-Карло; (6) CCM как метод; (7) актуальность расчётов и пересчёт при смене контекста; (8) запуски, сравнение методов, итоговый отчёт с выгрузкой; (9) режим цели (даты обосновываются вероятностями); (10) дашборд проекта; (11) калибровка по историческим данным; (12) ИИ-заполнение оценок в разделе ИИ-помощника; (13) показ цели на графиках, подключение видов, финальная уборка. **Обоснование порядка:** сначала каркас и ввод данных (без оценок страницы PERT и Монте-Карло показывают пустоту), потом страницы расчётов, затем обобщение, затем цели с опорой на вероятности. Подробная развёртка очереди по блокам плана — в плане реализации.

**11. Единый режим отображения сроков в разделе «Расчёты» (26.09.2026).** Во всех вариантах расчёта сроки показываются одинаково: один формат дат и один формат длительностей, без смешения «дней», «часов» и «дат» в соседних строках. Значок метода расчёта имеет три состояния — «заполнено» / «частично» / «не заполнено» — и одинаково читается во всех вкладках. Перед сравнением варианты приводятся к одной базе (одна шкала времени, одни единицы), иначе сравнение некорректно. Пустого места не бывает: если данных для показа нет, вместо пустоты выводится заглушка с подсказкой, как заполнить. *(Статус — в очереди; связь: пункты 1, 3, 4 этого дополнения и блок плана 6.16.11.)*

**12. ИИ-заполнение оценок при вводе данных (26.09.2026).** В формах ввода (операция, ресурс, маршрут, состав, календарь) помощник может предложить норму или оценку; человек подтверждает предложение, и только после этого значение попадает в данные, а всё предложенное ИИ помечается «предложено ИИ». Приоритет источников: сначала наши данные (факт и история); при отсутствии данных пишем прямо «нет данных», а не подставляем правдоподобное число. *(Статус — в очереди; связь: пункты 6 и 9 этого дополнения и продуктовый промт, раздел «ИИ-советники», блок «Доверие и безопасность»; блоки плана 6.17.6 и 6.26, этап 2.)*

**13. Две независимые оси методов: уточнение (26.09.2026).** Оси — логика планирования (CPM или CCM) и модель оценки (детерминированная, PERT, Монте-Карло); они независимы и их нельзя скрещивать в один список или один «составной» метод — выбирается ровно одно значение по каждой оси, сочетания допустимы любые. Формулировка «без анализа» в пункте 1 читается как «детерминированная» модель оценки (одна цифра, без распределения). *(Статус — в очереди; связь: пункт 1 этого дополнения и блок плана 6.16.2.)*

**14. Режим цели: вероятностное основание дат (блок 6.14г, 27.09.2026).** Здесь закрывается главное звено режима цели: цель должна опираться на распределение, а не на одну детерминированную цифру.
- Рядом с рабочей и договорной датами видно, какой вероятности достижения эта дата соответствует. Без распределения обоснование не показывается: вместо правдоподобного числа выводится «нет данных» и подсказка, как получить распределение (ввод тройных оценок — пункт 6, либо включение Монте-Карло — пункт 5).
- Опора — на PERT или Монте-Карло (p50/p80/p95), а не на одну цифру; для этого вероятностные страницы (блоки 6.18, 6.19) должны уметь считать.
- Отдельный сигнал — договорная дата, ставшая недостижимой в составе кластера (совместно с пунктом 8).
- Цели при пересчёте не сбрасываются: договорная и рабочая — назначения, пересчитываются оперативная дата, разрыв и сигналы (жёсткие правила — Дополнение 9, пункт 10).
- Сквозные требования: условное форматирование и контекстная справка — по блоку 6.15.
*(Статус — в очереди, шаг 9; связь: Дополнение 9 (пункты 1–4, 10–11), пункты 4 и 8 этого дополнения, блоки плана 6.14а, 6.14г, 6.18, 6.19, 6.21.)*

**15. Дашборд проекта (блок 6.23, 27.09.2026).** Плитки и значки по цели, состоянию расчёта и отклонениям; значок в дереве, экран «Цели» и плитки цели идут вместе с дашбордом и закрывают остаток блока 6.14в.
- Дашборд показывает только актуальные числа: устаревшее значение помечается как неактуальное и не подаётся как действующее (пункт 8). Прежний результат доступен по клику для сравнения «было / стало».
- Плитка без данных не остаётся пустой: показывается причина (чего не хватает) и кнопка перехода к устранению (пункт 4).
- Значки и цвета читаются одинаково во всех представлениях: условное форматирование и контекстная справка — по блоку 6.15.
*(Статус — в очереди, шаг 12; связь: пункты 4, 8 этого дополнения, Дополнение 9 (пункт 11), блоки плана 6.14в, 6.23.)*

**16. Калибровка по историческим данным (блок 6.24, 27.09.2026).** Обратная связь от факта к оценкам: система собирает факт по завершённым операциям, сопоставляет его с оценками и на этой основе подсказывает поправки к оценкам. Делается после накопления истории запусков (блок 6.22).
- Сбор факта по завершённым операциям и сопоставление с оценками; коэффициенты калибровки как подсказка, а не как самовольная правка данных.
- Управляется переключателем «использовать исторические данные»: по умолчанию выключен, включается только решением пользователя (пункт 5).
- Подсказка не подменяет оценки молча: показывается основание (сколько наблюдений, за какой период, по каким операциям), разница «было → предлагается» и пометка источника. Приоритет источников: факт выше эксперта, эксперт выше предложения ИИ (пункт 9). При отсутствии истории пишется «нет данных», а не подставляется правдоподобное число (пункт 12).
- Сквозные требования: условное форматирование и контекстная справка — по блоку 6.15.
*(Статус — в очереди, шаг 13; связь: пункты 5, 8, 9, 12 этого дополнения, блоки плана 6.22, 6.24.)*

**Границы этапа.** Раздел «Расчёты» собирается на существующих представлениях (Гант, сеть CPM, шкала куста) и не отменяет их: они переезжают внутрь хаба вкладками. Выбор метода у проекта, ввод тройных оценок и правило актуальности расчётов в коде сегодня отсутствуют — фиксируются как отсутствующие.

**Состояние (26.09.2026).** Спецификация закреплена в промте (это дополнение) и в плане (блоки 6.16–6.25 и 6.14г). Все новые блоки — «Не начато». Очередь обновлена там же. **(27.09.2026) Дополнено пунктами 14–16:** вероятностное основание дат режима цели (6.14г), дашборд проекта (6.23), калибровка по историческим данным (6.24) — по этим трём блокам спецификации в промте не было, теперь блоки перестали быть «осиротевшими»: у каждого есть требования, связь и шаг очереди.

## 35. Дополнение 12. Сетевой график: правила качества (26.09.2026)

**Суть.** К уже принятым решениям по сетевому графику (Дополнение 6, Дополнение 7) добавляется свод правил качества: что проверяем автоматически, как считаем напряжённость связи и как рисуем связи и критический путь. Отдельно перечислено, что сознательно не делаем.

**Принятые правила.**
1. **Структурные проверки графа.** При расчёте и построении проверяется: в графе нет циклов; у каждого узла есть вход, кроме источника; есть выход, кроме стока; нет полного дубля связи одной пары узлов одного типа (две одинаковые по типу связи между теми же узлами — ошибка, а не норма).
2. **Коэффициент напряжённости `K = t / (t + R_полный)`**, где `t` — длительность связи (работы) на рассматриваемом пути, `R_полный` — полный резерв. Связи с `K > 0.8` подсвечиваются как напряжённые. Порог напряжённости — внутреннее значение, в интерфейсе не настраивается (как и в Дополнении 6).
3. **Стилизация связей и критического пути.** Сплошная стрелка — работа; штриховая — логическая или нулевая связь; критический путь рисуется толще остальных линий. Согласовано с Дополнением 7 (связь без ожидания — широкий штрих-пунктир; критический путь рисуется всегда).

**Сознательно отклонено (не делаем).**
- Показ частных и независимых резервов прямо на схеме.
- Обязательная каноническая нумерация узлов i–j.
- Правило «длина стрелки не зависит от времени».
- Требование отсутствия пересечений как обязательное для любой укладки.
- Правила чертёжного листа (рамка, штамп, основная надпись и т. п.).

**Связь.** Дополнения 6 и 7; блок плана 6.11 и раздел плана «Правила качества сетевого графика (блок 6.11, 26.09.2026)».

**Состояние (26.09.2026).** Спецификация зафиксирована в промте (это дополнение) и в плане. Отдельных работ по этому пункту нет — правила входят в состав блока 6.11 и применяются при его доработке.

## 36. Правила работы с документами (26.09.2026)

**Назначение.** Единые правила фиксации решений, чтобы принятое решение не терялось и не существовало «наполовину».

1. **Решение считается существующим, только если оно одновременно есть в спецификации и имеет блок в плане.** Запись в спецификации без блока в плане — решения нет (оно не будет построено); блок в плане без записи в спецификации — работа без решения. Обе записи делаются в одной связке и ссылаются друг на друга.
2. **Запись делается в день принятия решения.** Дата решения указывается рядом с записью в спецификации и в плане; задним числом не дописываем.
3. **Перед началом каждого блока — короткая сверка с реестром** (`profyplan-сверка-документов-26.09.2026.md`): что обещано документом, что есть в коде, что запланировано; расхождения сразу заносятся в реестр.
4. **Один ID — одно значение, одна шкала статусов.** Единая шкала (раздел 33) без legacy-слоёв; старые метки при смене статуса закрываются.

**Связь.** Реестр сверки, раздел «Правила против повторения» (пп. 1–6), и указатель `ProfyPlan-источник-истины.md`, раздел 4 «Правила ведения документов».

**Состояние (26.09.2026).** Правило введено; вторая площадка — раздел плана «Правила работы с документами (26.09.2026)». Кодовых работ по правилу нет.

---

## 37. Дополнение 13. Режим цели, второй шаг: диагностика разрыва, рекомендации и применение изменений (27.09.2026)

**Суть.** Второй шаг режима цели (после сигналов и разрыва — Дополнение 9). Если заданный период меньше расчётного срока куста или кластера, система не просто показывает «нарушение», а разбирает разрыв по причинам, предлагает способы его закрыть и даёт применить их **прямо из отчёта**, не заставляя человека искать объекты по всему проекту. Решения владельца от 27.09.2026.

**1. Диагностика — только чтение.** Открытие отчёта и запуск разбора не меняют план. Диагностика отделена от применения намеренно: сначала человек понимает причину, потом принимает решение.

**2. Шесть причин разрыва.** Разрыв раскладывается по причинам; совет без причины не показывается.
- длина технологической цепочки (критический путь длиннее периода при нормальных усилиях);
- ресурсный дефицит (очередь на общий ресурс, упирание в лимит подразделения);
- календарь и сменность (одна смена, выходные);
- поставки и закупки (срок поставки длиннее периода);
- межпроектные конфликты (кластер или пул: общие ресурсы и общие вехи);
- качество данных (оценки по умолчанию, отсутствующие нормы).

**3. Каталог рекомендаций по ступеням цены** (порядок — по цене изменения, а не по величине эффекта):
- **бесплатно:** перестановка работ в пределах резерва, снятие устаревшего ограничения ресурса, распараллеливание независимых операций, изменение приоритета очереди на общем ресурсе, уточнение нормы вместо значения по умолчанию;
- **дёшево:** форсаж (коэффициент ускорения на период), рабочие субботы, работа на двух ресурсах одновременно (если операция делимая), дробление партии;
- **средне:** перераспределение лимита между подразделениями, замена ресурса на более мощный из взаимозаменяемых, добавление второго ресурса, передача операции в подряд или на другой участок;
- **крайние:** перенос договорной даты, отгрузка частями, сокращение объёма, изменение техпроцесса, двухсменный график участка на период.

В интерфейсе ступени называются **усилиями** («лёгкие · средние · тяжёлые · крайние меры») — это объём работы и решений, а не деньги; формулировки «бесплатно/дёшево» отклонены владельцем 28.09.2026 как читавшиеся прайсом.

**4. Строка диагноза: факт, предложение, основание, эффект, цена.** У каждой рекомендации видно текущее значение (факт), предложенное значение, основание предложения (норма, справочник, факт и история, аналог по прошлым заказам, оценка ИИ с пометкой «предложено ИИ»), эффект в днях, влияние на другие заказы, цену и риск. При отсутствии данных пишется «нет данных», а не подставляется правдоподобный вариант.

**5. Четыре состояния строки диагноза.**
- **можно здесь** — правка данных доступна из отчёта;
- **можно, но с последствием** — правка доступна, причина изменения обязательна (обязательства, договорная дата, влияние на другие заказы);
- **только в объекте** — из отчёта не меняется: показывается факт, комментарий «что изменить» и переход к объекту **с возвратом в отчёт** (объект открывается боковой панелью, отчёт не теряется);
- **вне системы** — решение уровня договора или производства: отчёт фиксирует, что требуется от человека вне приложения.

**6. Применение изменений из отчёта.** Предупреждение показывается **до** изменения и отвечает на три вопроса: что меняется (было → станет), на что влияет (дата, разрыв, другие заказы), как вернуть. Далее — предпросмотр эффекта, подтверждение, пересчёт, запись в журнал (кто, когда, объект, было → стало, причина, источник предложения) и возможность отмены. Панель «что применено» ведёт накопительный список: применил одно — разрыв сократился на N дней. Действие «применить все безопасные» допускается только после просмотра списка изменений с галочками. Эффекты не складываются линейно: набор проверяется общим пересчётом, а не суммой.

**7. Настройка «Автоматическая правка».** Три уровня, по умолчанию — выключено:
- **выключено** — каждая правка по кнопке, с предпросмотром и подтверждением;
- **безопасные правки** — без подтверждения применяются правки данных без обязательств (снять устаревшее ограничение, форсаж, приоритет очереди, рабочие субботы); нормативы и даты — по-прежнему вручную;
- **полный автомат** — то же плюс изменение нормативов; включается вторым подтверждением с явным текстом последствий и сроком действия.
Настройку меняет владелец проекта; факт изменения настройки записывается в журнал (кто, когда, уровень, срок). Пока опасный уровень включён, в разделе диагностики видна постоянная полоса-предупреждение. По истечении срока настройка возвращается к безопасному уровню сама. Справка к настройке — по четырём вопросам (что делает, на что влияет, значение по умолчанию, как вернуть) — по Дополнению 10.

**8. Четыре границы, не снимаемые ни на одном уровне.**
- договорная дата и обязательства — никогда автоматически (только запись с причиной и решением человека);
- удаление данных — никогда;
- прежнее значение не затирается: даже в полном автомате это новая версия записи с историей;
- норма с пометкой «машинная правка» не может быть источником для новых норм и не может получить пометку «проверенная» — запрет самоподтверждения.

**9. Пакет автоматических правок.** Автоматические изменения одного прохода собираются в одну запись («применено автоматически: N изменений») с возможностью посмотреть состав и откатить пакет целиком.

**10. Отметка в отчётах.** Если в проекте есть нормы, изменённые системой, это видно в отчётах и расчётных показателях: цифра не предъявляется как независимая, не показав, что она уже подстраивалась.

**Порядок работ.** (1) сигналы и разрыв (Дополнение 9); (2) диагностика без применения; (3) применение изменений из отчёта с настройкой автоматической правки.

**Границы этапа.** Обратное планирование «от цели» с пересчётом дат и цели на отдельные операции остаются отложенными (Дополнение 9) и в это дополнение не входят.

**Связь.** Дополнения 9, 10, 11; линия «ИИ-советники» (правило «ИИ предлагает — человек подтверждает»); план — блоки 6.14д и 6.14е.

**Состояние (27.09.2026; обновлено 28.09.2026).** Спецификация закреплена в промте (это дополнение) и в плане (блоки 6.14д, 6.14е). Первый срез 6.14д готов локально (28.09.2026): разбор разрыва на «Обзоре» — только чтение: шесть причин, ступени цены, честные «нет данных»; применение изменений и переходы — блок 6.14е/следующие шаги. Блок 6.14е — «не начато». Первая площадка обсуждения — `ProfyPlan-режим-от-цели-разбор-27.09.2026.html`.

---

## 37. Дополнение 14. Интерактивная справка: окно, кнопка «?» и статьи по модулям (27.09.2026)

**Суть.** В приложении появляется интерактивная справка: одно окно справки, кнопка «?» в шапке каждого окна и каждого раздела, статьи по модулям с примерами, описанием полей, методов и расчётов. Справка — тот же материал, что и подсказки, только длиннее: у каждой сущности один источник текста с тремя уровнями.

**1. Три уровня одной записи.** Для каждой сущности (поле, индикатор, кнопка, окно) в словаре модуля хранится:
- **подсказка** — одна строка, то, что показывается при наведении сегодня;
- **краткая справка** — абзац и пример;
- **статья** — полный разбор: назначение, пример, поля, расчёт, ограничения, связи.

Окно справки открывает статью; подсказка ведёт в статью по якорю «подробнее». Дублирования текстов быть не должно: словарь — единственный источник.

**2. Одно окно справки.** Справка живёт в одном окне, содержимое переключается по модулю. Отдельное окно на каждый модуль не делаем — второй похожий реестр не плодим (то же правило, что для запусков расчёта в пункте 4 дополнения 11 и для сохранённых видов). Окно открывается поверх текущего экрана: место работы не теряется.

**3. Кнопка «?».** Ставится в шапке окна рядом с кнопками свернуть и закрыть. Шапка MDI-окон в приложении единая, поэтому одна правка даёт кнопку сразу во всех окнах. В панельном режиме — та же кнопка в шапке панели. В разделе «Расчёты» — на ленте вкладок: текущий модуль определяется активной вкладкой. Нажатие открывает справку сразу на статье текущего модуля, а не на оглавлении.

**4. Что внутри статьи модуля.**
- Назначение — зачем окно и когда в него идти.
- Пример на демонстрационных данных — пошагово, с указанием, что должно получиться.
- Поля и значения — что значит каждое, откуда берётся, кто меняет.
- Расчёт — метод, формула, допущения (для PERT и Монте-Карло — распределение, для выравнивания — алгоритм).
- Ограничения и типичные ошибки.
- Связи: куда идти дальше и какие связанные блоки ещё не сделаны.

**5. Правило честности текста.** Справка описывает то, что код делает, а не то, что планировалось. У каждой статьи видно состояние: **«описано по коду, проверено»**, **«описано, требует проверки»**, **«ещё не реализовано — блок …»**. Обещание возможностей, которых в коде нет, в справке недопустимо — это следствие правила работы с документами (раздел 36).

**6. Кроме справочника по окнам — два вида содержания.**
- **Сценарии «как сделать»** — сквозные: получить расчёт куста от состава, сравнить PERT и Монте-Карло, поставить цель и увидеть разрыв. Пишутся вместе с владельцем: они описывают процессы, а не код.
- **Раздел «Методы и расчёты»** — формулы и смысл: PERT, распределение бета-PERT в Монте-Карло, критический путь, критическая цепь CCM, выравнивание по Serial SGS, коэффициент напряжённости, резерв и правило «резерв = 0 — критическая». Это отдельный вход: спрашивают не «что за окно», а «почему так посчитано».

**7. Порядок работ.** (1) каркас окна справки и кнопка «?» в единой шапке окон и на вкладках раздела «Расчёты»; (2) единый словарь «подсказка → статья» и перевод существующих подсказок на него; (3) статьи по существующим модулям (заказы, справочники, настройки, графики, виды, расчёты, запуски); (4) раздел «Методы и расчёты»; (5) сценарии «как сделать» и наполнение по новым страницам.

**8. Сквозное требование к новым страницам.** Каждая новая страница выходит вместе со своей статьёй справки: без статьи блок не считается закрытым. Правило действует для блоков 6.17–6.22 и всех последующих.

**9. Устройство окна справки (27.09.2026).** Поиск по заголовкам, описаниям, шагам, полям, расчёту и ограничениям; дерево разделов слева с подсветкой активной статьи; хлебные крошки; ссылки внутри текста статьи; переходы «назад» и «предыдущая / следующая статья раздела»; окно перетаскивается за шапку и не уводит из работы. Ориентир — устройство справочных сайтов: навигация слева, поиск сверху, крошки, связанные статьи.

**Уточнение владельца (27.09.2026).** Кнопка «?» — **последняя из обычных кнопок**: в шапке окна стоит сразу слева от группы управления окном (свернуть, развернуть, раскладка, закрыть), в шапке раздела и на ленте вкладок — самая правая. Окно справки — **обычное окно оконного менеджера**: свернуть, развернуть, раскладка окон, закрыть, чип в панели задач, перетаскивание; одно окно на приложение — повторное нажатие «?» переключает статью и поднимает окно. Справка открывается на статье **того, что сейчас в рабочей области**: каждый вид экрана сопоставлен статье явно (рабочий стол и портфель, сводка расчёта проекта, заказы, окно заказа, состав, группы и кластеры, шкала куста, мастер проекта, архив, раздел «Расчёты» с вкладками, CCM, отчёты, инструменты, настройки, справочники и ресурсы). «Запасного» раздела для всего подряд быть не должно.

**10. Три входа в справку через одну карту элементов (27.09.2026).** Элемент интерфейса помечается атрибутом data-help-id, а карта элементов говорит, что про него знает справка: название для меню, короткая подсказка и статья. Одна и та же карта обслуживает: кнопку «?» в шапке окна и раздела; пункт **«Что это? — Название элемента»** в контекстном меню (правая кнопка по элементу); режим **Shift+F1** — следующий щёлчок по элементу открывает его справку; **F1** — статья текущего модуля. Отдельных списков под каждый вход не заводить. Название пункта меню — «Что это?» с названием элемента: формулировка действия, а не существительное.

**11. Сквозной разбор проекта и полная справка (запись на будущее, 27.09.2026).** Отдельная крупная работа: пройти проект целиком — окно за окном, справочник за справочником, расчёт за расчётом — и довести справку до состояния, когда каждый экран, каждое поле и каждая цифра объяснены с примером на демонстрационных данных. Выполняется, когда основные разделы уже собраны; каждая статья проходит сверку с кодом и помечается состоянием. Ведётся отдельным блоком плана (6.28).

**Границы этапа.** Обязательный язык — русский; английская версия появится вместе со второй локалью. Справка не заменяет контекстные подсказки и не дублирует их: подсказка остаётся короткой, статья — полной. Фазы 9.1–9.3 плана («раздел „Помощь“, контекстная справка, объяснение расчётных величин») закрываются этим дополнением и отдельными шагами не ведутся.

**Состояние (27.09.2026).** Решение закреплено владельцем. Спецификация — это дополнение; в плане — блок 6.27, в очереди — сразу после каркаса раздела «Расчёты». Кода нет: работы не начаты.


---

## 38. Дополнение 15. Методика применения методов и режимы расчёта (27.09.2026)

**Суть.** Методы расчёта — не список на выбор, а **слои**, и пользователю предлагаются **режимы, названные по задаче**. Режим сам собирает нужные слои; человек отвечает на вопросы про свою задачу, а не про методы.

**1. Слои (порядок задан природой, переставлять нельзя).**
1. **Структура** — сроки, критический путь, резервы. Считается всегда, как основа, в любом режиме; отдельным выбором пользователю не предлагается.
2. **Ограничения** — календари, события мощности, выравнивание ресурсов. Применяются всегда, когда данные заполнены: это данные, а не метод.
3. **Анализ неопределённости** — PERT (аналитически по критическому пути) и/или Монте-Карло (численно, с полным пересчётом сети). PERT и Монте-Карло — соседи на одном слое, а не шаги друг за другом.
4. **Защита срока** — резервы или буферы критической цепи.
5. **Решение по дате** — какой процентиль берём за план. Это решение руководителя, не метод расчёта.

**2. Режимы, предлагаемые пользователю.** PERT и Монте-Карло доступны **сами по себе**: ни объединение портфеля, ни выбор «CPM» для них не требуется.

| № | Режим | Что считает | Что получите | Требует | Время |
|---|---|---|---|---|---|
| 1 | **Срок и резервы** | структура: сроки, критический путь, резервы, календари, события мощности | срок, критический путь, резервы | состав, маршрут, длительности | мгновенно |
| 2 | **Риск срока — аналитический** | структура + PERT | интервалы 68 % и 95 %, вклад операций в разброс | тройные оценки | мгновенно |
| 3 | **Риск срока — численный** | структура + Монте-Карло | распределение, p50/p80/p95, вероятность даты, частые попадания на критический путь | оценки, прогоны, зерно | секунды |
| 4 | **Риск срока — оба метода** | структура + PERT и Монте-Карло | оба ответа рядом с подписями; видно расхождение | оценки | секунды |
| 5 | **Риск срока с ресурсами** | как 3, но выравнивание внутри каждого прогона | честный разброс с конфликтами и потерями | оценки, ресурсы, графики | минуты |
| 6 | **Портфель** | объединение проектов: общие ресурсы, критическая цепь | сроки портфеля, кто кого сдвигает, критические проекты | несколько проектов, общие ресурсы | секунды–минуты |
| 7 | **Защита срока буферами** | надстройка к любому режиму: агрессивные длительности + буферы | проектный, питающий и ресурсный буферы, правила расхода буфера | оценки — для размера буфера | мгновенно |

Отдельно — **дата плана**: по расчёту · по вероятности (p50, p80, заданная) · по цели.

**3. Правила (жёсткие).**
- Бессмысленное сочетание **не запускается, а объясняется**: «Монте-Карло требует тройных оценок».
- **Одно число — одно происхождение**: PERT и Монте-Карло показываются отдельно, никогда не усредняются.
- Ресурсы и календари учитываются всегда, когда заполнены; «режима без ресурсов по забывчивости» быть не должно.
- Агрессивные длительности (режим 7) меняют входные данные — это подписывается в результате и в запуске.
- В запуске расчёта хранятся: режим, слои, параметры, прогоны и зерно — результат воспроизводим, варианты сравнимы.
- Варианты **системные**; свободная сборка сочетаний — позже и только из осмысленных.

**4. Как пользователь выбирает (три слоя).**
- **Помощник выбора** — три вопроса: что уже известно · что нужно узнать · ограничивают ли ресурсы. Ответы ведут к режиму.
- **Карточка режима** — одинаковый вид у всех, шесть пунктов: что считает · что получите · что нужно · чего не будет · время · когда выбирать.
- **Подсказки** — рекомендация по данным проекта **с причиной** («оценки заполнены, ресурсы общие с двумя проектами»); предупреждение о лишнем («для простой сети хватит аналитического»); предупреждение о недостаточном («аналитический считает по неизменному пути — для переходов критичности нужен численный»).
- **После расчёта** — блок «что дальше»: сузить интервал · защитить дату буферами · включить ресурсы, если конфликты часты.
- Описания режимов берутся **из той же карты**, что статьи справки (блок 6.27): один источник текста, расхождение невозможно.

**5. Буферы критической цепи.** Буферы — не отдельный метод, а **слой защиты срока**. Реализуются внутри блока «CCM как метод»: агрессивные длительности (по решению владельца — половина случаев), буферы проектный, питающий и ресурсный, размер буфера из разброса (PERT или Монте-Карло), буферная диаграмма, правило расхода буфера (зелёный — по плану, жёлтый — внимание, красный — вмешательство). Фаза плана по кустам и пулам, где упоминались типы буферов и шкала буфера, сводится с этим блоком, чтобы не сделать дважды.

**6. Разбор внешнего анализа методов (что принято, что отклонено).** Отклонено: трактовка «CCM = ресурсные ограничения и буферы» (у нас ресурсы — отдельный слой, а CCM — межпроектное объединение); «последовательности» вида «PERT → CPM», «Монте-Карло → CPM» (это не шаги: PERT и Монте-Карло работают поверх структуры; «Монте-Карло → CPM» — не метод, а политика даты); список из пятнадцати комбинаций (половина — артефакты «последовательного» мышления; перегружает пользователя). Принято: подсказка «для простой сети Монте-Карло избыточен»; размер буфера критической цепи из разброса; «зафиксировать p80 как дату плана» — как политика даты; правило «метод не должен давать цифру без происхождения» (совпадает с нашим).

**7. Область расчёта на расчётных страницах (27.09.2026).** На страницах расчёта (PERT, Монте-Карло, буферы, реестр запусков) выбирается область: **весь проект · куст · ветка · отдельный заказ**. Выбор родительского заказа означает расчёт по нему **вместе со всеми дочерними ветками**; выбор ветки — только по ней. Правила: (1) фильтруются операции выбранной области, и критический путь с разбросом **пересчитываются внутри области**, а не берутся из расчёта всего проекта — иначе подпись «куст» была бы неправдой; (2) связи, выходящие за границу области, отсекаются — это подписывается в результате вместе с числом отсечённых связей; (3) в запуск расчёта пишется область (проект / куст / ветка / заказ) и её идентификатор — это основание сравнения областей между собой. Для этого список операций проекта отдаёт идентификатор заказа, а дерево заказов строится по составу изделия. **Два разных случая (уточнение владельца, 27.09.2026).** Когда расчёт по проекту или кусту уже выполнен, по ветке или заказу можно получить **два разных вида информации**. Первый — **нарезка из выполненного расчёта** (без пересчёта, мгновенно): состав операций ветки, их ожидаемые длительности и разброс, их вклад в разброс проекта. Это отвечает на вопрос «где в этой ветке сосредоточен риск». Второй — **пересчёт по выбранной области**: только он даёт собственные интервалы и процентили ветки (свой критический путь), и оформляется отдельным запуском с областью «ветка» или «заказ». Правило: интервалы и процентили НИКОГДА не подписываются веткой, если они посчитаны по проекту — иначе одна и та же цифра будет означать две разные вещи.

**Состояние (27.09.2026).** Решение закреплено владельцем: семь режимов и политика даты, буферы внутри блока CCM, дорогой режим «с ресурсами» выключен по умолчанию, варианты системные. В плане — блок 6.29 (конструктор расчёта) и пункты блока 6.20 по буферам. Кода нет.


---

## 39. Дополнение 16. Цели по областям и фиксация дат (28.09.2026)

**Суть.** Цель перестаёт быть только проектной: договорная и рабочая даты живут **по области** — проект · куст/группа · ветка · заказ. Сейчас цель хранится двумя полями проекта; это расширяется до таблицы целей по областям, а проектная цель становится записью «область = проект».

**1. Хранение.** Таблица целей: область (проект · куст · группа · ветка · заказ), ссылка на область, договорная дата, рабочая дата, источник каждой даты (расчётная или ручная), признак фиксации. Флажок фиксации записывается **только там, где его поставил человек**; у подчинённых он не хранится, а выводится из ближайшего зафиксированного предка. Благодаря этому «зафиксировал куст — зафиксировалось всё» и «снял у родителя — снялось у подчинённых» работают без массовых записей.

**2. Три состояния строки.**
- **Свободно** — по умолчанию; автоматика (взять расчётные, распределить по вложенным) перезаписывает даты.
- **Зафиксировано** — человек поставил флажок; автоматика пропускает строку, а расхождение с расчётом показывает числом и цветом.
- **Зависит от родителя** — у родителя фиксация, у строки своей нет; даты пересчитываются от родителя, вручную не правятся (только кнопкой «сделать независимой»).

**3. Полный перебор сочетаний (восемь).** Разобраны и зафиксированы: без фиксаций · родитель зафиксирован · родитель и строка · только строка (жёсткий заказ внутри свободного куста) · зафиксирован дальний предок · снятие фиксации у родителя · смешанная ветка (часть детей со своими флажками) · снятие своей фиксации внутри зафиксированного родителя. Поведение каждого — в документе по методике (раздел 13).

**4. Проверка ручной даты и распределение.** Человек вводит рабочую дату области — система сразу проверяет её по **собственной** расчётной схеме этой области: расчётное окончание, вероятность, отклонение («позже расчёта на N дн» / «раньше на N дн, требуется сжатие»). Кнопка **«Распределить по вложенным»** сдвигает даты подчинённых на ту же разницу; это **сдвиг, а не сжатие** — логика цепочки сохраняется. Если дата родителя раньше расчёта, распределение всё равно ставит цели, но строки помечаются «требует сжатия», и это уходит в диагностику разрыва (блок 6.14д). Зафиксированные строки распределение не трогает и докладывает о них отдельно.

**5. Режим фиксации (решение владельца).** Настройка **в проекте**, рядом с политикой даты; по умолчанию — **простой режим**.
- **Простой:** два состояния (свободно · зависит). Жёсткая дата отдельного заказа внутри свободного куста недоступна: чтобы зафиксировать заказ, фиксируется его ветка.
- **Расширенный:** три состояния; своя фиксация возможна на любой строке, и она сильнее родительской; несовместимость двух дат подсвечивается.
- **Хранение одно, режимы — только про действия.** Переключение режимов не меняет данные: построчные фиксации из расширенного режима в простом показываются как «зафиксировано (из расширенного режима)», уважаются в расчёте и снимаются только явным действием «снять построчные фиксации» с подтверждением. Молчаливого сброса быть не должно.

**6. Интерфейс.** На вкладке «Обзор», под текущим блоком цели — **таблица детализации**: строки — проект и вложенные заказы с отступами, колонки — договорная дата, рабочая дата, расчётное окончание, вероятность, состояние (цвет), источник (расчётная/ручная), флажок фиксации. Ручное значение не перезаписывается автоматикой и всегда показывает расхождение с расчётом. Кнопки: «Взять расчётные» (заполняет рабочие даты по политике даты проекта) и «Распределить по вложенным» (сдвиг с показом нужного сжатия).

**7. Порядок работ.** (1) таблица целей по областям и детализация на «Обзоре» с ручным вводом, проверкой, цветом, фиксацией и выбором режима; (2) «Взять расчётные» по политике даты; (3) «Распределить по вложенным». Сначала видимость и ручной ввод, потом автозаполнение, потом сдвиг: каждый шаг полезен сам по себе, и ошибка на раннем шаге дешевле.

**8. Связь с другими блоками.** Вероятности считаются по собственной расчётной схеме области (пересчёт критического пути внутри области — из блока 6.18/6.18.1). Результат «цель требует сжатия» передаётся в диагностику разрыва (6.14д). Область и её идентификатор пишутся в запуск расчёта (реестр запусков, блок 6.16.3).

**9. Даты и сравнение с черновиком (28.09.2026).** В таблице детализации под расчётным окончанием показывается дата (старт проекта + срок области, без учёта выходных) — той же формулой, что заполняет «Взять расчётные». Рядом — колонка «Черновик»: срок по предварительным нормо-часам маршрутов области (операции маршрутов по порядку номеров — как серый таймлайн заказа до расчёта; без связей и ресурсов), с датой и разницей к расчёту; при отсутствии маршрутных операций — прочерк. Черновик и расчёт не смешиваются: разные источники, разные колонки.

**Состояние (28.09.2026).** Решение закреплено владельцем: простой режим по умолчанию, настройка в проекте. В плане — блок 6.30 (готово локально, проверено 28.09.2026: таблица, даты, колонка «Черновик», «Взять расчётные», «Распределить по вложенным» — кликом).

## 40. Дополнение 17. Источник базовой длительности для оценок (29.09.2026)

Развилка «откуда берётся M» при заполнении пустых оценок (профиль ±%). Решение согласовано владельцем 29.09.2026; **в работу пока не запускается** (по слову владельца).

1. **Варианты источника** выбирает пользователь: «Из расчёта (график)» — по умолчанию; «Из маршрута (норма)» — альтернатива; «Из истории (факт)» — задел под блок 6.24, включается, когда появятся завершённые операции.
2. **Из расчёта (график):** M = назначенная последним календарным расчётом длительность **выполнения** операции (учитывает режимы работы, ресурсы, календарь и события — ограничения мощности, простои, форсаж). Берётся **время выполнения, не «от старта до финиша»**: время ожидания в очереди — свойство графика, а не оценки операции; иначе ожидание удвоится в PERT.
3. **Подпись источника обязательна:** у строки видно основу и дату расчёта («из расчёта от 29.09.2026»); при заметной перестройке плана система предупреждает, что оценки сделаны из старого расчёта. Молчаливое смешение оснований не допускается.
4. **Нет расчёта** — вариант «из расчёта» неактивен с подсказкой «сначала „Рассчитать проект“»; при заполнении возможен фолбэк на норму (с соответствующей подписью источника).
5. O и P строятся от M профилем ±% (как сейчас); источник строки — «график».
6. Обоснование: эффективная длительность из календарного расчёта реалистичнее чистой непрерывной нормы, поскольку вбирает режимы, мощности и события (в демо система считает их вклад: «потери 27 дн · выработка 5 дн 2 ч · событий 3»). Ограничение подхода — привязка к текущему состоянию плана, поэтому подпись и напоминания обязательны.

**Связь (открытый вопрос, решение не принято).** Целевая цепочка «CPM → PERT → выравнивание ресурсов → повторный CPM/PERT» и сведение календарного и аналитического контуров в одно расчётное ядро — обсуждались 29.09.2026, зафиксированы как цель; выбор пути (малый шаг через коэффициент календаря / перенос PERT и Монте-Карло на серверный календарный движок) — не сделан.

**Состояние (29.09.2026).** Согласовано, в план внесено (блок 6.17.7). Работы не начаты — ожидают отдельной команды владельца.

## 41. Дополнение 18. Путь расчёта, подсказки и целевые схемы (29.09.2026)

Согласовано владельцем 29.09.2026: схемы — стартовый черновик, возможны уточнения по ходу.

**1. Система подсказок — три слоя.**
- «Путь расчёта» — видимая цепочка шагов со статусами (сделан · сейчас · впереди · требует действия); ведёт сам, без запроса.
- «Подсказки-действия» — в местах нехватки данных: причина + кнопка устранения (например, «Вероятности без оценок не считаются → Заполнить оценки»).
- «Туман подсказок» (Shift+F1 и «?») — остаётся объяснятором: что это, что требуется, что дальше. Не засоряется; расширяется только на новые элементы пути.

**2. Схемы последовательностей для семи режимов.** Черновик (узлы кликабельны, ведут в интерфейс; недоступный шаг объясняет причину и даёт кнопку):

| # | Режим | Цепочка шагов | Результат |
|---|---|---|---|
| 1 | Срок и резервы | Связи → Настройки расчёта (CPM, старт) → Гант: «Рассчитать проект» → Обзор | срок, критический путь, резервы |
| 2 | PERT | Оценки → Связи → PERT → (низкая вероятность → Обзор: Разбор) | интервалы 68/95 %, вклад операций |
| 3 | Монте-Карло | Оценки → Настройки (метод, прогоны) → Монте-Карло → Обзор: цель | p50/p80/p95, вероятность даты |
| 4 | Оба метода | ветки 2 и 3 параллельно → сравнение | два подписанных числа |
| 5 | С ресурсами | Ресурсы и графики → Гант: события мощности → МК с ресурсами | разброс с конфликтами (частично в разработке) |
| 6 | Портфель (CCM) | Общие ресурсы → Настройки (CCM) → Портфель → анализ по выбору | кто кого сдвигает (в разработке) |
| 7 | Буферы | Оценки → PERT/МК → Буферы → правило расхода | проектный/питающие/ресурсные буферы |

Схемы живут из единого источника (карточки режимов); справка не замусоривается — отдельные статьи под режимы не создаются.

**3. Целевая цепочка пересчёта.** «Базовый CPM → O/M/P → PERT/MC → анализ → Leveling → повторный CPM/PERT» — цикл: после выравнивания ресурсов критический путь меняется, пересчёт обязателен; повторять до принятия плана.

```
[Данные и связи] → [Базовый CPM: сеть, календарь, события] → [Оценки O/M/P]
→ [PERT / Монте-Карло: интервалы и вероятности] → [Анализ: цели, разрыв]
→ [Leveling: ресурсы перераспределены] → [Повторный CPM/PERT]
→ изменился путь? → да: назад в «Анализ» (цикл) · нет: план принят
```

**4. Первые шаги реализации из цепочки:** near-critical (операции с малым резервом — в анализ и разбор; дёшево и полезно) и сведение контуров (календарный и вероятностный расчёт — в одно ядро; см. Дополнение 17, «Связь»).

**Состояние (29.09.2026).** Согласовано; схемы — стартовый черновик (уточняются по ходу). В план внесён блок 6.31. Работы начинаются с «Пути расчёта».

## 42. Дополнение 19. Терминология методов и единый сетевой график (30.09.2026)

**Решение (30.09.2026, владелец).**

**1. Имена методов — остаются CPM и CCM.** Переименование не делаем: имена короткие, сквозные и корректны как имена семейства.

**2. Расшифровки для справки и документов.**
- **CPM = критический путь куста.** Строго говоря, наш кустовой расчёт — расширенный CPM: к классическому методу критического пути добавлены ресурсные механизмы класса RCPSP (ресурсно-ограниченное планирование). Для простоты в интерфейсе и документах метод везде называется CPM; справка обязана пояснять это — чтобы не вводить пользователя в заблуждение.
- **CCM = критическая цепь кластера.** Объединение кустов (пул или группа) и совместный расчёт с межзаказными общими ресурсами; защита сроков — буферы. Научный аналог — многопроектная критическая цепь (multi-project critical chain).

**3. Правило разграничения (в справку).** Ресурсы, правящие длительности, — ещё путь; ресурсы, вытесняющие работы, — класс RCPSP; плюс буферы — цепь. Формулировку «ограниченный CCM» не используем; «расширенный CPM» — только вместе с пояснением про RCPSP.

**4. Единый сетевой график.** Вкладки «Сеть CPM» и «CCM» в разделе «Расчёты» объединяются в одну — **«Сетевой график»**: путь каждого куста (CPM); поверх — слой критической цепи кластера (CCM: цепь, буферы, конфликты межзаказных ресурсов; блок 6.20); переключение областей (куст / группа / пул) — в одном месте. CCM остаётся методом оси логики в настройках расчёта; отдельной вкладки не будет.

**Состояние (30.09.2026).** Сделано локально: справка (пояснение про RCPSP, переименования), слияние вкладок в интерфейсе; в общей волне к выкладке.

## 43. Дополнение 20. Модель планирования: метод по объекту, единый таймлайн и маркерные маршруты (30.09.2026)

**Решение (30.09.2026, владелец; пакет подтверждён).** Ядро CCM (методика, алгоритмы, кластер/пул) — не меняется.

**1. Метод определяется объектом, а не настройкой.**
- Простой куст (не в кластере) → CPM. Кластер (даже с одним кустом) → CCM.
- Куст, попавший в кластер, «обнуляет» кустовые расчёты и считается в составе кластера: актуальные цифры — из кластерного расчёта («перекрыт кластером»); история запусков сохраняется; выход из кластера — снова CPM с пересчётом.
- Ручной выбор «логика планирования: CPM/CCM» из настроек расчёта убирается; фактический метод показывается по объекту (полоса контекста). Ось «модель оценки» (без анализа / PERT / Монте-Карло) остаётся выбором. Визард проекта: «режим расчёта» из готовых режимов (правка — отдельно).

**2. Единый таймлайн и сквозная занятость.**
- Все расчёты выводятся вместе, на одной временной плоскости; не накладываются; считаются в учёте друг друга («CPM закончился — начался CCM», и наоборот).
- Каждый расчёт оставляет бронь в общей карте занятости ресурсов; следующий расчёт строится по свободным окнам. Ресурс занят, пока операции не завершены; затем доступен следующему расчёту.
- Семантика брони: базовая — по фактической ёмкости (операции занимают сколько нужно; остаток ёмкости доступен другим); флаг «эксклюзивная бронь» — для случаев «нужен весь кран», «переналадка участка».
- Очередь при конфликте: приоритет заказа (Critical → High → обычные) → ранний старт → FIFO. Порядок виден; ручная перестановка — позже.
- Автоматическая постановка куста: сдвиг куста целиком (внутренняя структура не перетасовывается); если невозможно (жёсткие закрепления, договорная дата) — предупреждение, решение за человеком.

**3. Маркеры и маршрутные версии (группа).**
- Ручная перетасовка операций в группе — инструмент пользователя (шкала куста, магнит, закрепления; реализовано шагами 2.1–2.9).
- Маркеры свободны от маршрута: система не требует соблюдения последовательности маршрута; новый порядок принимается пересчётом; показывается информационная пометка «маршрут перестроен маркерами» (без блокировок).
- Маршрутные версии: **базовый маршрут** (норматив, неприкосновенен, сохраняется всегда) и **маркерный маршрут** (рабочая версия: новый порядок и пересчитанные длительности — длительности меняются календарём и событиями мощности в новых датах). После пересчёта маркерный фиксируется; дальнейшие расчёты — по нему; сброс к базовому — отдельным действием.
- Новый тип маркера: «начать после завершения операции X» — кросс-кустовая живая связь (общий ресурс не обязателен; линия на шкале; сдвиг X пересчитывает зависимую операцию). Дополняет существующий якорь «конец чужой операции на общем ресурсе».

**4. Тарифное направление (для биллинга; в работу позже).**
- Гейтим возможности, а не метод: базовый — кусты (CPM) и группы; проф — кластеры и CCM; максимальный — портфель, интеграции, ИИ.
- Конфликты общих ресурсов видны на всех уровнях (апселл «снимается в Проф»); понижение тарифа — заморозка кластеров без удаления данных, расчёт — CPM с честной пометкой.
- До продаж ПРОФ — обязательства по данным: импорт ресурсов и мощностей, подсказки заполнения, возможна услуга первичной настройки. Границы ступеней и лимиты — решить при проектировании биллинга.

**5. Приоритеты (30.09.2026).**
- Факт и калибровка (цикл «план → факт → калибровка → точнее план») — следующий крупный приоритет после текущей очереди; детали — отдельным обсуждением.
- Материалы и поставки — остаются в заделе Heavy CCM (поднять по сегменту); роли и права — к первым пилотам; данные для CCM — до продаж ПРОФ.

**6. Терминология (гигиена).** «Пул» → «кластер» (легаси-синоним, сверить в интерфейсе); «закрепление» (маркер операции) ≠ «фиксация дат» (цели); аббревиатуры CPM/CCM — для документации и тарифной страницы, в интерфейсе — формулировки по задачам.

**Состояние (30.09.2026).** Модель зафиксирована; в план добавлены блоки 6.32–6.33; снятие переключателя метода — ближайшая правка настроек. Код — по очереди; выкладка — по команде владельца.

## 44. Дополнение 21. Аккаунты, организации и доступы (01.10.2026)

**Решение (01.10.2026, владелец).** Учётные записи и «рабочие зоны» организаций ведутся **внутри продукта** — собственная админка; внешняя CMS (Joomla и подобные) для аккаунтов не используется. CMS может применяться только для публичного сайта; кнопки «Войти» и «Создать компанию» на сайте — ссылки в приложение.

**1. Обоснование.** У продукта уже есть собственный контур доступа: организации (арендаторы), пользователи, роли, выбор компании при входе, изоляция данных по организации. Внешняя CMS дала бы второй источник правды (синхронизация, мост, лишняя поверхность атаки), при этом роли, приглашения, тарифы и биллинг живут в продукте (PO-01, PO-25).

**2. Что уже есть (фундамент, проверено 01.10.2026).** Организации и пользователи с ролями: владелец, администратор, планировщик, наблюдатель; регистрация создаёт организацию и владельца; вход, обновление токена, выбор компании при нескольких организациях; почта (SMTP) для писем-приглашений.

**3. Фазы (блок 6.34 в плане).**
- Фаза 1 (к первым пилотам): экраны входа и регистрации в приложении; раздел «Команда» — список сотрудников, приглашение по email, роли, отключение доступа.
- Фаза 2: операторский кабинет вендора — организации, пробный период, план, отключение, активность.
- Фаза 3: биллинг (тарифы, ЮKassa и СБП) — после первых пилотов (связь PO-01/PO-25).

**4. Открытые вопросы фазы 1 (решает владелец).** Свободная регистрация или «по заявке» (рекомендация — «по заявке» на период пилотов); приглашение сотрудника письмом со ссылкой или пароль от администратора (рекомендация — письмо); матрица прав ролей (PO-23) — согласовать до пилотов.

**Состояние (01.10.2026).** Решение зафиксировано; в план введён блок 6.34 со связями PO-21/PO-23/PO-25. Запись 27.09.2026 «прежние адреса входа ведут в рабочую область» дополняется: экраны входа и регистрации создаются как часть рабочей области; старые адреса сохраняют перенаправление.

