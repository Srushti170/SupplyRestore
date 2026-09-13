from __future__ import annotations

import json
import os
import random
import time
from typing import Protocol

from .models import AgentEvent, AgentRun, RecoveryContract
from .simulation.state import SimulationState
from .tools import execute_tool, groq_tool_definitions


SYSTEM_PROMPT = """You are SupplyRestore, a verification-first supply-chain recovery agent.
Restore high-priority fulfilment while obeying the Recovery Contract. Monitor inventory and shipments, calculate shortages, and investigate BOTH network/warehouse alternatives and vendor options before acting. Compare recovery options deterministically before every action. A purchase candidate can include an RL supplier-intelligence recommendation derived from prior simulated deliveries; use it as evidence, but never override the deterministic contract-safe recommendation. After any action, verify its physical effect. If verification fails, re-investigate and replan. You may only finish after verify_recovery_contract returns passed=true. Never claim success from an action response alone."""


class Provider(Protocol):
    def next_tool(self, history: list[dict], step: int) -> tuple[str, dict]: ...


class FakeProvider:
    """Repeatable provider used by tests and the default demo."""

    plan = [
        ("get_inventory", {}),
        ("get_shipment_status", {}),
        ("calculate_projected_shortages", {"warehouse_id": "WH-NORTH"}),
        ("get_network_state", {"sku": "SKU-100"}),
        ("get_vendor_options", {"sku": "SKU-100", "qty": 26}),
        ("compare_recovery_options", {"sku": "SKU-100", "qty": 26}),
        ("transfer_inventory", {"sku": "SKU-100", "qty": 26, "route_id": "R-SN"}),
        ("verify_action_effect", {"action_id": "$last_action"}),
        ("get_network_state", {"sku": "SKU-100"}),
        ("get_vendor_options", {"sku": "SKU-100", "qty": 26}),
        ("compare_recovery_options", {"sku": "SKU-100", "qty": 26}),
        ("create_purchase_order", {"sku": "SKU-100", "qty": 26, "vendor_id": "V-RAPID"}),
        ("verify_action_effect", {"action_id": "$last_action"}),
        ("verify_recovery_contract", {}),
    ]

    def __init__(self) -> None:
        self.plan = [(name, dict(arguments)) for name, arguments in type(self).plan]

    def set_shortage(self, sku: str, qty: int) -> None:
        for index, (name, arguments) in enumerate(self.plan):
            if name in {"get_vendor_options", "compare_recovery_options", "transfer_inventory", "create_purchase_order"}:
                updated = {**arguments, "sku": sku, "qty": qty}
                self.plan[index] = (name, updated)

    def next_tool(self, history: list[dict], step: int) -> tuple[str, dict]:
        name, args = self.plan[step]
        if args.get("action_id") == "$last_action":
            action_id = next(item["result"]["action_id"] for item in reversed(history) if item.get("result", {}).get("action_id"))
            args = {"action_id": action_id}
        return name, dict(args)


