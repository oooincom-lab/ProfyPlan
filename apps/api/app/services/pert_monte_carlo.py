"""
PERT + Monte Carlo Simulation — вероятностное планирование.

PERT (Program Evaluation and Review Technique):
  - Ожидаемая длительность: (O + 4*ML + P) / 6
  - Стандартное отклонение: (P - O) / 6
  - Дисперсия: SD^2

Monte Carlo:
  - Beta-PERT распределение для каждой операции
  - N итераций CPM-расчёта
  - Доверительные интервалы: P50, P80, P90, P95
  - S-кривая вероятности завершения
"""
import math
import random
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


@dataclass
class PERTOperation:
    """Операция с PERT-оценками."""
    id: str
    name: str
    optimistic: float   # O — оптимистичная
    most_likely: float  # ML — наиболее вероятная
    pessimistic: float  # P — пессимистичная
    expected: float     # (O + 4ML + P) / 6
    std_dev: float      # (P - O) / 6
    variance: float     # std_dev^2


@dataclass
class PERTResult:
    """Результат PERT-анализа."""
    project_id: str
    operations: list[PERTOperation]
    critical_path: list[str]
    total_expected: float      # сумма ожидаемых длительностей критпути
    total_std_dev: float       # sqrt суммы дисперсий критпути
    total_variance: float
    confidence_68_low: float   # expected - 1*SD
    confidence_68_high: float  # expected + 1*SD
    confidence_95_low: float   # expected - 2*SD
    confidence_95_high: float  # expected + 2*SD
    warnings: list[str] = field(default_factory=list)


@dataclass
class MonteCarloResult:
    """Результат Монте-Карло симуляции."""
    project_id: str
    iterations: int
    durations: list[float]     # все длительности (для гистограммы)
    p50: float                 # медиана
    p80: float
    p90: float
    p95: float
    p99: float
    mean: float
    std_dev: float
    min_duration: float
    max_duration: float
    s_curve: list[dict]        # [{completion_date, probability}, ...]
    deterministic_duration: float  # детерминированный CPM для сравнения
    warnings: list[str] = field(default_factory=list)


def calculate_pert(
    operations: list[dict],
    dependencies: list[dict],
) -> PERTResult:
    """
    PERT-анализ проекта.

    operations: [{id, name, to_optimistic, tm_likely, tp_pessimistic}, ...]
      Для операций без PERT-оценок используется duration_base как O=ML=P.
    dependencies: [{predecessor_id, successor_id, dependency_type, lag_time}, ...]

    Возвращает PERTResult с ожидаемыми длительностями и доверительными интервалами.
    """
    pert_ops: list[PERTOperation] = []
    warnings: list[str] = []
    missing_pert = 0

    for op in operations:
        o = op.get("to_optimistic") or op.get("duration_base", 1)
        ml = op.get("tm_likely") or op.get("duration_base", 1)
        p = op.get("tp_pessimistic") or op.get("duration_base", 1)

        try:
            o = float(o)
            ml = float(ml)
            p = float(p)
        except (TypeError, ValueError):
            o = ml = p = float(op.get("duration_base", 1))

        if o == ml == p:
            missing_pert += 1

        expected = (o + 4 * ml + p) / 6.0
        std_dev = (p - o) / 6.0
        variance = std_dev * std_dev

        pert_ops.append(PERTOperation(
            id=str(op["id"]),
            name=op.get("name", "?"),
            optimistic=o,
            most_likely=ml,
            pessimistic=p,
            expected=expected,
            std_dev=std_dev,
            variance=variance,
        ))

    if missing_pert > 0:
        warnings.append(
            f"{missing_pert} из {len(operations)} операций не имеют PERT-оценок "
            f"(использована детерминированная длительность)"
        )

    # Строим CPM на ожидаемых длительностях
    expected_ops = [
        {
            "id": po.id,
            "name": po.name,
            "duration_base": po.expected,
            "setup_time": 0,
            "teardown_time": 0,
        }
        for po in pert_ops
    ]

    try:
        from app.services.cpm import calculate_cpm
        cpm_result = calculate_cpm(expected_ops, dependencies)
    except ImportError:
        # Fallback: простой расчёт без зависимостей
        cpm_result = _simple_cpm(expected_ops)

    # Суммируем дисперсии по критическому пути
    pert_by_id = {po.id: po for po in pert_ops}
    total_variance = 0.0
    for nid in cpm_result.critical_path:
        po = pert_by_id.get(nid)
        if po:
            total_variance += po.variance

    total_std_dev = math.sqrt(total_variance)
    total_expected = float(cpm_result.total_duration)

    return PERTResult(
        project_id="",
        operations=pert_ops,
        critical_path=cpm_result.critical_path,
        total_expected=total_expected,
        total_std_dev=total_std_dev,
        total_variance=total_variance,
        confidence_68_low=total_expected - total_std_dev,
        confidence_68_high=total_expected + total_std_dev,
        confidence_95_low=total_expected - 2 * total_std_dev,
        confidence_95_high=total_expected + 2 * total_std_dev,
        warnings=warnings,
    )


