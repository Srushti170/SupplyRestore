from datetime import datetime, timedelta, timezone

from ..models import CustomerOrder, Product, Route, Shipment, Vendor, Warehouse


def seed_data() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "products": {
            p.id: p for p in [
                Product(id="SKU-100", name="VitalCare Sensor"),
                Product(id="SKU-200", name="Smart Shelf Tag"),
                Product(id="SKU-300", name="Cold Chain Logger"),
            ]
        },
        "warehouses": {
            w.id: w for w in [
                Warehouse(id="WH-NORTH", name="North Fulfilment Hub", inventory={"SKU-100": 4, "SKU-200": 70, "SKU-300": 25}),
                Warehouse(id="WH-SOUTH", name="South Reserve Hub", inventory={"SKU-100": 40, "SKU-200": 25, "SKU-300": 40}),
            ]
        },
        "vendors": {
            v.id: v for v in [
                Vendor(id="V-BUDGET", name="ValueSource", reliability=.91, unit_cost=7, lead_time_hours=12),
                Vendor(id="V-RAPID", name="RapidSupply", reliability=.99, unit_cost=12, lead_time_hours=4),
            ]
        },
        "routes": {
            r.id: r for r in [
                Route(id="R-SN", **{"from": "WH-SOUTH", "to": "WH-NORTH"}, status="open", carbon_per_unit=1, cost_per_unit=2, lead_time_hours=2),
                Route(id="R-VN", **{"from": "VENDOR", "to": "WH-NORTH"}, status="open", carbon_per_unit=2, cost_per_unit=1, lead_time_hours=4),
                Route(id="R-NS", **{"from": "WH-NORTH", "to": "WH-SOUTH"}, status="open", carbon_per_unit=1.2, cost_per_unit=2.5, lead_time_hours=3),
            ]
        },
        "shipments": {
            "SHIP-001": Shipment(id="SHIP-001", product="SKU-100", qty=30, route_id="R-VN", status="delayed", eta=(now + timedelta(hours=18)).isoformat())
        },
        "orders": [
            CustomerOrder(id="ORD-001", sku="SKU-100", qty=30, priority="high", due_date=(now + timedelta(hours=6)).isoformat()),
            CustomerOrder(id="ORD-002", sku="SKU-200", qty=18, priority="standard", due_date=(now + timedelta(hours=18)).isoformat()),
            CustomerOrder(id="ORD-003", sku="SKU-300", qty=12, priority="standard", due_date=(now + timedelta(hours=20)).isoformat()),
            CustomerOrder(id="ORD-004", sku="SKU-200", qty=15, priority="high", due_date=(now + timedelta(hours=8)).isoformat()),
            CustomerOrder(id="ORD-005", sku="SKU-300", qty=10, priority="standard", due_date=(now + timedelta(hours=24)).isoformat()),
            CustomerOrder(id="ORD-006", sku="SKU-200", qty=10, priority="standard", due_date=(now + timedelta(hours=26)).isoformat()),
        ],
    }