class GroqProvider:
    def __init__(self, contract: RecoveryContract):
        from groq import Groq

        if not os.getenv("GROQ_API_KEY"):
            raise RuntimeError("GROQ_API_KEY is required for provider=groq")
        self.client = Groq(api_key=os.environ["GROQ_API_KEY"])
        self.model = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")
        self.messages = [
            {"role": "system", "content": SYSTEM_PROMPT + "\nRecovery Contract:\n" + contract.model_dump_json(indent=2)},
            {"role": "user", "content": "Run the recovery workflow now. Begin by monitoring the seeded disruption."},
        ]
        self.pending_call_id: str | None = None

    def select_action(self, comparison: dict, phase: str) -> tuple[str, dict]:
        """Ask the live model to choose an action from a completed deterministic comparison."""
        action_tools = [
            tool for tool in groq_tool_definitions()
            if tool["function"]["name"] in {"transfer_inventory", "create_purchase_order"}
        ]
        recommended = comparison.get("recommended")
        candidate = next((item for item in comparison.get("candidates", []) if item.get("id") == recommended), None)
        if not candidate:
            raise RuntimeError("The optimizer produced no feasible action candidate")
        expected_name = "transfer_inventory" if recommended == "transfer" else "create_purchase_order"
        expected_args = {
            "sku": candidate["sku"],
            "qty": candidate["qty"],
            "route_id" if recommended == "transfer" else "vendor_id": candidate["route_id" if recommended == "transfer" else "vendor_id"],
        }
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                f"Decision phase: {phase}. The deterministic optimizer has completed its contract checks. "
                f"Review the comparison and call the recommended feasible action using its exact SKU, quantity, and route/vendor. "
                f"Comparison: {json.dumps(comparison)}"
            )},
        ]
        for attempt in range(2):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=action_tools,
                    tool_choice="required",
                    parallel_tool_calls=False,
                    temperature=0,
                    max_completion_tokens=128,
                    reasoning_effort="none",
                )
            except Exception as exc:
                if attempt == 0 and ("tool_use_failed" in str(exc) or "not in request.tools" in str(exc)):
                    messages.append({"role": "user", "content": f"Call exactly {expected_name} with exactly these arguments: {json.dumps(expected_args)}"})
                    continue
                raise
            message = response.choices[0].message
            if message.tool_calls:
                call = message.tool_calls[0]
                arguments = json.loads(call.function.arguments or "{}")
                if call.function.name == expected_name and arguments == expected_args:
                    return call.function.name, arguments
            messages.append({"role": "user", "content": f"That selection did not match the feasible optimizer result. Call exactly {expected_name} with exactly these arguments: {json.dumps(expected_args)}"})
        raise RuntimeError("The live model did not select the optimizer-approved action")

    def next_tool(self, history: list[dict], step: int) -> tuple[str, dict]:
        if history:
            last = history[-1]
            if not self.messages or self.messages[-1].get("role") != "tool":
                self.messages.append({"role": "tool", "tool_call_id": self.pending_call_id, "name": last["tool"], "content": json.dumps(last["result"])})
        for attempt in range(3):
            try:
                response = self.client.chat.completions.create(
                    model=self.model, messages=self.messages, tools=groq_tool_definitions(),
                    tool_choice="auto", parallel_tool_calls=False, temperature=0,
                    max_completion_tokens=128, reasoning_effort="none",
                )
            except Exception as exc:
                error_text = str(exc)
                malformed_tool = "tool_use_failed" in error_text or "not in request.tools" in error_text
                if malformed_tool and attempt < 2:
                    self.messages.append({"role": "user", "content": "Your previous tool selection was invalid. Call exactly one function from the supplied tools using its exact name. Never use commentary, analysis, or any message channel as a tool name."})
                    continue
                if malformed_tool:
                    return "__finish__", {"reason": "incomplete", "message": "The live model could not produce a valid supply-chain tool call after automatic retries. Start a new run to retry safely."}
                raise
            message = response.choices[0].message
            self.messages.append(message.model_dump(exclude_none=True))
            if message.tool_calls:
                call = message.tool_calls[0]
                self.pending_call_id = call.id
                return call.function.name, json.loads(call.function.arguments or "{}")

            conclusion = message.content or "The agent ended without a tool call."
            last_comparison = next((item.get("result", {}) for item in reversed(history) if item.get("tool") == "compare_recovery_options" and not item.get("result", {}).get("error")), {})
            last_verification = next((item.get("result", {}) for item in reversed(history) if item.get("tool") == "verify_recovery_contract"), {})
            if last_verification.get("passed") is False and last_comparison.get("recommended") is None:
                return "__finish__", {"reason": "infeasible", "message": conclusion}
            if attempt < 2:
                self.messages.append({"role": "user", "content": "Recovery is not complete. Continue with exactly one appropriate tool call. If the last action failed, investigate both network and vendor options again, compare them, act on the feasible recommendation, and verify."})
                continue
            return "__finish__", {"reason": "incomplete", "message": conclusion}

        return "__finish__", {"reason": "incomplete", "message": "The agent could not select a valid next tool."}


EVENT_TYPES = {
    "get_inventory": "monitor", "get_shipment_status": "monitor",
    "calculate_projected_shortages": "detection",
    "get_network_state": "investigation", "get_vendor_options": "investigation",
    "compare_recovery_options": "comparison",
    "transfer_inventory": "action", "create_purchase_order": "action",
    "verify_action_effect": "verification", "verify_recovery_contract": "certificate",
}


def _log(run: AgentRun, event_type: str, **content) -> None:
    run.events.append(AgentEvent(type=event_type, content=content))


