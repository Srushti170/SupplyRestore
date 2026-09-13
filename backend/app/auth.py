from __future__ import annotations

import hashlib
import hmac
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


class LoginRequest(BaseModel):
    username: str
    password: str


class WarehouseRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    location: str = Field(min_length=3, max_length=200)


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
            CREATE TABLE IF NOT EXISTS warehouses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        try:
            connection.execute(
                """
                INSERT INTO warehouses (user_id, name, location)
                SELECT id, warehouse_name, warehouse_location FROM users
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
        warehouses = [dict(item) for item in connection.execute("SELECT id, name, location FROM warehouses WHERE user_id = ? ORDER BY id", (row["id"],)).fetchall()]
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
                "INSERT INTO warehouses (user_id, name, location) VALUES (?, ?, ?)",
                (cursor.lastrowid, values["warehouse_name"], values["warehouse_location"]),
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
        connection.execute("INSERT INTO warehouses (user_id, name, location) VALUES (?, ?, ?)", (user_id, name, location))
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public_user(row)


init_auth_db()
