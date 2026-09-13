from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from pathlib import Path
from threading import Lock

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "supplyrestore.db"
_sessions: dict[str, int] = {}
_session_lock = Lock()


class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    warehouse_name: str = Field(min_length=2, max_length=100)
    warehouse_location: str = Field(min_length=3, max_length=200)
    warehouse_inventory: int = Field(default=0, ge=0, le=1_000_000)


class LoginRequest(BaseModel):
    username: str
    password: str


class WarehouseRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    location: str = Field(min_length=3, max_length=200)
    inventory: int = Field(default=0, ge=0, le=1_000_000)


class WarehouseInventoryRequest(BaseModel):
    inventory: int = Field(ge=0, le=1_000_000)


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_auth_db() -> None:
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                warehouse_name TEXT NOT NULL,
                warehouse_location TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recovery_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                destination_name TEXT NOT NULL,
                destination_location TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                sku_100 INTEGER NOT NULL DEFAULT 4,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(warehouses)").fetchall()}
        if "sku_100" not in columns:
            connection.execute("ALTER TABLE warehouses ADD COLUMN sku_100 INTEGER NOT NULL DEFAULT 4")
        if connection.execute("PRAGMA user_version").fetchone()[0] < 2:
            connection.execute(
                """
                UPDATE warehouses
                SET sku_100 = CASE
                    WHEN (SELECT COUNT(*) FROM warehouses previous WHERE previous.user_id = warehouses.user_id AND previous.id <= warehouses.id) = 1 THEN 4
                    WHEN (SELECT COUNT(*) FROM warehouses previous WHERE previous.user_id = warehouses.user_id AND previous.id <= warehouses.id) = 2 THEN 40
                    ELSE MIN(36, 14 + 4 * (SELECT COUNT(*) FROM warehouses previous WHERE previous.user_id = warehouses.user_id AND previous.id <= warehouses.id))
                END
                """
            )
            connection.execute("PRAGMA user_version = 2")
        try:
            connection.execute(
                """
                INSERT INTO warehouses (user_id, name, location, sku_100)
                SELECT id, warehouse_name, warehouse_location, 4 FROM users
                WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouses.user_id = users.id)
                """
            )
        except sqlite3.OperationalError as exc:
            # A running Windows dev server can briefly hold the existing DB read-only
            # while this module is imported by a second process. The schema already
            # exists in that case; the server performs the migration on reload.
            if "readonly" not in str(exc).lower():
                raise


def _hash_password(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), actual_salt, 210_000)
    return f"{actual_salt.hex()}:{digest.hex()}"


def _password_matches(password: str, stored: str) -> bool:
    salt_hex, expected = stored.split(":", 1)
    actual = _hash_password(password, bytes.fromhex(salt_hex)).split(":", 1)[1]
    return hmac.compare_digest(actual, expected)


def _public_user(row: sqlite3.Row) -> dict:
    with _connect() as connection:
        warehouse_rows = connection.execute("SELECT id, name, location, sku_100 FROM warehouses WHERE user_id = ? ORDER BY id", (row["id"],)).fetchall()
        warehouses = [{"id": item["id"], "name": item["name"], "location": item["location"], "inventory": {"SKU-100": item["sku_100"]}} for item in warehouse_rows]
    primary = warehouses[0] if warehouses else {"name": row["warehouse_name"], "location": row["warehouse_location"]}
    return {
        "id": row["id"],
        "name": row["name"],
        "username": row["username"],
        "warehouse_name": primary["name"],
        "warehouse_location": primary["location"],
        "warehouses": warehouses,
    }


