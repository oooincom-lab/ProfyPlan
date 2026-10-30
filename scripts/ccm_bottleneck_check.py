from app.services.bottleneck import analyze_bottlenecks


def main():
    operations = [{
        "id": "op-1", "name": "Операция", "duration_base": 10,
        "early_start": 0, "early_finish": 10, "quantity": 1,
    }]
    resources = [
        {"id": "primary", "name": "Основной", "resource_type": "equipment", "capacity_per_unit": 1},
        {"id": "alternative", "name": "Альтернативный", "resource_type": "equipment", "capacity_per_unit": 1},
    ]
    links = [
        {"operation_id": "op-1", "resource_id": "primary", "role": "primary", "capacity_demand": 1},
        {"operation_id": "op-1", "resource_id": "alternative", "role": "alternative", "capacity_demand": 1},
    ]
    result = analyze_bottlenecks(operations, links, resources, project_duration_hours=10)
    print("critical", result.critical_count, "warning", result.warning_count)
    for r in result.resources:
        print(r.resource_name, "ops", r.assigned_operations, "load", float(r.load_percent))


if __name__ == "__main__":
    main()
