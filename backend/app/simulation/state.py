from __future__ import annotations

from threading import RLock

from ..models import AgentRun, RecoveryContract
from .seed import seed_data
from ..supplier_learning import initial_supplier_learning


class SimulationState:
    def __init__(self) -> None:
        self.lock = RLock()
        self.contracts: dict[str, RecoveryContract] = {}
        self.runs: dict[str, AgentRun] = {}
        self.supplier_learning = initial_supplier_learning()
        self.learning_decisions = 0
        self.reset()

    def reset(self) -> None:
        with self.lock:
            data = seed_data()
            for key, value in data.items():
                setattr(self, key, value)
            self.pending_actions: dict[str, dict] = {}
            self.metrics = {"extra_cost": 0.0, "extra_carbon": 0.0, "delay_hours": 0.0}
            self.disruption_triggered = False

    def snapshot(self) -> dict:
        return {
            "warehouses": [w.model_dump() for w in self.warehouses.values()],
            "vendors": [v.model_dump() for v in self.vendors.values()],
            "routes": [r.model_dump(by_alias=True) for r in self.routes.values()],
            "shipments": [s.model_dump() for s in self.shipments.values()],
            "metrics": dict(self.metrics),
            "supplier_learning": {key: dict(value) for key, value in self.supplier_learning.items()},
        }


state = SimulationState()
