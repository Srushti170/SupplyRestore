from __future__ import annotations

from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from .models import RecoveryContract, VerificationCheck, VerificationResult
from .simulation.state import SimulationState


class ErrorOutput(BaseModel):
    error: str


class InventoryInput(BaseModel):
    warehouse_id: str | None = None


class InventoryOutput(BaseModel):
    warehouses: list[dict[str, Any]]


class ShipmentInput(BaseModel):
    shipment_id: str | None = None


class ShipmentOutput(BaseModel):
    shipments: list[dict[str, Any]]


class NetworkInput(BaseModel):
    sku: str | None = None


class NetworkOutput(BaseModel):
    routes: list[dict[str, Any]]
    warehouse_stock: list[dict[str, Any]]


class VendorOptionsInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)


class VendorOptionsOutput(BaseModel):
    options: list[dict[str, Any]]


class ShortageInput(BaseModel):
    warehouse_id: str = "WH-NORTH"


class ShortageOutput(BaseModel):
    shortages: list[dict[str, Any]]


class CompareInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)


class CompareOutput(BaseModel):
    candidates: list[dict[str, Any]]
    recommended: str | None
    reason: str


class TransferInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)
    route_id: str


class PurchaseInput(BaseModel):
    sku: str
    qty: int = Field(gt=0)
    vendor_id: str


class ActionOutput(BaseModel):
    action_id: str
    status: str
    detail: str


class VerifyActionInput(BaseModel):
    action_id: str


class VerifyContractInput(BaseModel):
    pass


def get_inventory(sim: SimulationState, args: InventoryInput) -> dict:
    """Return current on-hand inventory for one warehouse or the full network."""
    warehouses = list(sim.warehouses.values())
    if args.warehouse_id:
        warehouses = [w for w in warehouses if w.id == args.warehouse_id]
        if not warehouses:
            return {"error": f"Unknown warehouse {args.warehouse_id}"}
    return InventoryOutput(warehouses=[w.model_dump() for w in warehouses]).model_dump()


def get_shipment_status(sim: SimulationState, args: ShipmentInput) -> dict:
    """Return shipment status and ETA, including delayed in-flight supply."""
    shipments = list(sim.shipments.values())
    if args.shipment_id:
        shipments = [s for s in shipments if s.id == args.shipment_id]
        if not shipments:
            return {"error": f"Unknown shipment {args.shipment_id}"}
    return ShipmentOutput(shipments=[s.model_dump() for s in shipments]).model_dump()


def get_network_state(sim: SimulationState, args: NetworkInput) -> dict:
    """Inspect routes and alternate-warehouse stock before choosing a recovery action."""
    stock = [{"warehouse_id": w.id, "warehouse": w.name, "qty": w.inventory.get(args.sku, 0) if args.sku else w.inventory} for w in sim.warehouses.values()]
    return NetworkOutput(routes=[r.model_dump(by_alias=True) for r in sim.routes.values()], warehouse_stock=stock).model_dump()


def get_vendor_options(sim: SimulationState, args: VendorOptionsInput, contract: RecoveryContract) -> dict:
    """List emergency purchase options, excluding blocked vendors."""
    options = []
    for vendor in sim.vendors.values():
        blocked = vendor.blocked or vendor.id in contract.blocked_vendors
        options.append({**vendor.model_dump(), "qty": args.qty, "total_cost": vendor.unit_cost * args.qty, "eligible": not blocked})
    return VendorOptionsOutput(options=options).model_dump()


def calculate_projected_shortages(sim: SimulationState, args: ShortageInput) -> dict:
    """Calculate demand due before delayed supply arrives and identify projected shortages."""
    warehouse = sim.warehouses.get(args.warehouse_id)
    if not warehouse:
        return {"error": f"Unknown warehouse {args.warehouse_id}"}
    demand: dict[str, int] = {}
    for order in sim.orders:
        if order.priority == "high":
            demand[order.sku] = demand.get(order.sku, 0) + order.qty
    shortages = []
    for sku, required in demand.items():
        available = warehouse.inventory.get(sku, 0)
        if available < required:
            shortages.append({"sku": sku, "required": required, "available": available, "shortage_qty": required - available, "warehouse_id": warehouse.id, "cause": "delayed inbound shipment"})
    return ShortageOutput(shortages=shortages).model_dump()


def _score(candidate: dict, contract: RecoveryContract) -> float:
    if not candidate["feasible"]:
        return 999.0
    # Lower is better. Contract-normalized weighted sum keeps the comparison explainable.
    return round(
        .35 * candidate["cost"] / max(contract.max_extra_cost, 1)
        + .20 * candidate["carbon"] / max(contract.max_extra_carbon, 1)
        + .30 * candidate["delay_hours"] / max(contract.max_delay_hours, 1)
        + .15 * (1 - candidate["fulfilment_pct"] / 100), 4
    )


