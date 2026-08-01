# ProfyPlan API — services package
# Lazy imports for CLI test compatibility
from app.services.cpm import CPMResult, calculate_cpm  # noqa: F401

try:
    from app.services.multi_project import merge_projects, format_merged_result  # noqa: F401
    from app.services.bom_explosion import (  # noqa: F401
        explode_bom_to_operations,
        load_routing_operations,
        expand_routing_to_ops,
    )
    from app.services.resource_leveling import resource_leveling_sgs, format_leveling_result  # noqa: F401
    from app.services.forecast import recalculate_forecast, format_forecast_result  # noqa: F401
except ImportError:
    pass