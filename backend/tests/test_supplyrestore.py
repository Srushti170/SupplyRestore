import app.agent as agent_module
from app.agent import run_agent
from app.main import app, state
from app.models import AgentRun, RecoveryContract
from fastapi.testclient import TestClient
from app.tools import (
    CompareInput,
    PurchaseInput,
    ShortageInput,
    TransferInput,
    VerifyActionInput,
    VerifyContractInput,
    calculate_projected_shortages,
    compare_recovery_options,
    create_purchase_order,
    transfer_inventory,
    verify_action_effect,
    verify_recovery_contract,
)


def test_seeded_shortage_is_calculated(sim):
    result = calculate_projected_shortages(sim, ShortageInput())
    shortage = next(item for item in result["shortages"] if item["sku"] == "SKU-100")
    assert shortage["required"] == 30
    assert shortage["available"] == 4
    assert shortage["shortage_qty"] == 26


def test_optimizer_compares_and_ranks_both_plans(sim, contract):
    result = compare_recovery_options(sim, CompareInput(sku="SKU-100", qty=26), contract)
    assert {c["type"] for c in result["candidates"]} == {"transfer", "purchase"}
    assert result["recommended"] == "transfer"
    transfer, purchase = result["candidates"]
    assert transfer["score"] < purchase["score"]
    sim.routes["R-SN"].status = "closed"
    replanned = compare_recovery_options(sim, CompareInput(sku="SKU-100", qty=26), contract)
    unavailable = next(c for c in replanned["candidates"] if c["id"] == "transfer")
    assert replanned["recommended"] == "purchase"
    assert unavailable["infeasible_reason"] == "Route R-SN is closed"


def test_both_action_types_mutate_state(sim, contract):
    south_before = sim.warehouses["WH-SOUTH"].inventory["SKU-100"]
    transfer = transfer_inventory(sim, TransferInput(sku="SKU-100", qty=5, route_id="R-SN"))
    assert sim.warehouses["WH-SOUTH"].inventory["SKU-100"] == south_before - 5
    assert transfer["status"] == "in_transit"

    north_before = sim.warehouses["WH-NORTH"].inventory["SKU-100"]
    purchase = create_purchase_order(sim, PurchaseInput(sku="SKU-100", qty=5, vendor_id="V-RAPID"), contract)
    assert sim.warehouses["WH-NORTH"].inventory["SKU-100"] == north_before + 5
    assert purchase["status"] == "received"


def test_contract_verification_passes_and_fails(sim, contract):
    failed = verify_recovery_contract(sim, VerifyContractInput(), contract)
    assert failed["passed"] is False
    sim.warehouses["WH-NORTH"].inventory["SKU-100"] = 30
    passed = verify_recovery_contract(sim, VerifyContractInput(), contract)
    assert passed["passed"] is True


def test_route_closure_is_caught_and_inventory_is_reconciled(sim):
    before = sim.warehouses["WH-SOUTH"].inventory["SKU-100"]
    action = transfer_inventory(sim, TransferInput(sku="SKU-100", qty=26, route_id="R-SN"))
    sim.routes["R-SN"].status = "closed"
    result = verify_action_effect(sim, VerifyActionInput(action_id=action["action_id"]))
    assert result["passed"] is False
    assert sim.warehouses["WH-SOUTH"].inventory["SKU-100"] == before
    assert sim.warehouses["WH-NORTH"].inventory["SKU-100"] == 4


def test_flagship_scenario_replans_and_finishes_verified(sim, contract):
    run = run_agent(sim, contract, provider_name="fake", scenario="flagship")
    assert run.status == "verified"
    assert run.verification["passed"] is True
    assert any(e.type == "comparison" and len(e.content["output"]["candidates"]) == 2 for e in run.events)
    assert any(e.type == "verification" and e.content["output"].get("passed") is False for e in run.events)
    assert any(e.type == "replan" for e in run.events)
    assert any(e.content.get("tool") == "create_purchase_order" for e in run.events)


def test_infeasible_contract_ends_cleanly_without_provider_error(sim):
    strict = RecoveryContract(max_extra_cost=100, max_extra_carbon=20, max_delay_hours=2)
    run = run_agent(sim, strict, provider_name="fake", scenario="flagship")
    assert run.status == "failed"
    assert run.verification["passed"] is False
    assert any(e.type == "infeasible" for e in run.events)
    assert not any(e.content.get("title") == "Provider stopped" for e in run.events)
    assert not any(e.content.get("tool") in {"transfer_inventory", "create_purchase_order"} for e in run.events)


def test_fast_live_path_keeps_full_logs_with_only_two_ai_decisions(sim, contract, monkeypatch):
    class StubGroqProvider:
        decisions = 0

        def __init__(self, _contract):
            pass

        def select_action(self, comparison, phase):
            StubGroqProvider.decisions += 1
            selected = next(c for c in comparison["candidates"] if c["id"] == comparison["recommended"])
            if selected["id"] == "transfer":
                return "transfer_inventory", {"sku": selected["sku"], "qty": selected["qty"], "route_id": selected["route_id"]}
            return "create_purchase_order", {"sku": selected["sku"], "qty": selected["qty"], "vendor_id": selected["vendor_id"]}

    monkeypatch.setattr(agent_module, "GroqProvider", StubGroqProvider)
    run = run_agent(sim, contract, provider_name="groq", scenario="flagship")
    tools = [e.content.get("tool") for e in run.events if e.content.get("tool")]
    assert run.status == "verified"
    assert StubGroqProvider.decisions == 2
    assert tools == [
        "get_inventory", "get_shipment_status", "calculate_projected_shortages",
        "get_network_state", "get_vendor_options", "compare_recovery_options",
        "transfer_inventory", "verify_action_effect", "get_network_state",
        "get_vendor_options", "compare_recovery_options", "create_purchase_order",
        "verify_action_effect", "verify_recovery_contract",
    ]


def test_api_rejects_reset_and_second_run_while_recovery_is_active():
    client = TestClient(app)
    contract = RecoveryContract()
    state.contracts[contract.id] = contract
    busy = AgentRun(status="running")
    state.runs[busy.id] = busy
    try:
        reset_response = client.post("/reset")
        run_response = client.post("/runs", json={"contract_id": contract.id})
        assert reset_response.status_code == 409
        assert run_response.status_code == 409
        assert reset_response.json()["detail"] == "A recovery run is already in progress"
    finally:
        state.runs.pop(busy.id, None)
        state.contracts.pop(contract.id, None)