def compare_recovery_options(sim: SimulationState, args: CompareInput, contract: RecoveryContract) -> dict:
    """Build and deterministically score transfer and purchase candidates side by side."""
    route = sim.routes["R-SN"]
    south_stock = sim.warehouses["WH-SOUTH"].inventory.get(args.sku, 0)
    transfer = {
        "id": "transfer", "type": "transfer", "label": "Inter-warehouse transfer",
        "sku": args.sku, "qty": args.qty, "route_id": route.id,
        "cost": route.cost_per_unit * args.qty, "carbon": route.carbon_per_unit * args.qty,
        "delay_hours": route.lead_time_hours, "fulfilment_pct": 100.0,
        "feasible": route.status == "open" and route.id not in contract.prohibited_routes and south_stock >= args.qty,
    }
    eligible = [v for v in sim.vendors.values() if not v.blocked and v.id not in contract.blocked_vendors and v.lead_time_hours <= contract.max_delay_hours]
    vendor = min(eligible, key=lambda v: v.lead_time_hours) if eligible else None
    purchase = {
        "id": "purchase", "type": "purchase", "label": "Emergency purchase order",
        "sku": args.sku, "qty": args.qty, "vendor_id": vendor.id if vendor else None,
        "cost": ((vendor.unit_cost + sim.routes["R-VN"].cost_per_unit) * args.qty) if vendor else 0,
        "carbon": sim.routes["R-VN"].carbon_per_unit * args.qty,
        "delay_hours": vendor.lead_time_hours if vendor else 999, "fulfilment_pct": 100.0,
        "feasible": bool(vendor) and sim.routes["R-VN"].status == "open" and "R-VN" not in contract.prohibited_routes,
    }
    for candidate in (transfer, purchase):
        within = candidate["cost"] <= contract.max_extra_cost and candidate["carbon"] <= contract.max_extra_carbon and candidate["delay_hours"] <= contract.max_delay_hours
        candidate["feasible"] = candidate["feasible"] and within
        reasons = []
        if candidate["id"] == "transfer":
            if route.status != "open":
                reasons.append(f"Route {route.id} is closed")
            if route.id in contract.prohibited_routes:
                reasons.append("Route is prohibited by the contract")
            if south_stock < args.qty:
                reasons.append("Insufficient reserve stock")
        else:
            if not vendor:
                reasons.append("No eligible vendor meets the policy")
            if sim.routes["R-VN"].status != "open":
                reasons.append("Vendor delivery route is closed")
            if "R-VN" in contract.prohibited_routes:
                reasons.append("Vendor route is prohibited by the contract")
        if candidate["cost"] > contract.max_extra_cost:
            reasons.append("Exceeds cost limit")
        if candidate["carbon"] > contract.max_extra_carbon:
            reasons.append("Exceeds carbon limit")
        if candidate["delay_hours"] > contract.max_delay_hours:
            reasons.append("Exceeds delay limit")
        candidate["infeasible_reason"] = reasons[0] if reasons else None
        candidate["score"] = _score(candidate, contract)
    feasible = [c for c in (transfer, purchase) if c["feasible"]]
    winner = min(feasible, key=lambda c: c["score"]) if feasible else None
    reason = (f"{winner['label']} has the lowest contract-normalized score ({winner['score']})." if winner else "No candidate satisfies the Recovery Contract.")
    return CompareOutput(candidates=[transfer, purchase], recommended=winner["id"] if winner else None, reason=reason).model_dump()


def transfer_inventory(sim: SimulationState, args: TransferInput) -> dict:
    """Start an inventory transfer on an open route; completion must be verified."""
    route = sim.routes.get(args.route_id)
    if not route or route.status != "open":
        return {"error": "Transfer route is unavailable"}
    source = sim.warehouses[route.source]
    if source.inventory.get(args.sku, 0) < args.qty:
        return {"error": "Insufficient source inventory"}
    source.inventory[args.sku] -= args.qty
    action_id = f"ACT-{uuid4().hex[:8]}"
    sim.pending_actions[action_id] = {"type": "transfer", **args.model_dump(), "source": route.source, "destination": route.destination, "verified": False}
    return ActionOutput(action_id=action_id, status="in_transit", detail=f"{args.qty} units dispatched on {args.route_id}").model_dump()


def create_purchase_order(sim: SimulationState, args: PurchaseInput, contract: RecoveryContract) -> dict:
    """Create an emergency purchase order from an eligible vendor; receipt must be verified."""
    vendor = sim.vendors.get(args.vendor_id)
    if not vendor or vendor.blocked or vendor.id in contract.blocked_vendors:
        return {"error": "Vendor is unavailable or blocked"}
    if vendor.lead_time_hours > contract.max_delay_hours:
        return {"error": "Vendor lead time violates the contract"}
    action_id = f"ACT-{uuid4().hex[:8]}"
    sim.warehouses["WH-NORTH"].inventory[args.sku] = sim.warehouses["WH-NORTH"].inventory.get(args.sku, 0) + args.qty
    sim.metrics["extra_cost"] += (vendor.unit_cost + sim.routes["R-VN"].cost_per_unit) * args.qty
    sim.metrics["extra_carbon"] += sim.routes["R-VN"].carbon_per_unit * args.qty
    sim.metrics["delay_hours"] = max(sim.metrics["delay_hours"], vendor.lead_time_hours)
    sim.pending_actions[action_id] = {"type": "purchase", **args.model_dump(), "destination": "WH-NORTH", "verified": False}
    return ActionOutput(action_id=action_id, status="received", detail=f"PO received from {vendor.name}").model_dump()


