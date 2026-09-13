from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Product(BaseModel):
    id: str
    name: str


class Warehouse(BaseModel):
    id: str
    name: str
    inventory: dict[str, int]


class Vendor(BaseModel):
    id: str
    name: str
    reliability: float
    unit_cost: float
    lead_time_hours: float
    blocked: bool = False


class Route(BaseModel):
    id: str
    source: str = Field(alias="from")
    destination: str = Field(alias="to")
    status: Literal["open", "closed"]
    carbon_per_unit: float
    cost_per_unit: float
    lead_time_hours: float

    model_config = {"populate_by_name": True}


class Shipment(BaseModel):
    id: str
    product: str
    qty: int
    route_id: str
    status: Literal["in_transit", "delayed", "delivered"]
    eta: str


class CustomerOrder(BaseModel):
    id: str
    sku: str
    qty: int
    priority: Literal["standard", "high"]
    due_date: str


class RecoveryContract(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    min_fulfilment_pct: float = 100
    max_extra_cost: float = 500
    max_extra_carbon: float = 100
    max_delay_hours: float = 8
    blocked_vendors: list[str] = Field(default_factory=list)
    prohibited_routes: list[str] = Field(default_factory=list)


class AgentEvent(BaseModel):
    type: str
    content: dict[str, Any]
    timestamp: str = Field(default_factory=now_iso)


class AgentRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    status: Literal["running", "verified", "failed"] = "running"
    provider: str = "fake"
    events: list[AgentEvent] = Field(default_factory=list)
    verification: dict[str, Any] | None = None


class VerificationCheck(BaseModel):
    name: str
    passed: bool
    detail: str


class VerificationResult(BaseModel):
    passed: bool
    checks: list[VerificationCheck]

