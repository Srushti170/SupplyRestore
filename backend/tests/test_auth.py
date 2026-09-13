import pytest
from fastapi import HTTPException

import app.auth as auth


def test_multiple_warehouse_accounts_login_independently(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "DB_PATH", tmp_path / "auth-test.db")
    auth.init_auth_db()
    auth._sessions.clear()

    first = auth.signup(auth.SignupRequest(name="Asha", username="asha@example.com", password="secret1", warehouse_name="Pune Hub", warehouse_location="Pune, Maharashtra"))
    second = auth.signup(auth.SignupRequest(name="Ravi", username="ravi", password="secret2", warehouse_name="Mumbai Hub", warehouse_location="Mumbai, Maharashtra"))

    assert first["user"]["warehouse_name"] == "Pune Hub"
    assert second["user"]["warehouse_name"] == "Mumbai Hub"
    session = auth.login(auth.LoginRequest(username="asha@example.com", password="secret1"))
    assert auth.current_user(f"Bearer {session['token']}")["warehouse_location"] == "Pune, Maharashtra"
    updated = auth.add_warehouse(first["user"]["id"], auth.WarehouseRequest(name="Nashik Hub", location="Nashik, Maharashtra"))
    assert [warehouse["name"] for warehouse in updated["warehouses"]] == ["Pune Hub", "Nashik Hub"]

    auth.logout(f"Bearer {session['token']}")
    with pytest.raises(HTTPException) as expired:
        auth.current_user(f"Bearer {session['token']}")
    assert expired.value.status_code == 401