def _log_learning_update(run: AgentRun, result: dict) -> None:
    update = result.get("learning_update")
    if update:
        _log(run, "learning", title="Supplier learning updated", message=(
            f"{update['vendor_name']} received reward {update['reward']:+.2f}. "
            f"On-time: {'yes' if update['on_time'] else 'no'}; actual delivery: {update['actual_delivery_hours']}h."
        ), output=update)


def _run_fast_groq(sim: SimulationState, contract: RecoveryContract, run: AgentRun, step_delay: float = 0, destination_name: str = "North Fulfilment Hub", destination_location: str = "Mumbai") -> AgentRun:
    """Fast live path: preserve every tool event while limiting LLM calls to action decisions."""
    try:
        provider = GroqProvider(contract)
    except Exception as exc:
        _log(run, "error", title="Provider unavailable", message=str(exc))
        run.status = "failed"
        return run

    step = 0

    def pause() -> None:
        if step_delay:
            time.sleep(random.uniform(step_delay, step_delay + 1))

    def call(name: str, arguments: dict) -> dict:
        nonlocal step
        step += 1
        result = execute_tool(sim, name, arguments, contract)
        _log(run, EVENT_TYPES.get(name, "tool"), title=name.replace("_", " ").title(), tool=name, input=arguments, output=result, step=step)
        pause()
        return result

    def transit(route_id: str, checkpoints: list[tuple[int, int]]) -> None:
        for progress, eta_minutes in checkpoints:
            _log(
                run, "transit", title="Driver location updated",
                message=f"Driver is {progress}% along {route_id} toward {destination_name}, {destination_location}.",
                output={"route_id": route_id, "progress": progress, "eta_minutes": eta_minutes, "destination_name": destination_name, "destination_location": destination_location},
            )
            pause()

    pause()
    call("get_inventory", {})
    call("get_shipment_status", {})
    shortage_result = call("calculate_projected_shortages", {"warehouse_id": "WH-NORTH"})
    shortages = shortage_result.get("shortages", [])
    if not shortages:
        verification = call("verify_recovery_contract", {})
        run.verification = verification
        run.status = "verified" if verification.get("passed") else "failed"
        return run

    shortage = max(shortages, key=lambda item: item["shortage_qty"])
    sku, qty = shortage["sku"], shortage["shortage_qty"]
    call("get_network_state", {"sku": sku})
    call("get_vendor_options", {"sku": sku, "qty": qty})
    comparison = call("compare_recovery_options", {"sku": sku, "qty": qty})

    def stop_if_infeasible(result: dict) -> bool:
        if result.get("recommended") is not None:
            return False
        verification = call("verify_recovery_contract", {})
        run.verification = verification
        _log(run, "infeasible", title="Recovery contract is infeasible", message="No available recovery option can satisfy all current contract limits. Adjust the contract or restore network capacity, then start a new run.")
        run.status = "infeasible"
        return True

    if stop_if_infeasible(comparison):
        return run

    try:
        action_name, action_args = provider.select_action(comparison, "initial recovery")
    except Exception as exc:
        _log(run, "error", title="AI decision unavailable", message=str(exc))
        run.status = "failed"
        return run
    _log(run, "decision", title="AI selected recovery action", message=f"The live agent selected {action_name.replace('_', ' ')} after reviewing the optimizer output.")
    pause()
    action = call(action_name, action_args)
    if action.get("error"):
        run.status = "failed"
        return run

    if action_name == "transfer_inventory":
        transit(action_args["route_id"], [(18, 100), (42, 65)])
    else:
        transit("R-VN", [(20, 190), (55, 105), (85, 35), (100, 0)])

    if action_name == "transfer_inventory" and not sim.disruption_triggered:
        sim.routes[action_args["route_id"]].status = "closed"
        sim.disruption_triggered = True
        _log(run, "disruption", title="Route closed mid-transfer", message=f"Simulator closed {action_args['route_id']} after dispatch and before verification.", route_id=action_args["route_id"])
        pause()

    effect = call("verify_action_effect", {"action_id": action["action_id"]})
    _log_learning_update(run, effect)
    if effect.get("learning_update"):
        pause()
    if effect.get("passed") is False:
        _log(run, "replan", title="Live replan required", message="The chosen action is no longer viable. Re-investigating alternatives.")
        pause()
        call("get_network_state", {"sku": sku})
        call("get_vendor_options", {"sku": sku, "qty": qty})
        comparison = call("compare_recovery_options", {"sku": sku, "qty": qty})
        if stop_if_infeasible(comparison):
            return run
        try:
            action_name, action_args = provider.select_action(comparison, "recovery replan after failed action")
        except Exception as exc:
            _log(run, "error", title="AI replan unavailable", message=str(exc))
            run.status = "failed"
            return run
        _log(run, "decision", title="AI selected alternate action", message=f"The live agent selected {action_name.replace('_', ' ')} after the disruption.")
        pause()
        action = call(action_name, action_args)
        if action.get("error"):
            run.status = "failed"
            return run
        if action_name == "transfer_inventory":
            transit(action_args["route_id"], [(20, 95), (60, 45), (100, 0)])
        else:
            transit("R-VN", [(20, 190), (55, 105), (85, 35), (100, 0)])
        effect = call("verify_action_effect", {"action_id": action["action_id"]})
        _log_learning_update(run, effect)
        if effect.get("learning_update"):
            pause()

    verification = call("verify_recovery_contract", {})
    run.verification = verification
    run.status = "verified" if effect.get("passed") and verification.get("passed") else "failed"
    return run


