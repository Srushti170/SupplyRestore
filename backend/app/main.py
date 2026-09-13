from __future__ import annotations

import os
from threading import Thread

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import run_agent
from .auth import (
    LoginRequest, SignupRequest, WarehouseInventoryRequest, WarehouseRequest,
    add_warehouse, apply_verified_inventory, current_user, delete_warehouse, get_recovery_history,
    login, logout, save_recovery_history, signup, update_warehouse_inventory,
)
from .models import AgentEvent, AgentRun, RecoveryContract
from .simulation.state import state


app = FastAPI(title="SupplyRestore API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    contract_id: str
    provider: str = "auto"
    scenario: str = "flagship"
    destination_name: str = "North Fulfilment Hub"
    destination_location: str = "Mumbai"
    destination_stock: int = 4
    source_name: str = "South Reserve Hub"
    source_location: str = "Nagpur"
    source_stock: int = 40
    destination_id: int | None = None
    source_id: int | None = None
    required_quantity: int = Field(default=30, gt=0, le=1_000_000)


@app.post("/auth/signup")
def create_account(request: SignupRequest) -> dict:
    return signup(request)


@app.post("/auth/login")
def login_account(request: LoginRequest) -> dict:
    return login(request)


@app.get("/auth/me")
def get_account(authorization: str | None = Header(default=None)) -> dict:
    return current_user(authorization)


@app.post("/auth/logout")
def logout_account(authorization: str | None = Header(default=None)) -> dict:
    logout(authorization)
    return {"ok": True}


@app.post("/warehouses")
def create_warehouse(request: WarehouseRequest, authorization: str | None = Header(default=None)) -> dict:
    user = current_user(authorization)
    return add_warehouse(user["id"], request)


@app.patch("/warehouses/{warehouse_id}/inventory")
def change_warehouse_inventory(warehouse_id: int, request: WarehouseInventoryRequest, authorization: str | None = Header(default=None)) -> dict:
    user = current_user(authorization)
    return update_warehouse_inventory(user["id"], warehouse_id, request.inventory)


@app.delete("/warehouses/{warehouse_id}")
def remove_warehouse(warehouse_id: int, authorization: str | None = Header(default=None)) -> dict:
    user = current_user(authorization)
    return delete_warehouse(user["id"], warehouse_id)


@app.get("/history")
def recovery_history(authorization: str | None = Header(default=None)) -> list[dict]:
    user = current_user(authorization)
    return get_recovery_history(user["id"])


@app.get("/health")
def health() -> dict:
    live_ai = bool(os.getenv("GROQ_API_KEY"))
    return {
        "status": "ok",
        "agent_mode": "live_ai" if live_ai else "local_deterministic",
        "model": os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b") if live_ai else None,
    }


@app.get("/state")
def get_operational_state() -> dict:
    return state.snapshot()


@app.post("/reset")
def reset() -> dict:
    if any(run.status == "running" for run in state.runs.values()):
        raise HTTPException(status_code=409, detail="A recovery run is already in progress")
    state.reset()
    return {"ok": True, "state": state.snapshot()}


@app.post("/contracts")
def create_contract(contract: RecoveryContract) -> RecoveryContract:
    state.contracts[contract.id] = contract
    return contract


@app.post("/runs")
def create_run(request: RunRequest, authorization: str | None = Header(default=None)) -> dict:
    if any(run.status == "running" for run in state.runs.values()):
        raise HTTPException(status_code=409, detail="A recovery run is already in progress")
    contract = state.contracts.get(request.contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Recovery Contract not found")
    if request.provider not in {"auto", "fake", "groq"}:
        raise HTTPException(status_code=400, detail="provider must be auto, fake, or groq")
    if request.scenario not in {"baseline", "flagship"}:
        raise HTTPException(status_code=400, detail="scenario must be baseline or flagship")
    user = current_user(authorization) if authorization else None
    destination_name = request.destination_name
    destination_location = request.destination_location
    destination_stock = max(0, request.destination_stock)
    source_name = request.source_name
    source_location = request.source_location
    source_stock = max(0, request.source_stock)
    if user:
        destination = next((item for item in user["warehouses"] if item["id"] == request.destination_id), None)
        if not destination:
            raise HTTPException(status_code=400, detail="Select a destination warehouse from your account")
        destination_name, destination_location = destination["name"], destination["location"]
        destination_stock = destination["inventory"]["SKU-100"]
        if request.source_id is not None:
            source = next((item for item in user["warehouses"] if item["id"] == request.source_id), None)
            if not source or source["id"] == destination["id"]:
                raise HTTPException(status_code=400, detail="Source warehouse must be another warehouse in your account")
            source_name, source_location = source["name"], source["location"]
            source_stock = source["inventory"]["SKU-100"]
    provider = "groq" if request.provider == "auto" and os.getenv("GROQ_API_KEY") else ("fake" if request.provider == "auto" else request.provider)
    state.warehouses["WH-NORTH"].name = destination_name
    state.warehouses["WH-NORTH"].inventory["SKU-100"] = destination_stock
    state.warehouses["WH-SOUTH"].name = source_name
    state.warehouses["WH-SOUTH"].inventory["SKU-100"] = source_stock
    for order in state.orders:
        if order.id == "ORD-001":
            order.qty = request.required_quantity
    if "SHIP-001" in state.shipments:
        state.shipments["SHIP-001"].qty = request.required_quantity
    before = {"destination": destination_stock, "source": source_stock}
    run = AgentRun(provider=provider)
    state.runs[run.id] = run
    def worker() -> None:
        try:
            run_agent(
                state, contract, provider, request.scenario, run=run, step_delay=2.0,
                destination_name=destination_name,
                destination_location=destination_location,
            )
        except Exception as exc:
            run.status = "failed"
            run.events.append(AgentEvent(type="error", content={"title": "Run failed", "message": str(exc)}))
        finally:
            if user:
                final_state = state.snapshot()
                final_destination = state.warehouses["WH-NORTH"].inventory["SKU-100"]
                final_source = state.warehouses["WH-SOUTH"].inventory["SKU-100"]
                try:
                    if run.status == "verified":
                        apply_verified_inventory(
                            user["id"], request.destination_id, final_destination,
                            request.source_id, final_source if request.source_id is not None else None,
                        )
                    save_recovery_history(
                        user["id"], run.id, run.status, destination_name, destination_location,
                        {
                            "provider": run.provider,
                            "required_quantity": request.required_quantity,
                            "destination": {"id": request.destination_id, "name": destination_name, "location": destination_location, "before": before["destination"], "after": final_destination if run.status == "verified" else before["destination"]},
                            "source": {"id": request.source_id, "name": source_name, "location": source_location, "before": before["source"], "after": final_source if run.status == "verified" and request.source_id is not None else before["source"]},
                            "run": {**run.model_dump(), "state": final_state},
                        },
                    )
                except Exception as persistence_error:
                    run.events.append(AgentEvent(type="error", content={"title": "Result sync warning", "message": str(persistence_error)}))
    Thread(target=worker, daemon=True, name=f"supplyrestore-{run.id[:8]}").start()
    return {"id": run.id, "status": run.status}


@app.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run = state.runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {**run.model_dump(), "state": state.snapshot()}


@app.get("/runs/{run_id}/certificate")
def get_certificate(run_id: str) -> dict:
    run = state.runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not run.verification:
        raise HTTPException(status_code=409, detail="Run has no verification certificate")
    return {"run_id": run.id, "status": run.status, "provider": run.provider, **run.verification}