def verify_action_effect(sim: SimulationState, args: VerifyActionInput) -> dict:
    """Verify that an action had its intended physical effect and expose mid-flight failures."""
    action = sim.pending_actions.get(args.action_id)
    if not action:
        return {"error": f"Unknown action {args.action_id}"}
    if action["type"] == "transfer":
        route = sim.routes[action["route_id"]]
        if route.status != "open":
            sim.warehouses[action["source"]].inventory[action["sku"]] += action["qty"]
            action["status"] = "failed"
            return {"passed": False, "action_id": args.action_id, "detail": f"Route {route.id} closed mid-transfer; inventory returned to source."}
        sim.warehouses[action["destination"]].inventory[action["sku"]] = sim.warehouses[action["destination"]].inventory.get(action["sku"], 0) + action["qty"]
        sim.metrics["extra_cost"] += route.cost_per_unit * action["qty"]
        sim.metrics["extra_carbon"] += route.carbon_per_unit * action["qty"]
        sim.metrics["delay_hours"] = max(sim.metrics["delay_hours"], route.lead_time_hours)
    action["verified"] = True
    action["status"] = "verified"
    return {"passed": True, "action_id": args.action_id, "detail": "Observed inventory and delivery effect matches the action."}


def verify_recovery_contract(sim: SimulationState, args: VerifyContractInput, contract: RecoveryContract) -> dict:
    """Verify fulfilment, cost, carbon, delay, vendor, and route constraints. This is the only success gate."""
    required = sum(o.qty for o in sim.orders if o.priority == "high" and o.sku == "SKU-100")
    available = sim.warehouses["WH-NORTH"].inventory.get("SKU-100", 0)
    fulfilment = min(100.0, available / max(required, 1) * 100)
    completed = [a for a in sim.pending_actions.values() if a.get("verified")]
    used_routes = {a["route_id"] for a in completed if a["type"] == "transfer"}
    used_vendors = {a["vendor_id"] for a in completed if a["type"] == "purchase"}
    route_compliant = not used_routes.intersection(contract.prohibited_routes)
    vendor_compliant = not used_vendors.intersection(contract.blocked_vendors)
    checks = [
        VerificationCheck(name="High-priority fulfilment", passed=fulfilment >= contract.min_fulfilment_pct, detail=f"{fulfilment:.1f}% available; minimum {contract.min_fulfilment_pct:.1f}%"),
        VerificationCheck(name="Extra cost", passed=sim.metrics["extra_cost"] <= contract.max_extra_cost, detail=f"${sim.metrics['extra_cost']:.0f} of ${contract.max_extra_cost:.0f} limit"),
        VerificationCheck(name="Extra carbon", passed=sim.metrics["extra_carbon"] <= contract.max_extra_carbon, detail=f"{sim.metrics['extra_carbon']:.0f} of {contract.max_extra_carbon:.0f} kg limit"),
        VerificationCheck(name="Recovery delay", passed=sim.metrics["delay_hours"] <= contract.max_delay_hours, detail=f"{sim.metrics['delay_hours']:.0f}h of {contract.max_delay_hours:.0f}h limit"),
        VerificationCheck(name="Route policy", passed=route_compliant, detail="No prohibited route was used" if route_compliant else "A prohibited route was used"),
        VerificationCheck(name="Vendor policy", passed=vendor_compliant, detail="No blocked vendor was used" if vendor_compliant else "A blocked vendor was used"),
    ]
    result = VerificationResult(passed=all(c.passed for c in checks), checks=checks)
    return result.model_dump()


TOOL_SCHEMAS = {
    "get_inventory": InventoryInput,
    "get_shipment_status": ShipmentInput,
    "get_network_state": NetworkInput,
    "get_vendor_options": VendorOptionsInput,
    "calculate_projected_shortages": ShortageInput,
    "compare_recovery_options": CompareInput,
    "transfer_inventory": TransferInput,
    "create_purchase_order": PurchaseInput,
    "verify_action_effect": VerifyActionInput,
    "verify_recovery_contract": VerifyContractInput,
}


def execute_tool(sim: SimulationState, name: str, arguments: dict, contract: RecoveryContract) -> dict:
    try:
        schema = TOOL_SCHEMAS[name]
        parsed = schema.model_validate(arguments)
        fn = globals()[name]
        if name in {"get_vendor_options", "compare_recovery_options", "create_purchase_order", "verify_recovery_contract"}:
            return fn(sim, parsed, contract)
        return fn(sim, parsed)
    except KeyError:
        return {"error": f"Unknown tool {name}"}
    except Exception as exc:
        return {"error": str(exc)}


def groq_tool_definitions() -> list[dict]:
    definitions = []
    for name, schema in TOOL_SCHEMAS.items():
        definitions.append({"type": "function", "function": {"name": name, "description": (globals()[name].__doc__ or "").strip(), "parameters": schema.model_json_schema()}})
    return definitions