def signup(payload: SignupRequest) -> dict:
    values = {
        "name": payload.name.strip(),
        "username": payload.username.strip(),
        "password_hash": _hash_password(payload.password),
        "warehouse_name": payload.warehouse_name.strip(),
        "warehouse_location": payload.warehouse_location.strip(),
    }
    if not all((values["name"], values["username"], values["warehouse_name"], values["warehouse_location"])):
        raise HTTPException(status_code=400, detail="All warehouse account fields are required")
    try:
        with _connect() as connection:
            cursor = connection.execute(
                "INSERT INTO users (name, username, password_hash, warehouse_name, warehouse_location) VALUES (:name, :username, :password_hash, :warehouse_name, :warehouse_location)",
                values,
            )
            connection.execute(
                "INSERT INTO warehouses (user_id, name, location, sku_100) VALUES (?, ?, ?, ?)",
                (cursor.lastrowid, values["warehouse_name"], values["warehouse_location"], payload.warehouse_inventory),
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="This username is already registered") from None
    return _create_session(row)


def login(payload: LoginRequest) -> dict:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (payload.username.strip(),)).fetchone()
    if not row or not _password_matches(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return _create_session(row)


def _create_session(row: sqlite3.Row) -> dict:
    token = secrets.token_urlsafe(32)
    with _session_lock:
        _sessions[token] = row["id"]
    return {"token": token, "user": _public_user(row)}


def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    token = authorization.removeprefix("Bearer ").strip()
    with _session_lock:
        user_id = _sessions.get(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Session expired")
    with _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Account not found")
    return _public_user(row)


def logout(authorization: str | None) -> None:
    if authorization and authorization.startswith("Bearer "):
        with _session_lock:
            _sessions.pop(authorization.removeprefix("Bearer ").strip(), None)


def add_warehouse(user_id: int, payload: WarehouseRequest) -> dict:
    name = payload.name.strip()
    location = payload.location.strip()
    if not name or not location:
        raise HTTPException(status_code=400, detail="Warehouse name and location are required")
    with _connect() as connection:
        connection.execute("INSERT INTO warehouses (user_id, name, location, sku_100) VALUES (?, ?, ?, ?)", (user_id, name, location, payload.inventory))
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public_user(row)


def update_warehouse_inventory(user_id: int, warehouse_id: int, inventory: int) -> dict:
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE warehouses SET sku_100 = ? WHERE id = ? AND user_id = ?",
            (inventory, warehouse_id, user_id),
        )
        if cursor.rowcount != 1:
            raise HTTPException(status_code=404, detail="Warehouse not found")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public_user(row)


def apply_verified_inventory(
    user_id: int,
    destination_id: int,
    destination_stock: int,
    source_id: int | None,
    source_stock: int | None,
) -> None:
    """Atomically write a verified simulator outcome back to owned warehouses."""
    with _connect() as connection:
        destination = connection.execute(
            "UPDATE warehouses SET sku_100 = ? WHERE id = ? AND user_id = ?",
            (destination_stock, destination_id, user_id),
        )
        if destination.rowcount != 1:
            raise HTTPException(status_code=404, detail="Destination warehouse not found")
        if source_id is not None and source_stock is not None:
            source = connection.execute(
                "UPDATE warehouses SET sku_100 = ? WHERE id = ? AND user_id = ?",
                (source_stock, source_id, user_id),
            )
            if source.rowcount != 1:
                raise HTTPException(status_code=404, detail="Source warehouse not found")


def save_recovery_history(user_id: int, run_id: str, status: str, destination_name: str, destination_location: str, payload: dict) -> None:
    with _connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO recovery_history
                (run_id, user_id, status, destination_name, destination_location, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (run_id, user_id, status, destination_name, destination_location, json.dumps(payload)),
        )


def get_recovery_history(user_id: int) -> list[dict]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT id, run_id, status, destination_name, destination_location, payload, created_at FROM recovery_history WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()
    return [
        {
            "id": row["id"], "run_id": row["run_id"], "status": row["status"],
            "destination_name": row["destination_name"], "destination_location": row["destination_location"],
            "created_at": row["created_at"], **json.loads(row["payload"]),
        }
        for row in rows
    ]


init_auth_db()
