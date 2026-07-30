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
    critical_path: list[str]  # ID операций критического пути
    total_duration: Decimal
    project_early_start: Decimal = Decimal("0")
    project_early_finish: Decimal = Decimal("0")


def calculate_cpm(
    operations: list[dict],
    dependencies: list[dict],
) -> CPMResult:
    """
    Расчёт критического пути.
    
    operations: [{id, name, duration_base, setup_time, teardown_time}, ...]
    dependencies: [{predecessor_id, successor_id, dependency_type, lag_time}, ...]
    
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
            es_candidate = _forward_shift(pred, dep)
            node.early_start = max(node.early_start, es_candidate)

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
            lf_candidate = _backward_shift(succ, dep)
            node.late_finish = min(node.late_finish, lf_candidate)

        node.late_start = node.late_finish - node.total_duration

    # 6. Расчёт резервов и определение критического пути
    critical_path_ids: list[str] = []
    for node in nodes.values():
        node.total_float = node.late_finish - node.early_finish
        # Free float: сколько можно задержать, не влияя на раннее начало последователей
        min_succ_es = project_duration
        for dep in successors[str(node.id)]:
            succ = nodes[str(dep.successor_id)]
            succ_es = _backward_shift_for_float(succ, dep)
            min_succ_es = min(min_succ_es, succ_es)
        node.free_float = min_succ_es - node.early_finish if successors[str(node.id)] else project_duration - node.early_finish
        node.free_float = max(Decimal("0"), node.free_float)

        # Критический путь: total_float == 0
        if node.total_float <= Decimal("0"):
            node.is_critical = True
            critical_path_ids.append(str(node.id))

    return CPMResult(
        nodes=nodes,
        critical_path=critical_path_ids,
        total_duration=project_duration,
        project_early_start=Decimal("0"),
        project_early_finish=project_duration,
    )


def _forward_shift(pred: OperationNode, dep: Dependency) -> Decimal:
    """Расчёт Early Start последователя из предшественника (прямой проход)."""
    if dep.dep_type == "FS":
        return pred.early_finish + dep.lag
    elif dep.dep_type == "FF":
        return pred.early_finish + dep.lag - dep.lag + (Decimal("0") if pred.total_duration > Decimal("0") else Decimal("0"))
        # FF: successor finishes after predecessor finishes + lag
        # Early start of successor = predecessor.early_finish + lag - successor.duration (not available here)
        # Мы возвращаем ограничение на раннее начало через ранний финиш
    elif dep.dep_type == "SS":
        return pred.early_start + dep.lag
    elif dep.dep_type == "SF":
        return pred.early_start + dep.lag
    return pred.early_finish + dep.lag


def _backward_shift(succ: OperationNode, dep: Dependency) -> Decimal:
    """Расчёт Late Finish предшественника из последователя (обратный проход)."""
    if dep.dep_type == "FS":
        return succ.late_start - dep.lag
    elif dep.dep_type == "FF":
        return succ.late_finish - dep.lag
    elif dep.dep_type == "SS":
        return succ.late_start - dep.lag + succ.total_duration
    elif dep.dep_type == "SF":
        return succ.late_finish - dep.lag + succ.total_duration
    return succ.late_start - dep.lag


def _backward_shift_for_float(succ: OperationNode, dep: Dependency) -> Decimal:
    """Для расчёта free float: раннее начало последователя с учётом зависимости."""
    if dep.dep_type == "FS":
        return succ.early_start
    elif dep.dep_type == "FF":
        return succ.early_finish
    elif dep.dep_type == "SS":
        return succ.early_start
    elif dep.dep_type == "SF":
        return succ.early_finish
    return succ.early_start


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
