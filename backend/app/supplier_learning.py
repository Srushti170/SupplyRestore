"""Small contextual-bandit style supplier learner for the hackathon simulator.

It is deliberately advisory: contract filtering happens before this ranking and
the LLM still makes the action tool call.
"""
from __future__ import annotations


def initial_supplier_learning() -> dict[str, dict]:
    return {
        "V-RAPID": {"deliveries": 10, "on_time": 9, "failures": 0, "avg_delivery_hours": 3.8, "avg_cost": 338.0, "avg_carbon": 52.0, "mean_reward": 13.0},
        "V-BUDGET": {"deliveries": 8, "on_time": 6, "failures": 1, "avg_delivery_hours": 5.8, "avg_cost": 208.0, "avg_carbon": 52.0, "mean_reward": 7.0},
    }


def rank_suppliers(sim, vendors: list, qty: int, max_delay_hours: float) -> tuple[object | None, dict | None]:
    """Rank already-eligible vendors; exploration occurs every fifth purchase."""
    eligible = []
    for vendor in vendors:
        learning = sim.supplier_learning.get(vendor.id, {})
        deliveries = max(int(learning.get("deliveries", 0)), 1)
        on_time_rate = float(learning.get("on_time", 0)) / deliveries
        failure_rate = float(learning.get("failures", 0)) / deliveries
        reward = float(learning.get("mean_reward", 0))
        score = round(reward + on_time_rate * 5 - failure_rate * 8 - (vendor.unit_cost * qty) / 250, 2)
        eligible.append((score, vendor, learning, on_time_rate))
    if not eligible:
        return None, None
    eligible.sort(key=lambda item: item[0], reverse=True)
    exploring = len(eligible) > 1 and (sim.learning_decisions + 1) % 5 == 0
    selected = eligible[1] if exploring else eligible[0]
    score, vendor, learning, on_time_rate = selected
    recommendation = {
        "vendor_id": vendor.id, "vendor_name": vendor.name, "learned_score": score,
        "on_time_rate": round(on_time_rate * 100, 1), "sample_size": learning.get("deliveries", 0),
        "mean_reward": learning.get("mean_reward", 0), "mode": "exploration" if exploring else "learned preference",
        "reason": f"{vendor.name} ranks highest from simulated delivery outcomes" if not exploring else f"Exploration run: testing {vendor.name} against the learned preference",
    }
    return vendor, recommendation


def simulated_delivery_outcome(sim, vendor, qty: int, contract) -> dict:
    """Repeatable scenario outcomes, so learning has genuine successes/failures."""
    attempts = int(sim.supplier_learning.get(vendor.id, {}).get("deliveries", 0)) + 1
    if vendor.id == "V-BUDGET" and attempts % 4 == 0:
        successful, actual_hours = False, round(vendor.lead_time_hours + 3, 1)
    elif vendor.id == "V-BUDGET" and attempts % 3 == 0:
        successful, actual_hours = True, round(vendor.lead_time_hours + 2, 1)
    else:
        successful, actual_hours = True, round(max(1.0, vendor.lead_time_hours - (0.3 if vendor.id == "V-RAPID" else 0.5)), 1)
    on_time = successful and actual_hours <= contract.max_delay_hours
    return {"successful": successful, "on_time": on_time, "actual_delivery_hours": actual_hours, "attempt": attempts}


def update_learning(sim, vendor, *, successful: bool, on_time: bool, actual_hours: float, total_cost: float, carbon: float) -> dict:
    stats = sim.supplier_learning.setdefault(vendor.id, {"deliveries": 0, "on_time": 0, "failures": 0, "avg_delivery_hours": 0.0, "avg_cost": 0.0, "avg_carbon": 0.0, "mean_reward": 0.0})
    reward = (10 if successful else -10) + (8 if on_time else -6) - total_cost * .02 - carbon * .10
    count = int(stats["deliveries"]) + 1
    for key, value in (("avg_delivery_hours", actual_hours), ("avg_cost", total_cost), ("avg_carbon", carbon), ("mean_reward", reward)):
        stats[key] = round((float(stats[key]) * (count - 1) + value) / count, 2)
    stats["deliveries"] = count
    stats["on_time"] = int(stats["on_time"]) + int(on_time)
    stats["failures"] = int(stats["failures"]) + int(not successful)
    return {"vendor_id": vendor.id, "vendor_name": vendor.name, "reward": round(reward, 2), "successful": successful, "on_time": on_time, "actual_delivery_hours": actual_hours, "stats": dict(stats)}
