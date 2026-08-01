"""
E2E-тест CCM-алгоритмов без БД.
Запуск: python test_ccm_algorithms.py
"""
import sys, os
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'apps', 'api'))
from app.services.cpm import calculate_cpm

# Генератор UUID из строки
def uid(name: str) -> str:
    return str(uuid4())  # новый UUID для каждого вызова

# Стабильные UUID
ids = {}
def sid(name: str) -> str:
    if name not in ids:
        ids[name] = str(uuid4())
    return ids[name]


def test_cpm_basic():
    print("=" * 60)
    print("TEST 1: Basic CPM - Project P1")
    print("=" * 60)

    ops = [
        {"id": sid("p1_steel"), "name": "Steel procurement (2400 kg)", "duration_base": 336},
        {"id": sid("p1_iron"), "name": "Iron procurement (4500 kg)", "duration_base": 240},
        {"id": sid("p1_bearing"), "name": "Bearing (400 pcs)", "duration_base": 168},
        {"id": sid("p1_turn"), "name": "Turning: Shaft (200 pcs)", "duration_base": 800, "setup_time": 1},
        {"id": sid("p1_heat"), "name": "Heat treatment: Shaft", "duration_base": 600, "setup_time": 0.5},
        {"id": sid("p1_grind"), "name": "Grinding: Shaft", "duration_base": 300, "setup_time": 0.5},
        {"id": sid("p1_mill"), "name": "Milling: Housing (100 pcs)", "duration_base": 400, "setup_time": 1},
        {"id": sid("p1_drill"), "name": "Drilling: Housing", "duration_base": 150, "setup_time": 0.5},
        {"id": sid("p1_assy"), "name": "Assembly", "duration_base": 600},
        {"id": sid("p1_test"), "name": "Testing", "duration_base": 200},
    ]

    deps = [
        (sid("p1_steel"), sid("p1_turn")),
        (sid("p1_turn"), sid("p1_heat")),
        (sid("p1_heat"), sid("p1_grind")),
        (sid("p1_iron"), sid("p1_mill")),
        (sid("p1_mill"), sid("p1_drill")),
        (sid("p1_grind"), sid("p1_assy")),
        (sid("p1_drill"), sid("p1_assy")),
        (sid("p1_bearing"), sid("p1_assy")),
        (sid("p1_assy"), sid("p1_test")),
    ]
    deps_fmt = [{"predecessor_id": a, "successor_id": b, "dependency_type": "FS", "lag_time": 0}
                for a, b in deps]

    r = calculate_cpm(ops, deps_fmt)

    print(f"  Operations: {len(r.nodes)}")
    print(f"  Critical: {len(r.critical_path)}")
    print(f"  Total duration: {float(r.total_duration):.0f} hrs")
    print()

    for nid, n in r.nodes.items():
        marker = "CRIT" if n.is_critical else ""
        print(f"  {n.name:<35} ES={float(n.early_start):>5.0f} EF={float(n.early_finish):>5.0f} "
              f"LS={float(n.late_start):>5.0f} LF={float(n.late_finish):>5.0f} TF={float(n.total_float):>5.0f} {marker}")

    assert len(r.nodes) == 10
    assert len(r.critical_path) > 0
    # Critical path: steel(336) > turn(801) > heat(600.5) > grind(300.5) > assy(600) > test(200) = 2838
    expected = 336 + 801 + 600.5 + 300.5 + 600 + 200
    assert abs(float(r.total_duration) - expected) < 1
    print(f"\n  OK: expected {expected:.0f} hrs, got {float(r.total_duration):.0f} hrs")


def test_multi_project():
    print("\n" + "=" * 60)
    print("TEST 2: Multi-Project Merge (3 projects)")
    print("=" * 60)

    all_ops = []
    all_deps = []

    for prefix, count in [("p1", 8), ("p2", 8), ("p3", 6)]:
        seq = [("steel", f"{prefix.upper()}: Steel", 336),
               ("turn", f"{prefix.upper()}: Turning", 400 + 1 * (3 - len(prefix))),
               ("heat", f"{prefix.upper()}: Heat", 300 + 0.5),
               ("grind", f"{prefix.upper()}: Grind", 150 + 0.5)]
        if prefix != "p3":
            seq += [("mill", f"{prefix.upper()}: Mill", 200 + 1),
                    ("drill", f"{prefix.upper()}: Drill", 75 + 0.5)]
        seq += [("assy", f"{prefix.upper()}: Assembly", 300),
                ("test", f"{prefix.upper()}: Test", 100)]

        prev_id = None
        for oid, name, dur in seq:
            uid = sid(f"{prefix}_{oid}")
            all_ops.append({"id": uid, "name": name, "duration_base": dur})
            if prev_id:
                all_deps.append({"predecessor_id": prev_id, "successor_id": uid,
                                 "dependency_type": "FS", "lag_time": 0})
            prev_id = uid

    # Inter-project deps: P1 turn -> P2 turn -> P3 turn (shared CNC)
    all_deps.append({"predecessor_id": sid("p1_turn"), "successor_id": sid("p2_turn"),
                     "dependency_type": "FS", "lag_time": 0})
    all_deps.append({"predecessor_id": sid("p2_turn"), "successor_id": sid("p3_turn"),
                     "dependency_type": "FS", "lag_time": 0})

    r = calculate_cpm(all_ops, all_deps)

    assert len(r.nodes) == 22
    assert len(r.critical_path) > 0
    print(f"  Total operations: {len(r.nodes)}")
    print(f"  Critical path length: {len(r.critical_path)}")
    print(f"  Total duration: {float(r.total_duration):.0f} hrs")
    print(f"  OK")


