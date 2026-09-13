import pytest
from fastapi import HTTPException

import app.auth as auth


def test_multiple_warehouse_accounts_login_independently(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "DB_PATH", tmp_path / "auth-test.db")
    auth.init_auth_db()
    auth._sessions.clear()

    first = auth.signup(auth.SignupRequest(name="Asha", username="asha@example.com", password="secret1", warehouse_name="Pune Hub", warehouse_location="Pune, Maharashtra", warehouse_inventory=7))
    second = auth.signup(auth.SignupRequest(name="Ravi", username="ravi", password="secret2", warehouse_name="Mumbai Hub", warehouse_location="Mumbai, Maharashtra", warehouse_inventory=11))

    assert first["user"]["warehouse_name"] == "Pune Hub"
    assert second["user"]["warehouse_name"] == "Mumbai Hub"
    session = auth.login(auth.LoginRequest(username="asha@example.com", password="secret1"))
    assert auth.current_user(f"Bearer {session['token']}")["warehouse_location"] == "Pune, Maharashtra"
    updated = auth.add_warehouse(first["user"]["id"], auth.WarehouseRequest(name="Nashik Hub", location="Nashik, Maharashtra", inventory=42))
    assert [warehouse["name"] for warehouse in updated["warehouses"]] == ["Pune Hub", "Nashik Hub"]
    assert [warehouse["inventory"]["SKU-100"] for warehouse in updated["warehouses"]] == [7, 42]

    destination_id, source_id = [warehouse["id"] for warehouse in updated["warehouses"]]
    revised = auth.update_warehouse_inventory(first["user"]["id"], destination_id, 9)
    assert revised["warehouses"][0]["inventory"]["SKU-100"] == 9
    auth.apply_verified_inventory(first["user"]["id"], destination_id, 30, source_id, 21)
    final_user = auth.current_user(f"Bearer {session['token']}")
    assert [warehouse["inventory"]["SKU-100"] for warehouse in final_user["warehouses"]] == [30, 21]

    auth.save_recovery_history(first["user"]["id"], "RUN-1", "verified", "Pune Hub", "Pune", {"required_quantity": 30})
    assert auth.get_recovery_history(first["user"]["id"])[0]["run_id"] == "RUN-1"

    auth.logout(f"Bearer {session['token']}")
    with pytest.raises(HTTPException) as expired:
        auth.current_user(f"Bearer {session['token']}")
    assert expired.value.status_code == 401