def run_agent(sim: SimulationState, contract: RecoveryContract, provider_name: str = "fake", scenario: str = "flagship", run: AgentRun | None = None, step_delay: float = 0, destination_name: str = "North Fulfilment Hub", destination_location: str = "Mumbai") -> AgentRun:
    run = run or AgentRun(provider=provider_name)
    _log(run, "goal", title="Recovery Contract activated", message="Protect high-priority orders within cost, carbon, and delay limits.", contract=contract.model_dump())
    if scenario == "baseline":
        delayed = sim.shipments["SHIP-001"]
        delayed.status = "delivered"
        sim.warehouses["WH-NORTH"].inventory[delayed.product] += delayed.qty
        result = execute_tool(sim, "verify_recovery_contract", {}, contract)
        _log(run, "certificate", title="Baseline verification", tool="verify_recovery_contract", input={}, output=result)
        run.status = "verified" if result.get("passed") else "failed"
        run.verification = result
        return run

    if provider_name == "groq":
        return _run_fast_groq(sim, contract, run, step_delay, destination_name, destination_location)

    provider: Provider = FakeProvider()
    history: list[dict] = []
    investigated = set()
    compared = False
    last_comparison: dict | None = None
    max_steps = 18
    if step_delay:
        time.sleep(random.uniform(step_delay, step_delay + 1))
    for step in range(max_steps):
        try:
            name, arguments = provider.next_tool(history, step)
        except Exception as exc:
            _log(run, "error", title="Provider stopped", message=str(exc))
            run.status = "failed"
            break
        if name == "__finish__":
            reason = arguments.get("reason", "incomplete")
            _log(
                run,
                "infeasible" if reason == "infeasible" else "error",
                title="Recovery contract is infeasible" if reason == "infeasible" else "Agent stopped before verified recovery",
                message=arguments.get("message", "No verified recovery was produced."),
            )
            run.status = "infeasible" if reason == "infeasible" else "failed"
            break
        if name in {"get_network_state", "get_vendor_options"}:
            investigated.add(name)
        if name == "compare_recovery_options" and len(investigated) < 2:
            result = {"error": "Comparison blocked: inspect both network state and vendor options first."}
        elif name in {"transfer_inventory", "create_purchase_order"} and (len(investigated) < 2 or not compared or not last_comparison):
            result = {"error": "Action blocked: investigate network and vendors, then compare options first."}
        elif name in {"transfer_inventory", "create_purchase_order"}:
            expected = "transfer" if name == "transfer_inventory" else "purchase"
            if last_comparison.get("recommended") != expected:
                result = {"error": f"Action blocked: the optimizer did not recommend {expected}."}
            else:
                candidate = next((item for item in last_comparison.get("candidates", []) if item.get("id") == expected), None)
                required_fields = ["sku", "qty", "route_id" if expected == "transfer" else "vendor_id"]
                mismatches = [field for field in required_fields if not candidate or arguments.get(field) != candidate.get(field)]
                if mismatches:
                    result = {"error": f"Action blocked: parameters must match the optimized recommendation ({', '.join(mismatches)})."}
                else:
                    result = execute_tool(sim, name, arguments, contract)
        else:
            result = execute_tool(sim, name, arguments, contract)
        if name == "calculate_projected_shortages" and not result.get("error") and result.get("shortages"):
            shortage = max(result["shortages"], key=lambda item: item["shortage_qty"])
            provider.set_shortage(shortage["sku"], shortage["shortage_qty"])
        if name == "compare_recovery_options" and not result.get("error"):
            compared = True
            last_comparison = result
        call_id = f"call-{step + 1}"
        history.append({"call_id": call_id, "tool": name, "arguments": arguments, "result": result})
        title = name.replace("_", " ").title()
        _log(run, EVENT_TYPES.get(name, "tool"), title=title, tool=name, input=arguments, output=result, step=step + 1)
        if name == "verify_action_effect":
            _log_learning_update(run, result)
        if step_delay:
            time.sleep(random.uniform(step_delay, step_delay + 1))

        if name == "calculate_projected_shortages" and not result.get("error") and not result.get("shortages"):
            verification = execute_tool(sim, "verify_recovery_contract", {}, contract)
            _log(run, "certificate", title="Verify Recovery Contract", tool="verify_recovery_contract", input={}, output=verification, step=step + 2)
            run.verification = verification
            run.status = "verified" if verification.get("passed") else "failed"
            break

        if name in {"transfer_inventory", "create_purchase_order"} and result.get("action_id"):
            route_id = arguments.get("route_id", "R-VN")
            checkpoints = [(18, 100), (42, 65)] if name == "transfer_inventory" else [(20, 190), (55, 105), (85, 35), (100, 0)]
            for progress, eta_minutes in checkpoints:
                _log(
                    run, "transit", title="Driver location updated",
                    message=f"Driver is {progress}% along {route_id} toward {destination_name}, {destination_location}.",
                    output={"route_id": route_id, "progress": progress, "eta_minutes": eta_minutes, "destination_name": destination_name, "destination_location": destination_location},
                )
                if step_delay:
                    time.sleep(random.uniform(step_delay, step_delay + 1))

        if name == "compare_recovery_options" and not result.get("error") and result.get("recommended") is None:
            verification = execute_tool(sim, "verify_recovery_contract", {}, contract)
            history.append({"call_id": f"call-{step + 1}-verify", "tool": "verify_recovery_contract", "arguments": {}, "result": verification})
            _log(run, "certificate", title="Verify Recovery Contract", tool="verify_recovery_contract", input={}, output=verification, step=step + 1)
            run.verification = verification
            _log(run, "infeasible", title="Recovery contract is infeasible", message="No available recovery option can satisfy all current contract limits. Adjust the contract or restore network capacity, then start a new run.")
            run.status = "infeasible"
            break

        if name == "transfer_inventory" and result.get("action_id") and not sim.disruption_triggered:
            sim.routes[arguments["route_id"]].status = "closed"
            sim.disruption_triggered = True
            _log(run, "disruption", title="Route closed mid-transfer", message=f"Simulator closed {arguments['route_id']} after dispatch and before verification.", route_id=arguments["route_id"])
            if step_delay:
                time.sleep(random.uniform(step_delay, step_delay + 1))
        if name in {"transfer_inventory", "create_purchase_order"} and result.get("action_id"):
            investigated = set()
            compared = False
            last_comparison = None
        if name == "verify_action_effect" and result.get("passed") is False:
            _log(run, "replan", title="Live replan required", message="The chosen action is no longer viable. Re-investigating alternatives.")
            if step_delay:
                time.sleep(random.uniform(step_delay, step_delay + 1))
        if name == "verify_recovery_contract":
            run.verification = result
            if result.get("passed") is True:
                run.status = "verified"
                break
            if last_comparison and last_comparison.get("recommended") is None:
                _log(run, "infeasible", title="Recovery contract is infeasible", message="No available recovery option can satisfy all current contract limits. Adjust the contract or restore network capacity, then start a new run.")
                run.status = "infeasible"
                break
    if run.status == "running":
        run.status = "failed"
        _log(run, "error", title="Step limit reached", message=f"The agent did not achieve verified recovery within {max_steps} tool calls.")
    return run
