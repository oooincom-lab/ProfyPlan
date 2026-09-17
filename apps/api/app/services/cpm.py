"""
CPM-движок: прямой/обратный проход, резервы, критический путь.
Поддерживает FS/FF/SS/SF зависимости с lag.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID


@dataclass
class OperationNode:
    """Узел сетевого графа — операция с расчётными полями."""
    id: UUID
    name: str
    duration: Decimal  # чистая длительность (без setup/teardown)
    setup_time: Decimal = Decimal("0")
    teardown_time: Decimal = Decimal("0")

    # Расчётные поля
    early_start: Decimal = Decimal("0")
    early_finish: Decimal = Decimal("0")
    late_start: Decimal = Decimal("0")
    late_finish: Decimal = Decimal("0")
    total_float: Decimal = Decimal("0")
    free_float: Decimal = Decimal("0")
    is_critical: bool = False

    @property
    def total_duration(self) -> Decimal:
        """Общая длительность с учётом setup/teardown."""
        return self.duration + self.setup_time + self.teardown_time


@dataclass
class Dependency:
    """Связь между операциями."""
    predecessor_id: UUID
    successor_id: UUID
    dep_type: str  # FS / FF / SS / SF
    lag: Decimal = Decimal("0")


@dataclass
class CPMResult:
    """Результат расчёта CPM."""
    nodes: dict[str, OperationNode]
    critical_path: list[str]        # самая длинная упорядоченная критическая цепочка
    total_duration: Decimal
    project_early_start: Decimal = Decimal("0")
    project_early_finish: Decimal = Decimal("0")
    critical_paths: list[list[str]] = field(default_factory=list)  # все ветви критического пути


def calculate_cpm(
    operations: list[dict],
    dependencies: list[dict],
    constraints: dict | None = None,
) -> CPMResult:
    """
    Расчёт критического пути.

    operations: [{id, name, duration_base, setup_time, teardown_time}, ...]
    dependencies: [{predecessor_id, successor_id, dependency_type, lag_time}, ...]
    constraints: {operation_id: {"min_start": число|None, "max_finish": число|None}} —
        закрепления операций (шаг 2.2): «начать не раньше» задаёт нижнюю границу старта,
        «закончить к / не позже» — верхнюю границу финиша. Закреплённая операция
        перестаёт «сдвигаться» под влиянием предшественников ниже/позже этих границ.

    Возвращает: CPMResult с узлами, критическим путём и общей длительностью.
    """
    # 1. Строим узлы
    nodes: dict[str, OperationNode] = {}
    for op in operations:
        node = OperationNode(
            id=UUID(op["id"]) if isinstance(op["id"], str) else op["id"],
            name=op["name"],
            duration=Decimal(str(op.get("duration_base", 0))),
            setup_time=Decimal(str(op.get("setup_time", 0))),
            teardown_time=Decimal(str(op.get("teardown_time", 0))),
        )
        nodes[str(node.id)] = node

    # 2. Строим списки предшественников/последователей
    predecessors: dict[str, list[Dependency]] = {nid: [] for nid in nodes}
    successors: dict[str, list[Dependency]] = {nid: [] for nid in nodes}

    for dep in dependencies:
        dep_obj = Dependency(
            predecessor_id=UUID(dep["predecessor_id"]) if isinstance(dep["predecessor_id"], str) else dep["predecessor_id"],
            successor_id=UUID(dep["successor_id"]) if isinstance(dep["successor_id"], str) else dep["successor_id"],
            dep_type=dep.get("dependency_type", "FS"),
            lag=Decimal(str(dep.get("lag_time", 0))),
        )
        pid = str(dep_obj.predecessor_id)
        sid = str(dep_obj.successor_id)
        if pid in nodes and sid in nodes:
            predecessors[sid].append(dep_obj)
            successors[pid].append(dep_obj)

    # 3. Прямой проход (Forward Pass) — топологический порядок
    sorted_ids = _topological_sort(nodes, predecessors)
    if sorted_ids is None:
        raise ValueError("Обнаружен цикл в зависимостях — расчёт CPM невозможен")

    for nid in sorted_ids:
        node = nodes[nid]
        node.early_start = Decimal("0")

        for dep in predecessors[nid]:
            pred = nodes[str(dep.predecessor_id)]
            es_candidate = _forward_shift(pred, node, dep)
            node.early_start = max(node.early_start, es_candidate)

        _c = (constraints or {}).get(nid)
        if _c and _c.get("min_start") is not None:
            node.early_start = max(node.early_start, Decimal(str(_c["min_start"])))

        node.early_finish = node.early_start + node.total_duration

    # 4. Определяем длительность проекта
    if sorted_ids:
        project_duration = max(n.early_finish for n in nodes.values())
    else:
        project_duration = Decimal("0")

    # 5. Обратный проход (Backward Pass)
    for nid in reversed(sorted_ids):
        node = nodes[nid]
        node.late_finish = project_duration

        for dep in successors[nid]:
            succ = nodes[str(dep.successor_id)]
            lf_candidate = _backward_shift(node, succ, dep)
            node.late_finish = min(node.late_finish, lf_candidate)

        _c2 = (constraints or {}).get(nid)
        if _c2 and _c2.get("max_finish") is not None:
            node.late_finish = min(node.late_finish, Decimal(str(_c2["max_finish"])))

        node.late_start = node.late_finish - node.total_duration

    # 6. Расчёт резервов и определение критического пути
    critical_path_ids: list[str] = []
    for node in nodes.values():
        node.total_float = node.late_finish - node.early_finish
        # Свободный резерв: на сколько можно задержать операцию, не сдвигая
        # ни одного последователя — считается по типу связи.
        if successors[str(node.id)]:
            free_float = None
            for dep in successors[str(node.id)]:
                succ = nodes[str(dep.successor_id)]
                slack = _free_float_slack(node, succ, dep)
                free_float = slack if free_float is None else min(free_float, slack)
            node.free_float = max(Decimal("0"), free_float)
        else:
            node.free_float = max(Decimal("0"), project_duration - node.early_finish)

        # Критический путь: total_float == 0
        if node.total_float <= Decimal("0"):
            node.is_critical = True
            critical_path_ids.append(str(node.id))

    # Критический путь как путь: упорядоченная цепочка по «плотным» связям.
    # Узлов с нулевым резервом может быть несколько ветвей — отдаём их списком,
    # а в critical_path кладём самую длинную цепочку (совместимость с прежним API).
    chains = _critical_chains(nodes, successors)
    longest = max(chains, key=len) if chains else critical_path_ids

    return CPMResult(
        nodes=nodes,
        critical_path=longest,
        critical_paths=chains,
        total_duration=project_duration,
        project_early_start=Decimal("0"),
        project_early_finish=project_duration,
    )


def _forward_shift(pred: OperationNode, succ: OperationNode, dep: Dependency) -> Decimal:
    """Нижняя граница раннего старта последователя (прямой проход).

    FS: финиш последователя после финиша предшественника;
    SS: старт последователя после старта предшественника;
    FF: финиш последователя после финиша предшественника — значит, старт
        последователя не раньше, чем этот финиш минус его собственная длительность;
    SF: финиш последователя после старта предшественника — то же со старта.
    """
    if dep.dep_type == "FS":
        return pred.early_finish + dep.lag
    if dep.dep_type == "SS":
        return pred.early_start + dep.lag
    if dep.dep_type == "FF":
        return pred.early_finish + dep.lag - succ.total_duration
    if dep.dep_type == "SF":
        return pred.early_start + dep.lag - succ.total_duration
    return pred.early_finish + dep.lag


def _backward_shift(pred: OperationNode, succ: OperationNode, dep: Dependency) -> Decimal:
    """Верхняя граница позднего финиша предшественника (обратный проход)."""
    if dep.dep_type == "FS":
        return succ.late_start - dep.lag
    if dep.dep_type == "FF":
        return succ.late_finish - dep.lag
    if dep.dep_type == "SS":
        return succ.late_start - dep.lag + pred.total_duration
    if dep.dep_type == "SF":
        return succ.late_finish - dep.lag + pred.total_duration
    return succ.late_start - dep.lag


def _free_float_slack(pred: OperationNode, succ: OperationNode, dep: Dependency) -> Decimal:
    """Насколько можно сдвинуть предшественника, не тронув последователя."""
    if dep.dep_type == "FS":
        return succ.early_start - dep.lag - pred.early_finish
    if dep.dep_type == "FF":
        return succ.early_finish - dep.lag - pred.early_finish
    if dep.dep_type == "SS":
        return succ.early_start - dep.lag - pred.early_start
    if dep.dep_type == "SF":
        return succ.early_finish - dep.lag - pred.early_start
    return succ.early_start - dep.lag - pred.early_finish


def _link_is_tight(pred: OperationNode, succ: OperationNode, dep: Dependency) -> bool:
    """Связь «держит» последователя: он стартует ровно на границе ограничения."""
    eps = Decimal("0.001")
    if dep.dep_type == "FS":
        bound = pred.early_finish + dep.lag
    elif dep.dep_type == "SS":
        bound = pred.early_start + dep.lag
    elif dep.dep_type == "FF":
        bound = pred.early_finish + dep.lag - succ.total_duration
    else:
        bound = pred.early_start + dep.lag - succ.total_duration
    return abs(succ.early_start - bound) <= eps


def _critical_chains(nodes: dict, successors: dict) -> list:
    """Упорядоченные критические цепочки.

    Идём только по «плотным» связям между операциями с нулевым резервом — так
    получается путь, а не просто список. Ветвей может быть несколько: каждая
    начинается с критической операции, у которой нет критического предшественника
    по плотной связи.
    """
    eps = Decimal("0.001")
    critical = {nid for nid, n in nodes.items() if n.total_float <= eps}
    tight_in: dict = {}
    for pid, deps in successors.items():
        if pid not in critical:
            continue
        for dep in deps:
            sid = str(dep.successor_id)
            if sid in critical and _link_is_tight(nodes[pid], nodes[sid], dep):
                tight_in.setdefault(sid, []).append(pid)

    chains: list = []
    for start in sorted(critical, key=lambda nid: (nodes[nid].early_start, nodes[nid].name)):
        if tight_in.get(start):
            continue
        chain, seen, current = [], {start}, start
        while current is not None:
            chain.append(current)
            nxt = None
            for dep in successors.get(current, []):
                sid = str(dep.successor_id)
                if sid in critical and sid not in seen and _link_is_tight(nodes[current], nodes[sid], dep):
                    nxt = sid
                    break
            if nxt:
                seen.add(nxt)
            current = nxt
        chains.append(chain)

    # страховка: критическая операция без плотных связей (одиночка)
    covered = {nid for chain in chains for nid in chain}
    for nid in sorted(critical - covered, key=lambda x: nodes[x].early_start):
        chains.append([nid])
    chains.sort(key=lambda ch: (nodes[ch[0]].early_start, -len(ch)))
    return chains


def _topological_sort(
    nodes: dict[str, OperationNode],
    predecessors: dict[str, list[Dependency]],
) -> Optional[list[str]]:
    """
    Топологическая сортировка (алгоритм Кана).
    Возвращает None при обнаружении цикла.
    """
    in_degree = {nid: len([d for d in deps if str(d.predecessor_id) in nodes])
                 for nid, deps in predecessors.items()}

    queue = [nid for nid, degree in in_degree.items() if degree == 0]
    result = []

    while queue:
        nid = queue.pop(0)
        result.append(nid)
        for dep in [d for k, v in predecessors.items()
                    for d in v if str(d.predecessor_id) == nid and str(d.successor_id) in in_degree]:
            sid = str(dep.successor_id)
            in_degree[sid] -= 1
            if in_degree[sid] == 0:
                queue.append(sid)

    if len(result) != len(nodes):
        return None  # цикл
    return result