def test_resource_leveling():
    print("\n" + "=" * 60)
    print("TEST 3: Resource Leveling (3 ops on CNC-01)")
    print("=" * 60)

    ops = [
        {"id": sid("rl_a"), "name": "P1: Turning (200 pcs)", "duration_base": 800, "setup_time": 1},
        {"id": sid("rl_b"), "name": "P2: Turning (100 pcs)", "duration_base": 400, "setup_time": 1},
        {"id": sid("rl_c"), "name": "P3: Turning (30 pcs)", "duration_base": 120, "setup_time": 1},
    ]
    deps = [
        {"predecessor_id": sid("rl_a"), "successor_id": sid("rl_b"), "dependency_type": "FS", "lag_time": 0},
        {"predecessor_id": sid("rl_b"), "successor_id": sid("rl_c"), "dependency_type": "FS", "lag_time": 0},
    ]

    r = calculate_cpm(ops, deps)
    total = float(r.total_duration)
    expected = 801 + 401 + 121

    for nid, n in r.nodes.items():
        print(f"  {n.name}: ES={float(n.early_start):.0f} EF={float(n.early_finish):.0f}")

    print(f"  Duration: {total:.0f} hrs (expected ~{expected:.0f})")
    assert abs(total - expected) < 2
    print(f"  OK: all 3 ops serialized on CNC-01")


def test_float():
    print("\n" + "=" * 60)
    print("TEST 4: Total Float / Free Float")
    print("=" * 60)

    ops = [
        {"id": sid("f_start"), "name": "Start", "duration_base": 0},
        {"id": sid("f_a"), "name": "Branch A (long)", "duration_base": 100},
        {"id": sid("f_b"), "name": "Branch B (short)", "duration_base": 50},
        {"id": sid("f_end"), "name": "End", "duration_base": 10},
    ]
    deps = [
        {"predecessor_id": sid("f_start"), "successor_id": sid("f_a"), "dependency_type": "FS"},
        {"predecessor_id": sid("f_start"), "successor_id": sid("f_b"), "dependency_type": "FS"},
        {"predecessor_id": sid("f_a"), "successor_id": sid("f_end"), "dependency_type": "FS"},
        {"predecessor_id": sid("f_b"), "successor_id": sid("f_end"), "dependency_type": "FS"},
    ]

    r = calculate_cpm(ops, deps)

    n_b = r.nodes[sid("f_b")]
    assert float(n_b.total_float) == 50, f"TF(B) expected 50, got {float(n_b.total_float)}"
    assert float(n_b.free_float) == 50, f"FF(B) expected 50, got {float(n_b.free_float)}"

    n_a = r.nodes[sid("f_a")]
    assert n_a.is_critical, "Branch A must be critical"

    print(f"  Branch A (100h): TF=0 (critical)")
    print(f"  Branch B (50h):  TF=50h FF={float(n_b.free_float):.0f}h")
    print(f"  OK")


def test_cycle():
    print("\n" + "=" * 60)
    print("TEST 5: Cycle Detection")
    print("=" * 60)

    ops = [
        {"id": sid("c_a"), "name": "A", "duration_base": 10},
        {"id": sid("c_b"), "name": "B", "duration_base": 10},
        {"id": sid("c_c"), "name": "C", "duration_base": 10},
    ]
    deps = [
        {"predecessor_id": sid("c_a"), "successor_id": sid("c_b"), "dependency_type": "FS"},
        {"predecessor_id": sid("c_b"), "successor_id": sid("c_c"), "dependency_type": "FS"},
        {"predecessor_id": sid("c_c"), "successor_id": sid("c_a"), "dependency_type": "FS"},  # CYCLE
    ]

    try:
        calculate_cpm(ops, deps)
        assert False, "Should have thrown ValueError"
    except ValueError as e:
        print(f"  Error: {e}")
        print(f"  OK: cycle detected, calculation stopped")


if __name__ == "__main__":
    print()
    print("=" * 60)
    print("ProfyPlan CCM - Algorithm Validation Suite")
    print("=" * 60)

    passed = 0
    failed = 0

    for fn in [test_cpm_basic, test_multi_project, test_resource_leveling, test_float, test_cycle]:
        try:
            fn()
            passed += 1
        except AssertionError as e:
            print(f"\n  FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"\n  ERROR: {e}")
            import traceback; traceback.print_exc()
            failed += 1

    print("\n" + "=" * 60)
    print(f"RESULT: {passed}/{passed+failed} tests passed")
    print("=" * 60)
    sys.exit(0 if failed == 0 else 1)
