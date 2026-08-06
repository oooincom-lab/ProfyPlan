# ProfyPlan CCM — Спецификация архитектуры (План + Динамика)

> Версия: 2.0 | Дата: 2026-08-06 | Статус: реализовано (CPM Lite + Resource Leveling), проектируется (Heavy CCM)

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
└── batch_group_key     → str | None (ключ группировки для batch scheduling)
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

## 9. Формат импорта: трёхвкладочный Excel

### Вкладка 1: Заказы (Orders)
Плоская таблица — каждая строка = один заказ.

| Заказ ID | Продукт | Спецификация | Кол-во | Старт | Срок | Приоритет | Клиент |
|---|---|---|---|---|---|---|---|
| P1 | Редуктор Р-200 | SPEC-001 | 100 | 01.08.26 | 25.08.26 | high | СибСтрой |

### Вкладка 2: Состав (BOM)
Плоская parent-child таблица. Любая глубина вложенности.

| Спецификация | Узел ID | Родитель | Тип | Номенклатура | Ед. | Норма на 1 | Срок поставки |
|---|---|---|---|---|---|---|---|
| SPEC-001 | 1 | — | assembly | Редуктор Р-200 | шт | 1 | — |
| SPEC-001 | 1.1 | 1 | assembly | Корпус в сборе | шт | 1 | — |
| SPEC-001 | 1.1.1 | 1.1 | material | Чугун СЧ20 | кг | 45 | 10 дн |

**Типы:** assembly / semi_finished / material / phantom

### Вкладка 3: Маршруты (Routes)
Каждая строка = одна операция. Связь с BOM через «Узел ID».

| Узел ID | № оп. | Операция | Станок | Длит., ч | Предш. оп. | Доп. материал | Расход | Выход годного |
|---|---|---|---|---|---|---|---|---|
| 1.1.1 | 1 | Формовка | CNC-01 | 2 | — | Стержни | 8 кг | 0.98 |

### Правила импорта
1. **Частичная загрузка:** можно импортировать только Вкладку 1, если спецификации уже в базе
2. **Сохранение спецификаций:** импортированный BOM + маршруты сохраняются как справочник для будущих заказов
3. **Валидация:** перед построением графа проверяются оборванные ссылки, циклы в BOM, отсутствие маршрутов у make-узлов. Ошибки — не блокирующие, выводятся предупреждением
4. **ext_id:** колонка «Внешний ID» сохраняется во всех сущностях для обратной интеграции

### Источники данных для автогенерации
- **1С УНФ:** Вкладка 1 → документ «Заказ на производство»; Вкладка 2 → регистр «Спецификации номенклатуры»; Вкладка 3 → «НСИ → Технологические операции»
- **Google Sheets:** ручное заполнение или скрипт Export → Sheets
- **Ручной ввод:** отдельный UI-мастер на фронтенде

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
    "resource": "CNC-01",
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
   - Предложение: «Добавить смену», «Перенести на другой станок», «Аутсорсинг»
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

---

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

---

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

### Level 2 — Excel Import + CPM Frontend (🔲 СЛЕДУЮЩИЙ)
1. **Excel-импорт (трёхвкладочный)** — замыкает контур «данные → расчёт → визуализация»
2. **CPM React Flow** — миграция с iframe на живой граф
3. **Ганта** — базовая диаграмма (read-only)
4. **E2E-тест на VPS** — прогнать реальные данные через импорт → CPM → CCM → resource-leveling

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