def run_monte_carlo(
    operations: list[dict],
    dependencies: list[dict],
    iterations: int = 10000,
    seed: Optional[int] = None,
) -> MonteCarloResult:
    """
    Монте-Карло симуляция проекта.

    Для каждой итерации:
      1. Семплируем длительности из Beta-PERT для каждой операции
      2. Запускаем CPM
      3. Записываем общую длительность

    Возвращает распределение длительностей, процентили и S-кривую.
    """
    if seed is not None:
        random.seed(seed)

    # Подготавливаем PERT-параметры
    pert_params: list[dict] = []
    missing_pert = 0
    for op in operations:
        o = float(op.get("to_optimistic") or op.get("duration_base", 1))
        ml = float(op.get("tm_likely") or op.get("duration_base", 1))
        p = float(op.get("tp_pessimistic") or op.get("duration_base", 1))
        if o == ml == p:
            missing_pert += 1
        pert_params.append({
            "id": str(op["id"]),
            "name": op.get("name", "?"),
            "o": o, "ml": ml, "p": p,
        })

    # Детерминированный CPM
    det_ops = [
        {"id": pp["id"], "name": pp["name"],
         "duration_base": (pp["o"] + 4*pp["ml"] + pp["p"]) / 6,
         "setup_time": 0, "teardown_time": 0}
        for pp in pert_params
    ]
    try:
        from app.services.cpm import calculate_cpm
        det_result = calculate_cpm(det_ops, dependencies)
        det_duration = float(det_result.total_duration)
    except ImportError:
        det_duration = sum(d["duration_base"] for d in det_ops)

    # Монте-Карло
    durations: list[float] = []
    warnings: list[str] = []

    for _ in range(iterations):
        sim_ops = [
            {
                "id": pp["id"],
                "name": pp["name"],
                "duration_base": _sample_beta_pert(pp["o"], pp["ml"], pp["p"]),
                "setup_time": 0,
                "teardown_time": 0,
            }
            for pp in pert_params
        ]
        try:
            from app.services.cpm import calculate_cpm
            sim_result = calculate_cpm(sim_ops, dependencies)
            durations.append(float(sim_result.total_duration))
        except (ImportError, ValueError):
            durations.append(sum(d["duration_base"] for d in sim_ops))

    durations.sort()

    if missing_pert > 0:
        warnings.append(
            f"{missing_pert} из {len(operations)} операций без PERT-оценок "
            f"(семплирование даст нулевую дисперсию)"
        )

    # Процентили
    def percentile(data: list[float], pct: float) -> float:
        if not data:
            return 0.0
        idx = int(math.ceil(pct / 100.0 * len(data))) - 1
        return data[max(0, min(idx, len(data) - 1))]

    mean_val = sum(durations) / len(durations) if durations else 0.0
    variance = sum((d - mean_val) ** 2 for d in durations) / len(durations) if durations else 0.0

    # S-кривая: 50 точек от min до max
    s_curve: list[dict] = []
    if durations and len(durations) > 1:
        step = (durations[-1] - durations[0]) / 50
        current = durations[0]
        for _ in range(51):
            count_below = sum(1 for d in durations if d <= current)
            prob = count_below / len(durations)
            s_curve.append({
                "duration": round(current, 2),
                "probability": round(prob, 4),
            })
            current += step

    return MonteCarloResult(
        project_id="",
        iterations=iterations,
        durations=durations,
        p50=percentile(durations, 50),
        p80=percentile(durations, 80),
        p90=percentile(durations, 90),
        p95=percentile(durations, 95),
        p99=percentile(durations, 99),
        mean=round(mean_val, 2),
        std_dev=round(math.sqrt(variance), 2),
        min_duration=durations[0] if durations else 0.0,
        max_duration=durations[-1] if durations else 0.0,
        s_curve=s_curve,
        deterministic_duration=round(det_duration, 2),
        warnings=warnings,
    )


def _sample_beta_pert(o: float, ml: float, p: float) -> float:
    """
    Семплирование из Beta-PERT распределения.

    Использует аппроксимацию через параметризованное бета-распределение:
      alpha = 1 + 4 * (ml - o) / (p - o)
      beta  = 1 + 4 * (p - ml) / (p - o)
    Затем: o + (p - o) * Beta(alpha, beta)
    """
    if p <= o:
        return ml

    alpha = 1.0 + 4.0 * (ml - o) / (p - o)
    beta = 1.0 + 4.0 * (p - ml) / (p - o)

    # Метод принятия-отклонения для Beta
    # Аппроксимация через гамма-распределение
    x = _gamma_sample(alpha) / (_gamma_sample(alpha) + _gamma_sample(beta))
    return o + (p - o) * x


def _gamma_sample(shape: float) -> float:
    """
    Семплирование из Gamma(shape, 1) методом Марсальи-Цанга
    для shape >= 1.
    """
    if shape < 1:
        # Для shape < 1 используем метод Джонка
        u = random.random()
        return _gamma_sample(shape + 1) * (u ** (1.0 / shape))

    d = shape - 1.0 / 3.0
    c = 1.0 / math.sqrt(9.0 * d)

    while True:
        x = random.gauss(0, 1)
        v = (1 + c * x) ** 3
        if v <= 0:
            continue
        u = random.random()
        if u < 1 - 0.0331 * (x ** 4):
            return d * v
        if math.log(u) < 0.5 * x * x + d * (1 - v + math.log(v)):
            return d * v


def _simple_cpm(ops: list[dict]):
    """Заглушка CPM когда модуль недоступен."""
    class _SimpleResult:
        def __init__(self, ops):
            self.total_duration = sum(o["duration_base"] for o in ops)
            self.critical_path = [o["id"] for o in ops]
            self.nodes = {}
    return _SimpleResult(ops)
