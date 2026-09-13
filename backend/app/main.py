from __future__ import annotations

import os
from threading import Thread

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .agent import run_agent
from .auth import WarehouseRequest, LoginRequest, SignupRequest, add_warehouse, current_user, login, logout, signup
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
def create_run(request: RunRequest) -> dict:
    if any(run.status == "running" for run in state.runs.values()):
        raise HTTPException(status_code=409, detail="A recovery run is already in progress")
    contract = state.contracts.get(request.contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Recovery Contract not found")
    if request.provider not in {"auto", "fake", "groq"}:
        raise HTTPException(status_code=400, detail="provider must be auto, fake, or groq")
    if request.scenario not in {"baseline", "flagship"}:
        raise HTTPException(status_code=400, detail="scenario must be baseline or flagship")
    provider = "groq" if request.provider == "auto" and os.getenv("GROQ_API_KEY") else ("fake" if request.provider == "auto" else request.provider)
    run = AgentRun(provider=provider)
    state.runs[run.id] = run
    def worker() -> None:
        try:
            run_agent(
                state, contract, provider, request.scenario, run=run, step_delay=2.0,
                destination_name=request.destination_name,
                destination_location=request.destination_location,
            )
        except Exception as exc:
            run.status = "failed"
            run.events.append(AgentEvent(type="error", content={"title": "Run failed", "message": str(exc)}))
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
