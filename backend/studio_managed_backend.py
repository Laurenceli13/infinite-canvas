#!/usr/bin/env python3
from __future__ import annotations

import base64
import concurrent.futures
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

try:
    import cgi
except ModuleNotFoundError:  # pragma: no cover - Python 3.13+ compatibility for test imports
    cgi = None

try:
    import requests
except ModuleNotFoundError:  # pragma: no cover - keep lightweight unit tests importable
    class _RequestsCompat:
        class Session:  # type: ignore[empty-body]
            pass

        class Response:  # type: ignore[empty-body]
            pass

        def __getattr__(self, name: str) -> Any:
            raise ModuleNotFoundError("requests is required to use studio_managed_backend network features")

    requests = _RequestsCompat()


def normalize_massmore_bridge_base(value: str) -> str:
    """Normalize the public Japan bridge origin to its Nginx-mounted path."""
    base = str(value or "").rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.hostname and parsed.hostname.lower().rstrip(".") == "origin-jp-sub2api.linkfoai.com" and parsed.path in {"", "/"}:
        return f"{base}/__studio_managed_bridge"
    return base


HOST = os.environ.get("STUDIO_MANAGED_HOST", "127.0.0.1")
PORT = int(os.environ.get("STUDIO_MANAGED_PORT", "18180"))
DATA_DIR = Path(os.environ.get("STUDIO_MANAGED_DATA_DIR", "/srv/studio-managed"))
DB_PATH = Path(os.environ.get("STUDIO_MANAGED_DB", str(DATA_DIR / "studio.db")))
SESSION_TTL = int(os.environ.get("STUDIO_SESSION_TTL", "2592000"))
POINTS_PER_DOLLAR = float(os.environ.get("STUDIO_POINTS_PER_DOLLAR", "3"))
SOURCE_BALANCE_UNITS_PER_DOLLAR = float(os.environ.get("STUDIO_SOURCE_BALANCE_UNITS_PER_DOLLAR", "1"))
MASSMORE_SOURCE_BALANCE_UNITS_PER_DOLLAR = float(os.environ.get("STUDIO_MASSMORE_SOURCE_BALANCE_UNITS_PER_DOLLAR", os.environ.get("STUDIO_SOURCE_BALANCE_UNITS_PER_DOLLAR", "1")))
MTLINE_SOURCE_BALANCE_UNITS_PER_DOLLAR = float(os.environ.get("STUDIO_MTLINE_SOURCE_BALANCE_UNITS_PER_DOLLAR", os.environ.get("STUDIO_SOURCE_BALANCE_UNITS_PER_DOLLAR", "1")))
STUDIO_ADMIN_TEST_POINTS = float(os.environ.get("STUDIO_ADMIN_TEST_POINTS", "999999999"))
MASSMORE_BRIDGE = normalize_massmore_bridge_base(os.environ.get("MASSMORE_BRIDGE_BASE", "http://127.0.0.1:18111"))
MASSMORE_MANAGED_SECRET = os.environ.get("LINKFOAI_MANAGED_SECRET", "")
MTLINE_BASE = os.environ.get("MTLINE_BASE", "https://mtline.cc").rstrip("/")
MTLINE_BILLING_BASE = os.environ.get("MTLINE_BILLING_BASE", "https://api-us.mtline.cc/studio-mtline-billing").rstrip("/")
MTLINE_BILLING_SECRET = os.environ.get("MTLINE_BILLING_SECRET", "")
REQUEST_TIMEOUT = int(os.environ.get("STUDIO_UPSTREAM_TIMEOUT", "240"))
MAX_JSON_BODY_BYTES = max(16 * 1024, int(os.environ.get("STUDIO_MAX_JSON_BODY_BYTES", str(2 * 1024 * 1024))))
MAX_MULTIPART_BODY_BYTES = max(MAX_JSON_BODY_BYTES, int(os.environ.get("STUDIO_MAX_MULTIPART_BODY_BYTES", str(64 * 1024 * 1024))))
MAX_MULTIPART_FILES = max(1, int(os.environ.get("STUDIO_MAX_MULTIPART_FILES", "20")))
MAX_MULTIPART_FIELDS = max(8, int(os.environ.get("STUDIO_MAX_MULTIPART_FIELDS", "100")))
MASSMORE_INTERNAL_API_BASE = os.environ.get("STUDIO_MASSMORE_INTERNAL_API_BASE", "").rstrip("/")
MTLINE_INTERNAL_API_BASE = os.environ.get("STUDIO_MTLINE_INTERNAL_API_BASE", "").rstrip("/")
MTLINE_INTERNAL_ORIGIN_TOKEN = os.environ.get("STUDIO_MTLINE_INTERNAL_ORIGIN_TOKEN", "").strip()
MTLINE_INTERNAL_ORIGIN_TOKEN_FILE = os.environ.get("STUDIO_MTLINE_INTERNAL_ORIGIN_TOKEN_FILE", "").strip()
MTLINE_INTERNAL_ORIGIN_HEADER = os.environ.get("STUDIO_MTLINE_INTERNAL_ORIGIN_HEADER", "X-Mtline-Origin-Token").strip() or "X-Mtline-Origin-Token"
# A value of 0 explicitly disables Studio's per-provider image semaphore. The
# administrator's global and per-user limits remain the scheduling controls.
IMAGE_UPSTREAM_CONCURRENCY = max(0, int(os.environ.get("STUDIO_IMAGE_UPSTREAM_CONCURRENCY", "2")))
IMAGE_UPSTREAM_QUEUE_TIMEOUT = max(1, int(os.environ.get("STUDIO_IMAGE_QUEUE_TIMEOUT", str(REQUEST_TIMEOUT))))
ASYNC_GENERATION_ENABLED = os.environ.get("STUDIO_ASYNC_GENERATION_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
ASYNC_GENERATION_PERCENT = max(0, min(100, int(os.environ.get("STUDIO_ASYNC_GENERATION_PERCENT", "100"))))
USER_GENERATION_CONCURRENCY = max(1, int(os.environ.get("STUDIO_USER_GENERATION_CONCURRENCY", "4")))
# A value of 0 disables the executor's fixed ceiling. Threads are created only
# when tasks are submitted; the administrator controls the actual load through
# the persisted global and per-user scheduler limits.
_configured_executor_workers = int(os.environ.get("STUDIO_ASYNC_EXECUTOR_WORKERS", "0"))
ASYNC_EXECUTOR_WORKERS = sys.maxsize if _configured_executor_workers == 0 else max(USER_GENERATION_CONCURRENCY, _configured_executor_workers)
GLOBAL_GENERATION_CONCURRENCY = max(1, int(os.environ.get("STUDIO_GLOBAL_GENERATION_CONCURRENCY", str(USER_GENERATION_CONCURRENCY))))
# 4K image providers can take several minutes after accepting a request.
# Keep the durable job alive long enough for the browser to continue polling.
ASYNC_JOB_TIMEOUT = max(REQUEST_TIMEOUT, int(os.environ.get("STUDIO_ASYNC_JOB_TIMEOUT", "1800")))
ASYNC_RESULT_TTL = max(3600, int(os.environ.get("STUDIO_ASYNC_RESULT_TTL_HOURS", "6")) * 3600)
ASYNC_DELIVERED_TTL = max(60, int(os.environ.get("STUDIO_ASYNC_DELIVERED_TTL_MINUTES", "10")) * 60)
ASYNC_CLEANUP_INTERVAL = max(30, int(os.environ.get("STUDIO_ASYNC_CLEANUP_INTERVAL_SECONDS", "300")))
ASYNC_WORKER_URL = os.environ.get("STUDIO_ASYNC_WORKER_URL", "").rstrip("/")
# Browser downloads stay on the Studio origin. Nginx streams this path to the
# Worker so clients do not need to reach the workers.dev hostname directly.
ASYNC_PUBLIC_ASSET_BASE = os.environ.get("STUDIO_ASYNC_PUBLIC_ASSET_BASE", "").rstrip("/")
ASYNC_SHARED_SECRET = os.environ.get("STUDIO_ASYNC_SHARED_SECRET", "").strip()
ASYNC_SHARED_SECRET_FILE = os.environ.get("STUDIO_ASYNC_SHARED_SECRET_FILE", "").strip()
ASYNC_JOB_DIR = Path(os.environ.get("STUDIO_ASYNC_JOB_DIR", str(DATA_DIR / "jobs")))
ASYNC_KILL_SWITCH_FILE = Path(os.environ.get("STUDIO_ASYNC_KILL_SWITCH_FILE", "/etc/studio-managed/async-disabled"))

_IMAGE_UPSTREAM_SLOTS: dict[str, threading.BoundedSemaphore] = {}
_IMAGE_UPSTREAM_SLOTS_LOCK = threading.Lock()
_ACTIVE_GENERATIONS: dict[str, dict[str, Any]] = {}
_ACTIVE_GENERATIONS_LOCK = threading.Lock()
_JOB_WAKE_EVENT = threading.Event()
_JOB_STOP_EVENT = threading.Event()
_CLEANUP_WAKE_EVENT = threading.Event()
_JOB_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=ASYNC_EXECUTOR_WORKERS, thread_name_prefix="studio-job")
_JOB_FUTURES: dict[str, concurrent.futures.Future[Any]] = {}
_JOB_FUTURES_LOCK = threading.Lock()
_AUTH_RATE_LOCK = threading.Lock()
_AUTH_RATE_STATE: dict[str, list[float]] = {}
AUTH_RATE_WINDOW = max(10, int(os.environ.get("STUDIO_AUTH_RATE_WINDOW_SECONDS", "300")))
AUTH_RATE_MAX_ATTEMPTS = max(3, int(os.environ.get("STUDIO_AUTH_RATE_MAX_ATTEMPTS", "12")))

PROTOCOL_TEMPLATE_DEFAULTS = {
    "openai": "openai",
    "sora": "openai",
    "grok": "openai",
    "mimo": "openai",
    "gemini": "gemini",
    "imagen": "gemini",
    "veo": "gemini",
    "omni": "gemini",
    "agnes": "agnes",
    "seedance": "generic_async",
    "minimax": "generic_async",
    "midjourney": "generic_async",
    "kling": "generic_async",
    "happyhors": "generic_async",
}

WORKFLOW_DEFINITIONS = {
    "ecommerce-suite": {
        "name": "电商生图套组",
        "description": "主图、SKU 图、详情图、产品场景图和模特图",
    },
    "fashion-suite": {
        "name": "鞋服箱包生图套组",
        "description": "新款设计、新配色、九宫格和模特图",
    },
    "video-suite": {
        "name": "视频生成套组",
        "description": "角色九视图、视频首尾帧和一致性成片",
    },
}


class StudioError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def safe_positive_float(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return parsed if parsed > 0 else fallback


def active_generation_id(headers: Any) -> str:
    value = str(headers.get("X-Studio-Generation-Id") or "").strip()
    return value if re.fullmatch(r"[A-Za-z0-9_-]{8,128}", value) else ""


def register_active_generation(headers: Any, session: dict[str, Any]) -> tuple[str, threading.Event | None]:
    request_id = active_generation_id(headers)
    if not request_id:
        return "", None
    cancelled = threading.Event()
    with _ACTIVE_GENERATIONS_LOCK:
        _ACTIVE_GENERATIONS[request_id] = {
            "cancelled": cancelled,
            "source": str(session.get("source") or ""),
            "user_id": str(session.get("user_id") or ""),
            "submitted": False,
        }
    return request_id, cancelled


def release_active_generation(request_id: str) -> None:
    if not request_id:
        return
    with _ACTIVE_GENERATIONS_LOCK:
        _ACTIVE_GENERATIONS.pop(request_id, None)


def mark_active_generation_submitted(request_id: str) -> None:
    if not request_id:
        return
    with _ACTIVE_GENERATIONS_LOCK:
        current = _ACTIVE_GENERATIONS.get(request_id)
        if current:
            current["submitted"] = True


def cancel_active_generation(session: dict[str, Any], request_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", request_id):
        return "not_found"
    with _ACTIVE_GENERATIONS_LOCK:
        current = _ACTIVE_GENERATIONS.get(request_id)
        if not current:
            return "not_found"
        if current["source"] != str(session.get("source") or "") or current["user_id"] != str(session.get("user_id") or ""):
            return "not_found"
        if current["submitted"]:
            return "in_progress"
        current["cancelled"].set()
        return "cancelled"


def source_units_per_dollar(source: str | None = None) -> float:
    normalized = str(source or "").strip().lower()
    if normalized == "massmore":
        return runtime_positive_float("pricing_massmoreSourceBalanceUnitsPerDollar", MASSMORE_SOURCE_BALANCE_UNITS_PER_DOLLAR)
    if normalized == "mtline":
        return runtime_positive_float("pricing_mtlineSourceBalanceUnitsPerDollar", MTLINE_SOURCE_BALANCE_UNITS_PER_DOLLAR)
    return runtime_positive_float("pricing_sourceBalanceUnitsPerDollar", SOURCE_BALANCE_UNITS_PER_DOLLAR)


def configured_points_per_dollar() -> float:
    return runtime_positive_float("pricing_pointsPerDollar", POINTS_PER_DOLLAR)


def runtime_positive_float(key: str, fallback: Any) -> float:
    try:
        with db() as conn:
            row = conn.execute("select value from studio_runtime_settings where key=?", (key,)).fetchone()
        return safe_positive_float(row["value"] if row else fallback, float(fallback))
    except sqlite3.Error:
        return safe_positive_float(fallback, 1.0)


def studio_points_from_balance(balance: Any, source: str | None = None) -> float:
    units_per_dollar = source_units_per_dollar(source)
    points_per_dollar = configured_points_per_dollar()
    return max(0.0, float(balance or 0)) / units_per_dollar * points_per_dollar


def source_balance_from_points(points: Any, source: str | None = None) -> float:
    units_per_dollar = source_units_per_dollar(source)
    points_per_dollar = configured_points_per_dollar()
    return max(0.0, float(points or 0)) / points_per_dollar * units_per_dollar


def now() -> int:
    return int(time.time())


def auth_rate_check(key: str) -> None:
    cutoff = time.monotonic() - AUTH_RATE_WINDOW
    with _AUTH_RATE_LOCK:
        attempts = [stamp for stamp in _AUTH_RATE_STATE.get(key, []) if stamp >= cutoff]
        if attempts:
            _AUTH_RATE_STATE[key] = attempts
        else:
            _AUTH_RATE_STATE.pop(key, None)
        if len(attempts) >= AUTH_RATE_MAX_ATTEMPTS:
            raise StudioError(429, "Too many login attempts. Please try again later.")


def auth_rate_failure(key: str) -> None:
    cutoff = time.monotonic() - AUTH_RATE_WINDOW
    with _AUTH_RATE_LOCK:
        attempts = [stamp for stamp in _AUTH_RATE_STATE.get(key, []) if stamp >= cutoff]
        attempts.append(time.monotonic())
        _AUTH_RATE_STATE[key] = attempts[-AUTH_RATE_MAX_ATTEMPTS:]


def auth_rate_success(key: str) -> None:
    with _AUTH_RATE_LOCK:
        _AUTH_RATE_STATE.pop(key, None)


def redact_error_message(value: Any) -> str:
    message = str(value or "")
    message = re.sub(r"(?i)(authorization|api[-_ ]?key|token|secret)(\s*[:=]\s*)([^\s,;]+)", r"\1\2[redacted]", message)
    message = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", message)
    return message[:1000]


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def response_json(response: Any) -> Any:
    """Parse a provider response without assuming requests.Response.json()."""
    raw = bytes(getattr(response, "content", b"") or b"")
    if not raw:
        return {}
    text = raw.decode("utf-8-sig", errors="replace").strip()
    if not text:
        return {}
    return json.loads(text)


def _image_item_from_value(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    for key in ("b64_json", "b64Json", "base64", "base64_data", "image_base64"):
        encoded = value.get(key)
        if isinstance(encoded, str) and encoded.strip():
            return {"b64_json": encoded.strip()}
    for key in ("url", "image_url", "imageUrl", "output_url", "outputUrl", "image"):
        candidate = value.get(key)
        if isinstance(candidate, dict):
            candidate = candidate.get("url") or candidate.get("href")
        if isinstance(candidate, str) and candidate.strip():
            target = candidate.strip()
            if target.startswith(("http://", "https://", "data:image/")):
                return {"url": target}
    return None


def image_items_from_payload(payload: Any) -> list[dict[str, Any]]:
    """Extract image results from OpenAI-compatible and relay-specific payloads."""
    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            item = _image_item_from_value(value)
            if item:
                marker = json.dumps(item, ensure_ascii=False, sort_keys=True)
                if marker not in seen:
                    seen.add(marker)
                    items.append(item)
                    return
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(payload)
    return items


def parse_sse_json_events(body: bytes) -> list[Any]:
    text = body.decode("utf-8-sig", errors="replace")
    events: list[Any] = []
    for block in re.split(r"\r?\n\r?\n", text):
        data_lines = [
            line[5:].lstrip()
            for line in block.splitlines()
            if line.startswith("data:")
        ]
        if not data_lines:
            continue
        data = "\n".join(data_lines).strip()
        if not data or data == "[DONE]":
            continue
        try:
            events.append(json.loads(data))
        except json.JSONDecodeError:
            continue
    return events


def normalized_image_response(response: Any) -> tuple[Any, bytes, str, int]:
    """Return a canonical JSON image payload for every successful image response."""
    body = bytes(getattr(response, "content", b"") or b"")
    content_type = str(getattr(response, "headers", {}).get("Content-Type", "") or "").split(";", 1)[0].strip().lower()
    if content_type.startswith("image/"):
        payload = {"data": [{"b64_json": base64.b64encode(body).decode("ascii")}]}
        return payload, json_bytes(payload), "application/json; charset=utf-8", 1

    payload: Any = {}
    try:
        payload = response_json(response)
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}
    items = image_items_from_payload(payload)
    if not items and content_type in {"text/event-stream", "application/x-ndjson"}:
        events = parse_sse_json_events(body)
        items = image_items_from_payload(events)
        if items:
            payload = {"data": items}
    if not items:
        items = image_items_from_payload(payload)
    if items:
        canonical = {"data": items}
        return canonical, json_bytes(canonical), "application/json; charset=utf-8", len(items)
    return payload, body, str(getattr(response, "headers", {}).get("Content-Type", "application/json") or "application/json"), 0


def image_preview_urls_from_payload(payload: Any) -> list[str]:
    """Return only safe-sized remote image URLs for progressive canvas previews."""
    urls: list[str] = []
    seen: set[str] = set()
    for item in image_items_from_payload(payload):
        url = str(item.get("url") or "").strip()
        if not url or not url.startswith(("https://", "http://")) or url in seen:
            continue
        seen.add(url)
        urls.append(url[:4096])
        if len(urls) >= 16:
            break
    return urls


def consume_streamed_image_response(response: Any, on_preview: Callable[[list[str]], None] | None = None) -> bytes:
    """Read an image/SSE response incrementally and publish URL previews as they appear."""
    body_parts: list[bytes] = []
    content_type = str(getattr(response, "headers", {}).get("Content-Type", "") or "").split(";", 1)[0].strip().lower()
    stream_buffer = ""
    preview_urls: list[str] = []
    preview_seen: set[str] = set()

    def publish(payload: Any) -> None:
        if not on_preview:
            return
        urls = image_preview_urls_from_payload(payload)
        fresh = [url for url in urls if url not in preview_seen]
        if not fresh:
            return
        preview_seen.update(fresh)
        preview_urls.extend(fresh)
        on_preview(preview_urls[:16])

    iterator = getattr(response, "iter_content", None)
    if callable(iterator):
        try:
            chunks = iterator(chunk_size=64 * 1024)
            for chunk in chunks:
                if not chunk:
                    continue
                body_parts.append(chunk)
                if not on_preview or content_type.startswith("image/"):
                    continue
                stream_buffer += bytes(chunk).decode("utf-8", errors="replace")
                while "\n\n" in stream_buffer:
                    block, stream_buffer = stream_buffer.split("\n\n", 1)
                    events = parse_sse_json_events((block + "\n\n").encode("utf-8"))
                    for event in events:
                        publish(event)
        except TypeError:
            body_parts = [bytes(getattr(response, "content", b"") or b"")]
    else:
        body_parts = [bytes(getattr(response, "content", b"") or b"")]

    body = b"".join(body_parts)
    if on_preview and not content_type.startswith("image/"):
        if stream_buffer.strip():
            for event in parse_sse_json_events((stream_buffer + "\n\n").encode("utf-8")):
                publish(event)
        try:
            publish(json.loads(body.decode("utf-8-sig")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    response._content = body
    response._content_consumed = True
    return body


def ensure_private_path(path: Path, mode: int) -> None:
    try:
        path.chmod(mode)
    except OSError:
        pass


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_private_path(DATA_DIR, 0o700)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_private_path(DB_PATH.parent, 0o700)
    DB_PATH.touch(mode=0o600, exist_ok=True)
    ensure_private_path(DB_PATH, 0o600)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys=on")
    conn.execute("pragma journal_mode=wal")
    conn.execute("pragma synchronous=normal")
    conn.execute("pragma busy_timeout=30000")
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(f"{DB_PATH}{suffix}")
        if candidate.exists():
            ensure_private_path(candidate, 0o600)
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            create table if not exists studio_admins (
                username text primary key,
                password_hash text not null,
                salt text not null,
                enabled integer not null default 1,
                created_at integer not null
            );
            create table if not exists studio_provider_configs (
                id integer primary key autoincrement,
                name text not null,
                base_url text not null,
                api_key text not null,
                api_format text not null default 'openai',
                protocol_template text not null default 'openai',
                is_async integer not null default 0,
                create_path text not null default '',
                poll_path_template text not null default '',
                content_path_template text not null default '',
                task_id_field text not null default 'id',
                status_field text not null default 'status',
                result_url_field text not null default 'url',
                completed_statuses text not null default '',
                failed_statuses text not null default '',
                download_result integer not null default 1,
                auth_mode text not null default 'bearer',
                auth_header_name text not null default 'Authorization',
                auth_query_name text not null default 'key',
                extra_headers text not null default '{}',
                enabled integer not null default 1,
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_model_catalog (
                id integer primary key autoincrement,
                provider_id integer not null references studio_provider_configs(id) on delete cascade,
                model text not null,
                display_name text not null,
                capability text not null check(capability in ('text','image','video','audio')),
                credit_cost real not null default 0,
                pricing_rules text not null default '{}',
                enabled integer not null default 1,
                created_at integer not null,
                updated_at integer not null,
                unique(provider_id, model, capability)
            );
            create table if not exists studio_sessions (
                token text primary key,
                source text not null,
                user_id text not null,
                username text not null,
                email text,
                role text not null default 'user',
                upstream_token text,
                upstream_payload text,
                balance real not null default 0,
                points real not null default 0,
                expires_at integer not null,
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_pending_mtline_2fa (
                token text primary key,
                username text not null,
                cookies text not null,
                payload text not null,
                expires_at integer not null
            );
            create table if not exists studio_usage_ledger (
                id integer primary key autoincrement,
                external_key text not null unique,
                session_token text not null,
                source text not null,
                user_id text not null,
                model text not null,
                provider_id integer not null default 0,
                provider_name text not null default '',
                capability text not null,
                credits real not null,
                balance_delta real not null,
                unit_price real not null default 0,
                unit_count integer not null default 1,
                success_count integer not null default 0,
                failed_count integer not null default 0,
                elapsed_ms integer not null default 0,
                username text not null default '',
                email text not null default '',
                status text not null,
                request_path text not null,
                error text,
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_video_tasks (
                task_id text primary key,
                session_token text not null,
                model text not null,
                capability text not null default 'video',
                create_path text not null,
                provider_id integer not null,
                usage_key text,
                result_file text not null default '',
                result_r2_key text not null default '',
                result_content_type text not null default '',
                result_delivered_at integer not null default 0,
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_audit_log (
                id integer primary key autoincrement,
                actor text not null,
                action text not null,
                payload text,
                created_at integer not null
            );
            create table if not exists studio_refund_ledger (
                refund_key text primary key,
                external_key text not null,
                credits real not null,
                balance_delta real not null,
                status text not null,
                reason text not null default '',
                error text not null default '',
                created_at integer not null,
                updated_at integer not null
            );
            create index if not exists idx_studio_refund_external_key on studio_refund_ledger(external_key,status);
            create table if not exists studio_workflow_access (
                workflow_key text primary key,
                enabled integer not null default 1,
                access_mode text not null default 'all' check(access_mode in ('all','selected')),
                allowed_users text not null default '[]',
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_runtime_settings (
                key text primary key,
                value text not null,
                updated_by text not null default '',
                created_at integer not null,
                updated_at integer not null
            );
            create table if not exists studio_storage_objects (
                id text primary key,
                source text not null,
                user_id text not null,
                provider_json text not null,
                object_key text not null,
                mime_type text not null default 'application/octet-stream',
                bytes integer not null default 0,
                created_at integer not null,
                updated_at integer not null
            );
            create index if not exists idx_studio_storage_objects_owner on studio_storage_objects(source,user_id,created_at);
            create table if not exists studio_user_generation_limits (
                source text not null,
                user_id text not null,
                concurrency_limit integer not null check(concurrency_limit >= 1),
                updated_by text not null default '',
                created_at integer not null,
                updated_at integer not null,
                primary key(source, user_id)
            );
            create table if not exists studio_generation_jobs (
                job_id text primary key,
                session_token text not null,
                source text not null,
                user_id text not null,
                username text not null default '',
                idempotency_key text not null,
                provider_id integer not null,
                model text not null,
                capability text not null,
                method text not null,
                request_path text not null,
                request_kind text not null,
                request_file text not null,
                result_file text not null default '',
                result_r2_key text not null default '',
                result_content_type text not null default '',
                status text not null,
                usage_key text not null,
                unit_price real not null default 0,
                unit_count integer not null default 1,
                credits real not null default 0,
                success_count integer not null default 0,
                failed_count integer not null default 0,
                attempts integer not null default 0,
                error text not null default '',
                transport text not null default '',
                dispatched_at integer not null default 0,
                started_at integer not null default 0,
                completed_at integer not null default 0,
                result_delivered_at integer not null default 0,
                created_at integer not null,
                updated_at integer not null,
                preview_urls text not null default '[]',
                unique(session_token, idempotency_key)
            );
            create table if not exists studio_generation_events (
                id integer primary key autoincrement,
                job_id text not null references studio_generation_jobs(job_id) on delete cascade,
                event text not null,
                detail text not null default '',
                created_at integer not null
            );
            create index if not exists idx_studio_generation_jobs_status on studio_generation_jobs(status, created_at);
            create index if not exists idx_studio_generation_jobs_user on studio_generation_jobs(source, user_id, status);
            create index if not exists idx_studio_generation_jobs_provider on studio_generation_jobs(provider_id, status);
            """
        )
        ensure_provider_config_columns(conn)
        ensure_model_catalog_columns(conn)
        ensure_usage_ledger_columns(conn)
        ensure_video_task_columns(conn)
        ensure_generation_job_columns(conn)
        ts = now()
        for workflow_key in WORKFLOW_DEFINITIONS:
            conn.execute(
                "insert or ignore into studio_workflow_access(workflow_key,enabled,access_mode,allowed_users,created_at,updated_at) values(?,1,'all','[]',?,?)",
                (workflow_key, ts, ts),
            )
    seed_admin()


def validate_generation_concurrency(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise StudioError(400, "concurrency limit must be an integer") from exc
    if parsed < 1:
        raise StudioError(400, "concurrency limit must be a positive integer")
    return parsed


def generation_concurrency_snapshot() -> tuple[int, dict[tuple[str, str], int]]:
    default_limit = USER_GENERATION_CONCURRENCY
    overrides: dict[tuple[str, str], int] = {}
    with db() as conn:
        row = conn.execute(
            "select value from studio_runtime_settings where key='default_user_generation_concurrency'"
        ).fetchone()
        if row:
            try:
                default_limit = validate_generation_concurrency(row["value"])
            except StudioError:
                default_limit = USER_GENERATION_CONCURRENCY
        rows = conn.execute(
            "select source,user_id,concurrency_limit from studio_user_generation_limits"
        ).fetchall()
    for row in rows:
        try:
            overrides[(str(row["source"]), str(row["user_id"]))] = validate_generation_concurrency(row["concurrency_limit"])
        except StudioError:
            continue
    return default_limit, overrides


def global_generation_concurrency() -> int:
    limit = GLOBAL_GENERATION_CONCURRENCY
    with db() as conn:
        row = conn.execute(
            "select value from studio_runtime_settings where key='global_generation_concurrency'"
        ).fetchone()
    if row:
        try:
            limit = validate_generation_concurrency(row["value"])
        except StudioError:
            limit = GLOBAL_GENERATION_CONCURRENCY
    return limit


def set_global_generation_concurrency(actor: str, value: Any) -> int:
    limit = validate_generation_concurrency(value)
    ts = now()
    with db() as conn:
        conn.execute(
            """
            insert into studio_runtime_settings(key,value,updated_by,created_at,updated_at)
            values('global_generation_concurrency',?,?,?,?)
            on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at
            """,
            (str(limit), actor, ts, ts),
        )
    _JOB_WAKE_EVENT.set()
    return limit


def set_default_generation_concurrency(actor: str, value: Any) -> int:
    limit = validate_generation_concurrency(value)
    ts = now()
    with db() as conn:
        conn.execute(
            """
            insert into studio_runtime_settings(key,value,updated_by,created_at,updated_at)
            values('default_user_generation_concurrency',?,?,?,?)
            on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at
            """,
            (str(limit), actor, ts, ts),
        )
    _JOB_WAKE_EVENT.set()
    return limit


def set_user_generation_concurrency(actor: str, source: str, user_id: str, value: Any) -> int:
    source = source.strip().lower()
    user_id = user_id.strip()
    if not source or not user_id:
        raise StudioError(400, "source and user id are required")
    limit = validate_generation_concurrency(value)
    ts = now()
    with db() as conn:
        conn.execute(
            """
            insert into studio_user_generation_limits(source,user_id,concurrency_limit,updated_by,created_at,updated_at)
            values(?,?,?,?,?,?)
            on conflict(source,user_id) do update set concurrency_limit=excluded.concurrency_limit,
                updated_by=excluded.updated_by,updated_at=excluded.updated_at
            """,
            (source, user_id, limit, actor, ts, ts),
        )
    _JOB_WAKE_EVENT.set()
    return limit


def reset_user_generation_concurrency(source: str, user_id: str) -> bool:
    with db() as conn:
        deleted = conn.execute(
            "delete from studio_user_generation_limits where source=? and user_id=?",
            (source.strip().lower(), user_id.strip()),
        )
    _JOB_WAKE_EVENT.set()
    return bool(deleted.rowcount)


def ensure_provider_config_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("pragma table_info(studio_provider_configs)")}
    required_columns = {
        "protocol_template": "text not null default 'openai'",
        "is_async": "integer not null default 0",
        "create_path": "text not null default ''",
        "poll_path_template": "text not null default ''",
        "content_path_template": "text not null default ''",
        "task_id_field": "text not null default 'id'",
        "status_field": "text not null default 'status'",
        "result_url_field": "text not null default 'url'",
        "completed_statuses": "text not null default ''",
        "failed_statuses": "text not null default ''",
        "download_result": "integer not null default 1",
        "auth_mode": "text not null default 'bearer'",
        "auth_header_name": "text not null default 'Authorization'",
        "auth_query_name": "text not null default 'key'",
        "extra_headers": "text not null default '{}'",
    }
    for name, ddl in required_columns.items():
        if name not in columns:
            conn.execute(f"alter table studio_provider_configs add column {name} {ddl}")


def ensure_model_catalog_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("pragma table_info(studio_model_catalog)")}
    required_columns = {
        "pricing_rules": "text not null default '{}'",
        "failover_enabled": "integer not null default 0",
        "failover_route_model_ids": "text not null default '[]'",
    }
    for name, ddl in required_columns.items():
        if name not in columns:
            conn.execute(f"alter table studio_model_catalog add column {name} {ddl}")


def ensure_usage_ledger_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("pragma table_info(studio_usage_ledger)")}
    required_columns = {
        "unit_price": "real not null default 0",
        "provider_id": "integer not null default 0",
        "provider_name": "text not null default ''",
        "unit_count": "integer not null default 1",
        "success_count": "integer not null default 0",
        "failed_count": "integer not null default 0",
        "elapsed_ms": "integer not null default 0",
        "username": "text not null default ''",
        "email": "text not null default ''",
        "report_status": "text not null default ''",
        "report_note": "text not null default ''",
        "reported_at": "integer not null default 0",
        "admin_refund_status": "text not null default ''",
        "admin_refund_credits": "real not null default 0",
        "admin_refunded_at": "integer not null default 0",
    }
    for name, ddl in required_columns.items():
        if name not in columns:
            conn.execute(f"alter table studio_usage_ledger add column {name} {ddl}")


def ensure_video_task_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("pragma table_info(studio_video_tasks)")}
    required_columns = {
        "result_file": "text not null default ''",
        "result_r2_key": "text not null default ''",
        "result_content_type": "text not null default ''",
        "result_delivered_at": "integer not null default 0",
    }
    for name, ddl in required_columns.items():
        if name not in columns:
            conn.execute(f"alter table studio_video_tasks add column {name} {ddl}")


def ensure_generation_job_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("pragma table_info(studio_generation_jobs)")}
    if "preview_urls" not in columns:
        conn.execute("alter table studio_generation_jobs add column preview_urls text not null default '[]'")


def async_shared_secret() -> str:
    if ASYNC_SHARED_SECRET:
        return ASYNC_SHARED_SECRET
    if not ASYNC_SHARED_SECRET_FILE:
        return ""
    try:
        return Path(ASYNC_SHARED_SECRET_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def async_accepting_jobs() -> bool:
    return ASYNC_GENERATION_ENABLED and ASYNC_GENERATION_PERCENT > 0 and not ASYNC_KILL_SWITCH_FILE.exists()


def async_signature(method: str, path: str, timestamp: str, body: bytes) -> str:
    secret = async_shared_secret()
    if not secret:
        raise StudioError(503, "Studio async signing secret is not configured")
    digest = hashlib.sha256(body).hexdigest()
    message = f"{timestamp}\n{method.upper()}\n{path}\n{digest}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def async_stream_signature(method: str, path: str, timestamp: str) -> str:
    secret = async_shared_secret()
    if not secret:
        raise StudioError(503, "Studio async signing secret is not configured")
    message = f"{timestamp}\n{method.upper()}\n{path}\nstream".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def async_signed_headers(method: str, path: str, body: bytes, content_type: str = "application/json") -> dict[str, str]:
    timestamp = str(now())
    return {
        "Content-Type": content_type,
        "X-Studio-Timestamp": timestamp,
        "X-Studio-Signature": async_signature(method, path, timestamp, body),
    }


def async_worker_stream_upload(path: str, file_path: Path, content_type: str, timeout: int = 60) -> requests.Response:
    if not ASYNC_WORKER_URL:
        raise StudioError(503, "Studio async Worker URL is not configured")
    timestamp = str(now())
    headers = {
        "Content-Type": content_type,
        "X-Studio-Timestamp": timestamp,
        "X-Studio-Signature": async_stream_signature("PUT", path, timestamp),
        "X-Studio-Stream": "1",
        "Content-Length": str(file_path.stat().st_size),
    }
    with file_path.open("rb") as stream:
        return requests.request("PUT", f"{ASYNC_WORKER_URL}{path}", data=stream, headers=headers, timeout=timeout)


def async_asset_download_url_for_key(r2_key: str, expires_in: int = 600) -> str:
    if not ASYNC_WORKER_URL or not async_shared_secret():
        return ""
    key = str(r2_key or "").strip()
    if not re.fullmatch(r"results/(?:job|video)_[a-f0-9]{32}\.bin", key):
        raise StudioError(400, "Invalid generation result cache key")
    path = f"/assets/{key}"
    expires = now() + max(60, min(900, int(expires_in)))
    message = f"{expires}\nGET\n{path}".encode("utf-8")
    token = hmac.new(async_shared_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()
    asset_base = ASYNC_PUBLIC_ASSET_BASE or f"{ASYNC_WORKER_URL}/assets"
    return f"{asset_base}/{key}?expires={expires}&token={token}"


def async_asset_download_url(job_id: str, r2_key: Any, expires_in: int = 600) -> str:
    return async_asset_download_url_for_key(generation_result_r2_key(job_id, r2_key), expires_in)


def verify_async_request(headers: Any, method: str, path: str, body: bytes) -> None:
    timestamp = str(headers.get("X-Studio-Timestamp") or "").strip()
    signature = str(headers.get("X-Studio-Signature") or "").strip().lower()
    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise StudioError(401, "Invalid async request timestamp") from exc
    if abs(now() - timestamp_value) > 300:
        raise StudioError(401, "Expired async request")
    expected = async_signature(method, path, timestamp, body)
    if not signature or not hmac.compare_digest(signature, expected):
        raise StudioError(401, "Invalid async request signature")


def async_worker_request(method: str, path: str, body: bytes = b"", content_type: str = "application/json", timeout: int = 20) -> requests.Response:
    if not ASYNC_WORKER_URL:
        raise StudioError(503, "Studio async Worker URL is not configured")
    return requests.request(
        method,
        f"{ASYNC_WORKER_URL}{path}",
        data=body,
        headers=async_signed_headers(method, path, body, content_type),
        timeout=timeout,
    )


def record_generation_event(job_id: str, event: str, detail: str = "") -> None:
    with db() as conn:
        conn.execute(
            "insert into studio_generation_events(job_id,event,detail,created_at) values(?,?,?,?)",
            (job_id, event, detail[:1000], now()),
        )


def generation_jobs_root() -> Path:
    ASYNC_JOB_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_private_path(ASYNC_JOB_DIR, 0o700)
    return ASYNC_JOB_DIR.resolve()


def generation_job_dir(job_id: str, create: bool = True) -> Path:
    if not re.fullmatch(r"job_[a-f0-9]{32}", job_id):
        raise StudioError(400, "Invalid generation job id")
    root = generation_jobs_root()
    path = (root / job_id).resolve()
    if path.parent != root:
        raise StudioError(400, "Invalid generation job path")
    if create:
        path.mkdir(parents=False, exist_ok=True, mode=0o700)
        ensure_private_path(path, 0o700)
    return path


def generation_job_stored_path(job_id: str, stored_path: Any) -> Path:
    job_dir = generation_job_dir(job_id, create=False)
    candidate = Path(str(stored_path or ""))
    if not candidate.is_absolute():
        candidate = job_dir / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(job_dir)
    except ValueError as exc:
        raise StudioError(400, "Invalid generation job file path") from exc
    return resolved


def generation_result_r2_key(job_id: str, stored_key: Any = "") -> str:
    expected = f"results/{job_id}.bin"
    value = str(stored_key or expected).strip()
    if value != expected:
        raise StudioError(400, "Invalid generation result cache key")
    return expected


def video_result_r2_key(task_id: str, stored_key: Any = "") -> str:
    # Task IDs may contain provider-specific characters, so cache under a fixed
    # digest rather than allowing provider input to become an object path.
    if not task_id:
        raise StudioError(400, "Invalid video task id")
    expected = f"results/video_{hashlib.md5(task_id.encode('utf-8')).hexdigest()}.bin"
    value = str(stored_key or expected).strip()
    if value != expected:
        raise StudioError(400, "Invalid video result cache key")
    return expected


def save_generation_request(job_id: str, request_kind: str, payload: dict[str, Any], files: list[tuple[str, tuple[str, bytes, str]]] | None = None) -> str:
    job_dir = generation_job_dir(job_id)
    file_items: list[dict[str, Any]] = []
    for index, (field_name, (filename, content, content_type)) in enumerate(files or []):
        target = job_dir / f"input-{index:03d}.bin"
        target.write_bytes(content)
        ensure_private_path(target, 0o600)
        file_items.append(
            {
                "field": field_name,
                "filename": filename,
                "contentType": content_type,
                "path": str(target),
            }
        )
    request_file = job_dir / "request.json"
    request_file.write_text(
        json.dumps({"kind": request_kind, "payload": payload, "files": file_items}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    ensure_private_path(request_file, 0o600)
    return str(request_file)


def load_generation_request(job: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, tuple[str, bytes, str]]]]:
    payload = json.loads(generation_job_stored_path(job["job_id"], job["request_file"]).read_text(encoding="utf-8"))
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    for item in payload.get("files") or []:
        files.append(
            (
                str(item.get("field") or "image"),
                (
                    str(item.get("filename") or "image.bin"),
                    generation_job_stored_path(job["job_id"], item["path"]).read_bytes(),
                    str(item.get("contentType") or "application/octet-stream"),
                ),
            )
        )
    return safe_json_object(payload.get("payload") or {}), files


def generation_job_queue_ahead(row: dict[str, Any]) -> int:
    """Return the number of earlier queued jobs for the same Studio user."""
    if row.get("status") != "queued":
        return 0
    with db() as conn:
        result = conn.execute(
            """
            select count(*) total
            from studio_generation_jobs
            where source=? and user_id=? and status='queued'
              and (
                    created_at < ?
                    or (
                        created_at = ?
                        and rowid < (select rowid from studio_generation_jobs where job_id=?)
                    )
              )
            """,
            (row["source"], row["user_id"], row["created_at"], row["created_at"], row["job_id"]),
        ).fetchone()
    return int(result["total"] or 0) if result else 0


def public_generation_job(row: dict[str, Any]) -> dict[str, Any]:
    queue_ahead = generation_job_queue_ahead(row)
    result_url = ""
    try:
        preview_urls = json.loads(str(row.get("preview_urls") or "[]"))
    except (TypeError, json.JSONDecodeError):
        preview_urls = []
    if not isinstance(preview_urls, list):
        preview_urls = []
    preview_urls = [url[:4096] for url in preview_urls if isinstance(url, str) and url.startswith(("https://", "http://"))][:16]
    if row.get("status") == "succeeded" and (row.get("result_file") or row.get("result_r2_key")):
        # Keep result delivery same-origin. The browser must not be redirected to
        # the signed Worker URL, which can fail CORS or be blocked by a gateway.
        result_url = f"/studio-api/jobs/{urllib.parse.quote(str(row['job_id']), safe='')}/result"
    return {
        "jobId": row["job_id"],
        "status": row["status"],
        "model": row["model"],
        "capability": row["capability"],
        "unitCount": int(row.get("unit_count") or 1),
        "successCount": int(row.get("success_count") or 0),
        "failedCount": int(row.get("failed_count") or 0),
        "credits": float(row.get("credits") or 0),
        "error": str(row.get("error") or ""),
        "createdAt": int(row.get("created_at") or 0),
        "startedAt": int(row.get("started_at") or 0),
        "completedAt": int(row.get("completed_at") or 0),
        "resultReady": row.get("status") == "succeeded" and bool(row.get("result_file") or row.get("result_r2_key")),
        "resultUrl": result_url,
        "previewUrls": preview_urls,
        "queueAhead": queue_ahead if row.get("status") == "queued" else None,
        "queuePosition": queue_ahead + 1 if row.get("status") == "queued" else None,
    }


def generation_job_for_session(job_id: str, session: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "select * from studio_generation_jobs where job_id=? and source=? and user_id=?",
            (job_id, session["source"], session["user_id"]),
        ).fetchone()
    job = row_dict(row)
    if not job:
        raise StudioError(404, "Generation job was not found")
    return job


def create_generation_job(
    session: dict[str, Any],
    method: str,
    request_path: str,
    request_kind: str,
    payload: dict[str, Any],
    files: list[tuple[str, tuple[str, bytes, str]]] | None,
    idempotency_key: str,
) -> dict[str, Any]:
    model = str(payload.get("model") or "").strip()
    if not model:
        raise StudioError(400, "model is required")
    capability = infer_capability(request_path, payload)
    if capability != "image":
        raise StudioError(400, "The first Studio async rollout supports image jobs only")
    if not async_accepting_jobs():
        raise StudioError(409, "Studio async generation is disabled")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,160}", idempotency_key):
        idempotency_key = "request_" + secrets.token_hex(16)
    with db() as conn:
        existing = conn.execute(
            "select * from studio_generation_jobs where session_token=? and idempotency_key=?",
            (session["token"], idempotency_key),
        ).fetchone()
    if existing:
        return dict(existing)

    config = model_config(model, capability)
    count = charge_count(capability, payload)
    unit_price = resolve_unit_price(config, capability, payload)
    credits = unit_price * count
    job_id = "job_" + secrets.token_hex(16)
    usage_key = ""
    request_file = ""
    try:
        usage_key, _ = create_usage(session, model, capability, unit_price, count, request_path, config)
        request_file = save_generation_request(job_id, request_kind, payload, files)
        ts = now()
        with db() as conn:
            conn.execute(
                """
                insert into studio_generation_jobs(
                    job_id,session_token,source,user_id,username,idempotency_key,provider_id,model,capability,
                    method,request_path,request_kind,request_file,status,usage_key,unit_price,unit_count,credits,
                    transport,created_at,updated_at
                ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,?)
                """,
                (
                    job_id,
                    session["token"],
                    session["source"],
                    session["user_id"],
                    session.get("username") or "",
                    idempotency_key,
                    int(config["provider_id"]),
                    model,
                    capability,
                    method.upper(),
                    request_path,
                    request_kind,
                    request_file,
                    usage_key,
                    unit_price,
                    count,
                    credits,
                    "pending_worker",
                    ts,
                    ts,
                ),
            )
        record_generation_event(job_id, "queued")
    except Exception as exc:
        if usage_key:
            try:
                refund_usage_delta(session, usage_key, credits, f"async job creation failed: {exc}", "job-creation")
                mark_usage(usage_key, "refunded", str(exc), success_count=0, failed_count=count, credits=0, balance_delta=0)
            except Exception:
                pass
        if request_file:
            cleanup_generation_job_files(job_id)
        raise

    body = json_bytes({"jobId": job_id})
    try:
        response = async_worker_request("POST", "/enqueue", body)
        if response.status_code >= 400:
            raise StudioError(response.status_code, response.text[:500] or response.reason)
        with db() as conn:
            conn.execute(
                "update studio_generation_jobs set transport='cloudflare_queue',dispatched_at=?,updated_at=? where job_id=?",
                (now(), now(), job_id),
            )
        record_generation_event(job_id, "cloudflare_enqueued")
    except Exception as exc:
        with db() as conn:
            conn.execute(
                "update studio_generation_jobs set transport='local_fallback',dispatched_at=?,updated_at=? where job_id=?",
                (now(), now(), job_id),
            )
        record_generation_event(job_id, "queue_fallback", str(exc))
    _JOB_WAKE_EVENT.set()
    with db() as conn:
        row = conn.execute("select * from studio_generation_jobs where job_id=?", (job_id,)).fetchone()
    return dict(row)


def cleanup_generation_job_files(job_id: str) -> None:
    try:
        path = generation_job_dir(job_id, create=False)
        if not path.exists():
            return
        for item in path.iterdir():
            if item.is_file():
                item.unlink(missing_ok=True)
        path.rmdir()
    except (OSError, StudioError):
        pass


def session_from_generation_job(job: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select * from studio_sessions where token=?", (job["session_token"],)).fetchone()
    session = row_dict(row)
    if session:
        return session
    return {
        "token": job["session_token"],
        "source": job["source"],
        "user_id": job["user_id"],
        "username": job.get("username") or "",
        "role": "user",
        "balance": 0,
        "points": 0,
    }


def store_generation_result(job: dict[str, Any], body: bytes, content_type: str) -> tuple[str, str, str]:
    job_dir = generation_job_dir(job["job_id"])
    result_file = job_dir / "result.bin"
    result_file.write_bytes(body)
    ensure_private_path(result_file, 0o600)
    r2_key = generation_result_r2_key(job["job_id"])
    transport = str(job.get("transport") or "")
    try:
        response = async_worker_stream_upload(f"/assets/{r2_key}", result_file, content_type, timeout=60)
        if response.status_code >= 400:
            raise StudioError(response.status_code, response.text[:500] or response.reason)
        transport = "cloudflare_queue+r2"
    except Exception as exc:
        r2_key = ""
        transport = f"{transport or 'local'}+local_result"
        record_generation_event(job["job_id"], "r2_fallback", str(exc))
    return str(result_file), r2_key, transport


def execute_generation_job(job_id: str) -> None:
    with db() as conn:
        row = conn.execute("select * from studio_generation_jobs where job_id=?", (job_id,)).fetchone()
        if not row or row["status"] not in {"queued", "running"}:
            return
        if row["status"] == "queued":
            reserved = conn.execute(
                "update studio_generation_jobs set status='running',started_at=?,attempts=attempts+1,updated_at=? where job_id=? and status='queued'",
                (now(), now(), job_id),
            )
            if not reserved.rowcount:
                return
            row = conn.execute("select * from studio_generation_jobs where job_id=?", (job_id,)).fetchone()
    job = dict(row)
    session = session_from_generation_job(job)
    started_at = time.monotonic()
    refunded_credits = 0.0
    record_generation_event(job_id, "running")
    try:
        payload, files = load_generation_request(job)

        def publish_preview_urls(urls: list[str]) -> None:
            if not urls:
                return
            serialized = json.dumps(urls[:16], ensure_ascii=False)
            with db() as conn:
                conn.execute(
                    "update studio_generation_jobs set preview_urls=?,updated_at=? where job_id=?",
                    (serialized, now(), job_id),
                )
            record_generation_event(job_id, "preview_available", f"count={len(urls[:16])}")

        upstream, selected_config = upstream_request_with_failover(
            job["model"],
            job["capability"],
            job["method"],
            job["request_path"],
            payload,
            files if job["request_kind"] == "multipart" else None,
            ASYNC_JOB_TIMEOUT,
            require_image_result=job["capability"] == "image",
            preview_callback=publish_preview_urls if job["capability"] == "image" else None,
        )
        selected_provider_id = int(selected_config["provider_id"])
        update_usage_provider(job["usage_key"], selected_config)
        if selected_provider_id != int(job["provider_id"]):
            record_generation_event(job_id, "provider_failover", f"from={job['provider_id']},to={selected_provider_id}")
            with db() as conn:
                conn.execute(
                    "update studio_generation_jobs set provider_id=?,updated_at=? where job_id=?",
                    (selected_provider_id, now(), job_id),
                )
        success_count = int(job["unit_count"] or 1)
        failed_count = 0
        result_body = upstream.content
        result_content_type = upstream.headers.get("Content-Type", "application/json")
        if job["capability"] == "image":
            normalized_payload, result_body, result_content_type, success_count = normalized_image_response(upstream)
            if success_count <= 0:
                raise StudioError(502, "Image provider returned no usable images")
            publish_preview_urls(image_preview_urls_from_payload(normalized_payload))
            failed_count = max(0, int(job["unit_count"] or 1) - success_count)
        actual_credits = float(job["unit_price"] or 0) * success_count
        actual_delta = balance_delta_for_credits(actual_credits, job["source"])
        if failed_count:
            partial_refund = float(job["unit_price"] or 0) * failed_count
            refund_usage_delta(session, job["usage_key"], partial_refund, "partial image failure", "partial-image")
            refunded_credits += partial_refund
        result_file, r2_key, transport = store_generation_result(job, result_body, result_content_type)
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        mark_usage(
            job["usage_key"],
            "success",
            success_count=success_count,
            failed_count=failed_count,
            elapsed_ms=elapsed_ms,
            credits=actual_credits,
            balance_delta=actual_delta,
        )
        with db() as conn:
            conn.execute(
                """
                update studio_generation_jobs
                set status='succeeded',success_count=?,failed_count=?,credits=?,result_file=?,result_r2_key=?,
                    result_content_type=?,transport=?,completed_at=?,updated_at=?,error=''
                where job_id=?
                """,
                (success_count, failed_count, actual_credits, result_file, r2_key, result_content_type, transport, now(), now(), job_id),
            )
        record_generation_event(job_id, "succeeded", f"success={success_count},failed={failed_count},elapsed_ms={elapsed_ms}")
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        try:
            refund_usage_delta(session, job["usage_key"], max(0.0, float(job["credits"] or 0) - refunded_credits), str(exc), "terminal-failure")
            mark_usage(
                job["usage_key"],
                "refunded",
                str(exc),
                success_count=0,
                failed_count=int(job["unit_count"] or 1),
                elapsed_ms=elapsed_ms,
                credits=0,
                balance_delta=0,
            )
            status = "failed"
        except Exception as refund_exc:
            mark_usage(job["usage_key"], "refund_failed", f"{exc}; refund: {refund_exc}", elapsed_ms=elapsed_ms)
            status = "refund_failed"
        with db() as conn:
            conn.execute(
                "update studio_generation_jobs set status=?,failed_count=unit_count,credits=0,error=?,completed_at=?,updated_at=? where job_id=?",
                (status, str(exc)[:1000], now(), now(), job_id),
            )
        record_generation_event(job_id, status, str(exc))
    finally:
        _JOB_WAKE_EVENT.set()


def dispatch_queued_generation_jobs() -> int:
    with _JOB_FUTURES_LOCK:
        finished = [job_id for job_id, future in _JOB_FUTURES.items() if future.done()]
        for job_id in finished:
            _JOB_FUTURES.pop(job_id, None)
    with db() as conn:
        running_rows = conn.execute(
            "select source,user_id,count(*) total from studio_generation_jobs where status='running' group by source,user_id"
        ).fetchall()
        queued_rows = conn.execute(
            "select * from studio_generation_jobs where status='queued' order by created_at asc, rowid asc limit 200"
        ).fetchall()
    user_running = {(str(row["source"]), str(row["user_id"])): int(row["total"]) for row in running_rows}
    total_running = sum(user_running.values())
    global_limit = global_generation_concurrency()
    default_limit, user_limits = generation_concurrency_snapshot()
    dispatched = 0
    for row in queued_rows:
        if total_running >= global_limit:
            break
        job = dict(row)
        user_key = (str(job["source"]), str(job["user_id"]))
        effective_limit = user_limits.get(user_key, default_limit)
        if user_running.get(user_key, 0) >= effective_limit:
            continue
        with _JOB_FUTURES_LOCK:
            if job["job_id"] in _JOB_FUTURES:
                continue
            with db() as conn:
                reserved = conn.execute(
                    "update studio_generation_jobs set status='running',started_at=?,attempts=attempts+1,updated_at=? where job_id=? and status='queued'",
                    (now(), now(), job["job_id"]),
                )
            if not reserved.rowcount:
                continue
            try:
                future = _JOB_EXECUTOR.submit(execute_generation_job, job["job_id"])
            except Exception:
                with db() as conn:
                    conn.execute(
                        "update studio_generation_jobs set status='queued',started_at=0,attempts=max(0,attempts-1),updated_at=? where job_id=? and status='running'",
                        (now(), job["job_id"]),
                    )
                raise
            _JOB_FUTURES[job["job_id"]] = future
        user_running[user_key] = user_running.get(user_key, 0) + 1
        total_running += 1
        dispatched += 1
    return dispatched


def schedule_generation_jobs() -> None:
    while not _JOB_STOP_EVENT.is_set():
        dispatch_queued_generation_jobs()
        _JOB_WAKE_EVENT.wait(1.0)
        _JOB_WAKE_EVENT.clear()


def cleanup_expired_generation_jobs() -> None:
    ts = now()
    with db() as conn:
        rows = conn.execute(
            """
            select job_id,result_r2_key,result_delivered_at,completed_at
            from studio_generation_jobs
            where status in ('succeeded','failed','refund_failed','cancelled') and completed_at>0
              and (result_file<>'' or result_r2_key<>'')
              and ((result_delivered_at>0 and result_delivered_at<?) or (result_delivered_at=0 and completed_at<?))
            limit 20
            """,
            (ts - ASYNC_DELIVERED_TTL, ts - ASYNC_RESULT_TTL),
        ).fetchall()
    for row in rows:
        job_id = str(row["job_id"])
        r2_key = str(row["result_r2_key"] or "")
        if r2_key:
            try:
                r2_key = generation_result_r2_key(job_id, r2_key)
                response = async_worker_request("DELETE", f"/assets/{r2_key}", timeout=20)
                if response.status_code not in {200, 204, 404}:
                    raise StudioError(response.status_code, response.text[:500] or response.reason)
            except Exception as exc:
                record_generation_event(job_id, "r2_cleanup_failed", str(exc)[:500])
                continue
        cleanup_generation_job_files(job_id)
        with db() as conn:
            conn.execute("update studio_generation_jobs set result_file='',result_r2_key='',updated_at=? where job_id=?", (now(), job_id))
        record_generation_event(job_id, "result_cache_expired", "R2 and server transit cache removed")

    with db() as conn:
        video_rows = conn.execute(
            """
            select task_id,result_r2_key,result_file,result_delivered_at,updated_at
            from studio_video_tasks
            where result_file<>'' or result_r2_key<>''
              and ((result_delivered_at>0 and result_delivered_at<?) or (result_delivered_at=0 and updated_at<?))
            limit 20
            """,
            (ts - ASYNC_DELIVERED_TTL, ts - ASYNC_RESULT_TTL),
        ).fetchall()
    for row in video_rows:
        task_id = str(row["task_id"])
        r2_key = str(row["result_r2_key"] or "")
        if r2_key:
            try:
                r2_key = video_result_r2_key(task_id, r2_key)
                response = async_worker_request("DELETE", f"/assets/{r2_key}", timeout=20)
                if response.status_code not in {200, 204, 404}:
                    raise StudioError(response.status_code, response.text[:500] or response.reason)
            except Exception:
                continue
        try:
            video_result_local_path(task_id).unlink(missing_ok=True)
        except OSError:
            continue
        with db() as conn:
            conn.execute(
                "update studio_video_tasks set result_file='',result_r2_key='',result_content_type='',updated_at=? where task_id=?",
                (now(), task_id),
            )


def schedule_generation_cleanup() -> None:
    while not _JOB_STOP_EVENT.is_set():
        cleanup_expired_generation_jobs()
        _CLEANUP_WAKE_EVENT.wait(float(ASYNC_CLEANUP_INTERVAL))
        _CLEANUP_WAKE_EVENT.clear()


def start_generation_scheduler() -> None:
    with db() as conn:
        interrupted = conn.execute("select * from studio_generation_jobs where status='running'").fetchall()
    for row in interrupted:
        job = dict(row)
        session = session_from_generation_job(job)
        error = "Studio backend restarted while the upstream request was running"
        try:
            refund_usage_delta(session, job["usage_key"], float(job["credits"] or 0), error, "restart-recovery")
            mark_usage(job["usage_key"], "refunded", error, success_count=0, failed_count=int(job["unit_count"] or 1), credits=0, balance_delta=0)
            status = "failed"
        except Exception as exc:
            mark_usage(job["usage_key"], "refund_failed", f"{error}; refund: {exc}")
            status = "refund_failed"
        with db() as conn:
            conn.execute(
                "update studio_generation_jobs set status=?,error=?,credits=0,completed_at=?,updated_at=? where job_id=?",
                (status, error, now(), now(), job["job_id"]),
            )
    thread = threading.Thread(target=schedule_generation_jobs, name="studio-job-scheduler", daemon=True)
    thread.start()
    cleanup_thread = threading.Thread(target=schedule_generation_cleanup, name="studio-result-cleaner", daemon=True)
    cleanup_thread.start()


def cancel_generation_job(job: dict[str, Any]) -> str:
    if job["status"] == "running":
        return "in_progress"
    if job["status"] != "queued":
        return str(job["status"])
    with db() as conn:
        reserved = conn.execute(
            "update studio_generation_jobs set status='cancelling',updated_at=? where job_id=? and status='queued'",
            (now(), job["job_id"]),
        )
    if not reserved.rowcount:
        with db() as conn:
            current = conn.execute("select status from studio_generation_jobs where job_id=?", (job["job_id"],)).fetchone()
        return str(current["status"] if current else "not_found")
    session = session_from_generation_job(job)
    try:
        refund_usage_delta(session, job["usage_key"], float(job["credits"] or 0), "generation cancelled while queued", "queued-cancel")
        mark_usage(
            job["usage_key"],
            "refunded",
            "generation cancelled while queued",
            success_count=0,
            failed_count=int(job["unit_count"] or 1),
            credits=0,
            balance_delta=0,
        )
        status = "cancelled"
    except Exception as exc:
        mark_usage(job["usage_key"], "refund_failed", f"generation cancelled; refund: {exc}")
        status = "refund_failed"
    with db() as conn:
        conn.execute(
            "update studio_generation_jobs set status=?,credits=0,error=?,completed_at=?,updated_at=? where job_id=?",
            (status, "generation cancelled while queued", now(), now(), job["job_id"]),
        )
    record_generation_event(job["job_id"], status)
    _JOB_WAKE_EVENT.set()
    return status


def password_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180000).hex()


def seed_admin() -> None:
    username = os.environ.get("STUDIO_ADMIN_USERNAME", "admin").strip()
    password = os.environ.get("STUDIO_ADMIN_PASSWORD", "").strip()
    if not username or not password:
        return
    with db() as conn:
        exists = conn.execute("select 1 from studio_admins where username=?", (username,)).fetchone()
        if exists:
            return
        salt = secrets.token_hex(16)
        conn.execute(
            "insert into studio_admins(username,password_hash,salt,enabled,created_at) values(?,?,?,?,?)",
            (username, password_hash(password, salt), salt, 1, now()),
        )


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def protocol_template_for_api_format(api_format: str) -> str:
    return PROTOCOL_TEMPLATE_DEFAULTS.get(str(api_format or "openai").strip().lower(), "openai")


def comma_list(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def split_comma_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def normalize_provider_protocol_config(payload: dict[str, Any]) -> dict[str, Any]:
    api_format = str(payload.get("api_format") or payload.get("apiFormat") or "openai").strip().lower()
    protocol_template = str(
        payload.get("protocol_template")
        or payload.get("protocolTemplate")
        or protocol_template_for_api_format(api_format)
    ).strip().lower()
    return {
        "base_url": str(payload.get("base_url") or payload.get("baseUrl") or "").strip(),
        "api_format": api_format or "openai",
        "protocol_template": protocol_template or "openai",
        "is_async": int(bool(payload.get("is_async") if "is_async" in payload else payload.get("isAsync", protocol_template in {"openai_async", "generic_async"}))),
        "create_path": str(payload.get("create_path") or payload.get("createPath") or "").strip(),
        "poll_path_template": str(payload.get("poll_path_template") or payload.get("pollPathTemplate") or "").strip(),
        "content_path_template": str(payload.get("content_path_template") or payload.get("contentPathTemplate") or "").strip(),
        "task_id_field": str(payload.get("task_id_field") or payload.get("taskIdField") or "id").strip() or "id",
        "status_field": str(payload.get("status_field") or payload.get("statusField") or "status").strip() or "status",
        "result_url_field": str(payload.get("result_url_field") or payload.get("resultUrlField") or "url").strip() or "url",
        "completed_statuses": comma_list(payload.get("completed_statuses") if "completed_statuses" in payload else payload.get("completedStatuses")),
        "failed_statuses": comma_list(payload.get("failed_statuses") if "failed_statuses" in payload else payload.get("failedStatuses")),
        "download_result": int(bool(payload.get("download_result") if "download_result" in payload else payload.get("downloadResult", True))),
        "auth_mode": str(payload.get("auth_mode") or payload.get("authMode") or "bearer").strip().lower() or "bearer",
        "auth_header_name": str(payload.get("auth_header_name") or payload.get("authHeaderName") or "Authorization").strip() or "Authorization",
        "auth_query_name": str(payload.get("auth_query_name") or payload.get("authQueryName") or "key").strip() or "key",
        "extra_headers": json.dumps(payload.get("extra_headers") or payload.get("extraHeaders") or {}, ensure_ascii=False),
    }


PROVIDER_PROTOCOL_FIELD_ALIASES = {
    "api_format": ("api_format", "apiFormat"),
    "protocol_template": ("protocol_template", "protocolTemplate"),
    "is_async": ("is_async", "isAsync"),
    "create_path": ("create_path", "createPath"),
    "poll_path_template": ("poll_path_template", "pollPathTemplate"),
    "content_path_template": ("content_path_template", "contentPathTemplate"),
    "task_id_field": ("task_id_field", "taskIdField"),
    "status_field": ("status_field", "statusField"),
    "result_url_field": ("result_url_field", "resultUrlField"),
    "completed_statuses": ("completed_statuses", "completedStatuses"),
    "failed_statuses": ("failed_statuses", "failedStatuses"),
    "download_result": ("download_result", "downloadResult"),
    "auth_mode": ("auth_mode", "authMode"),
    "auth_header_name": ("auth_header_name", "authHeaderName"),
    "auth_query_name": ("auth_query_name", "authQueryName"),
    "extra_headers": ("extra_headers", "extraHeaders"),
}


def candidate_records(payload: Any) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[int] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            marker = id(value)
            if marker in seen:
                return
            seen.add(marker)
            records.append(value)
            for nested in value.values():
                visit(nested)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)

    visit(payload)
    return records


def protocol_statuses(raw: str) -> set[str]:
    return {item.strip().lower() for item in str(raw or "").split(",") if item.strip()}


def record_field_value(record: dict[str, Any], field: str) -> Any:
    current: Any = record
    for part in str(field or "").split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def scalar_field_value(payload: Any, field: str) -> str:
    for record in candidate_records(payload):
        value = record_field_value(record, field)
        if value is None:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def extract_async_task_fields(provider: dict[str, Any], payload: Any) -> dict[str, Any]:
    task_id = scalar_field_value(payload, str(provider.get("task_id_field") or "id")) or extract_task_id(payload)
    status = scalar_field_value(payload, str(provider.get("status_field") or "status"))
    result_url = scalar_field_value(payload, str(provider.get("result_url_field") or "url"))
    status_key = status.strip().lower()
    return {
        "task_id": task_id,
        "status": status,
        "result_url": result_url,
        "is_completed": bool(status_key and status_key in protocol_statuses(str(provider.get("completed_statuses") or ""))),
        "is_failed": bool(status_key and status_key in protocol_statuses(str(provider.get("failed_statuses") or ""))),
    }


def uses_generic_async(provider: dict[str, Any]) -> bool:
    return str(provider.get("protocol_template") or "").strip().lower() == "generic_async" or int(provider.get("is_async") or 0) == 1


def set_session(payload: dict[str, Any]) -> str:
    token = "st_" + secrets.token_urlsafe(32)
    ts = now()
    source = str(payload.get("source") or "")
    balance = float(payload.get("balance") or 0)
    points = float(payload["points"]) if payload.get("points") is not None else studio_points_from_balance(balance, source)
    with db() as conn:
        conn.execute(
            """
            insert into studio_sessions
                (token,source,user_id,username,email,role,upstream_token,upstream_payload,balance,points,expires_at,created_at,updated_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                token,
                source,
                str(payload["user_id"]),
                payload.get("username") or "",
                payload.get("email") or "",
                payload.get("role") or "user",
                payload.get("upstream_token") or "",
                json.dumps(payload.get("upstream_payload") or {}, ensure_ascii=False),
                balance,
                points,
                ts + SESSION_TTL,
                ts,
                ts,
            ),
        )
    return token


def read_cookie(headers: Any, name: str) -> str:
    cookie = headers.get("Cookie", "")
    for item in cookie.split(";"):
        if "=" not in item:
            continue
        k, v = item.strip().split("=", 1)
        if k == name:
            return urllib.parse.unquote(v)
    return ""


def current_session(headers: Any, *, admin: bool = False) -> dict[str, Any]:
    token = read_cookie(headers, "studio_session")
    if not token:
        auth = headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if not token:
        raise StudioError(401, "Unauthorized")
    with db() as conn:
        row = conn.execute("select * from studio_sessions where token=? and expires_at>?", (token, now())).fetchone()
    session = row_dict(row)
    if not session:
        raise StudioError(401, "Session expired")
    if admin and session.get("role") != "studio_admin":
        raise StudioError(403, "Studio admin required")
    return session


def response_cookie(token: str) -> str:
    return f"studio_session={urllib.parse.quote(token)}; Max-Age={SESSION_TTL}; Path=/; HttpOnly; SameSite=Lax; Secure"


def clear_cookie() -> str:
    return "studio_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure"


def revoke_session(headers: Any) -> None:
    token = read_cookie(headers, "studio_session")
    if not token:
        auth = str(headers.get("Authorization") or "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if not token:
        return
    with db() as conn:
        conn.execute("delete from studio_sessions where token=?", (token,))


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
    resp = requests.request(method, url, json=payload, headers=headers or {}, timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 400:
        raise StudioError(resp.status_code, resp.text[:1000] or resp.reason)
    return resp.json() if resp.text else {}


def massmore_login(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    data = http_json("POST", f"{MASSMORE_BRIDGE}/studio-api/user/login", {"username": payload.get("username") or payload.get("email"), "password": payload.get("password")})
    user = (data.get("data") or {})
    managed = user.get("managed") or {}
    managed_user = managed.get("user") or user
    token = ((managed.get("mainSession") or {}).get("value") or "").strip()
    balance = float(managed_user.get("quota") or user.get("quota") or 0)
    session_token = set_session(
        {
            "source": "massmore",
            "user_id": managed_user.get("id") or user.get("id"),
            "username": managed_user.get("username") or user.get("username") or "",
            "email": managed_user.get("email") or user.get("email") or "",
            "role": "user",
            "upstream_token": token,
            "upstream_payload": data,
            "balance": balance,
            "points": studio_points_from_balance(balance, "massmore"),
        }
    )
    return self_payload(current_session({"Cookie": f"studio_session={session_token}"})), session_token


def mtline_login(payload: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    sess = requests.Session()
    username = str(payload.get("username") or payload.get("email") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        raise StudioError(400, "Mtline username and password are required")
    resp = sess.post(
        f"{MTLINE_BASE}/api/user/login?turnstile=",
        json={"username": username, "password": password},
        headers={"Accept": "application/json", "User-Agent": "StudioManaged/1.0"},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise StudioError(resp.status_code, resp.text[:1000] or resp.reason)
    try:
        data = resp.json()
    except ValueError as exc:
        raise StudioError(502, "Mtline login returned an invalid response") from exc
    if not isinstance(data, dict):
        raise StudioError(502, "Mtline login returned an invalid response")
    if data.get("success") is False:
        message = str(data.get("message") or "").strip().lower()
        if "banned" in message or "disabled" in message:
            detail = "Mtline account is disabled or banned"
        elif "password" in message or "username" in message or "credential" in message:
            detail = "Mtline username or password is incorrect"
        else:
            detail = "Mtline rejected the login request"
        raise StudioError(401, detail)
    if data.get("require_2fa") or (isinstance(data.get("data"), dict) and data["data"].get("require_2fa")):
        pending = "m2fa_" + secrets.token_urlsafe(24)
        with db() as conn:
            conn.execute(
                "insert or replace into studio_pending_mtline_2fa(token,username,cookies,payload,expires_at) values(?,?,?,?,?)",
                (pending, str(payload.get("username") or payload.get("email") or ""), json.dumps(sess.cookies.get_dict()), json.dumps(data, ensure_ascii=False), now() + 600),
            )
        return {"success": True, "require2fa": True, "pendingToken": pending}, None
    return finish_mtline_login(sess, data)


def mtline_login_2fa(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    pending = str(payload.get("pendingToken") or "")
    code = str(payload.get("code") or payload.get("totp") or "")
    with db() as conn:
        row = conn.execute("select * from studio_pending_mtline_2fa where token=? and expires_at>?", (pending, now())).fetchone()
    item = row_dict(row)
    if not item:
        raise StudioError(400, "2FA session expired")
    sess = requests.Session()
    sess.cookies.update(json.loads(item["cookies"]))
    resp = sess.post(f"{MTLINE_BASE}/api/user/login/2fa", json={"code": code}, timeout=60)
    if resp.status_code >= 400:
        raise StudioError(resp.status_code, resp.text[:1000] or resp.reason)
    try:
        data = resp.json()
    except ValueError as exc:
        raise StudioError(502, "Mtline 2FA returned an invalid response") from exc
    if not isinstance(data, dict):
        raise StudioError(502, "Mtline 2FA returned an invalid response")
    if data.get("success") is False:
        raise StudioError(401, "Mtline 2FA verification failed")
    return finish_mtline_login(sess, data)


def finish_mtline_login(sess: requests.Session, data: dict[str, Any]) -> tuple[dict[str, Any], str]:
    candidates: list[dict[str, Any]] = []
    if isinstance(data, dict):
        candidates.append(data)
        nested = data.get("data")
        if isinstance(nested, dict):
            candidates.append(nested)
            if isinstance(nested.get("user"), dict):
                candidates.append(nested["user"])
        if isinstance(data.get("user"), dict):
            candidates.append(data["user"])
    user = next(
        (
            item
            for item in candidates
            if any(str(item.get(key) or "").strip() for key in ("id", "user_id", "uid"))
        ),
        candidates[-1] if candidates else {},
    )
    user_id = str(user.get("id") or user.get("user_id") or user.get("uid") or "")
    if not user_id:
        raise StudioError(502, "Mtline login response did not include a user id")
    balance = float(user.get("quota") or user.get("balance") or 0)
    token = set_session(
        {
            "source": "mtline",
            "user_id": user_id,
            "username": user.get("username") or user.get("display_name") or user.get("email") or user_id,
            "email": user.get("email") or "",
            "role": "user",
            "upstream_token": "",
            "upstream_payload": {"login": data, "cookies": sess.cookies.get_dict()},
            "balance": balance,
            "points": studio_points_from_balance(balance, "mtline"),
        }
    )
    session = current_session({"Cookie": f"studio_session={token}"})
    balance_sync_error = ""
    try:
        refresh_session_balance(session)
    except Exception as exc:
        # Keep the authenticated session, but fail closed for generation when
        # the source ledger cannot be read. Do not turn an outage into 0 balance.
        balance_sync_error = redact_error_message(exc)
    response = self_payload(session)
    response["balanceSync"] = {"ok": not balance_sync_error, "message": balance_sync_error}
    return response, token


def admin_login(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    with db() as conn:
        row = conn.execute("select * from studio_admins where username=? and enabled=1", (username,)).fetchone()
    admin = row_dict(row)
    if not admin or not hmac.compare_digest(admin["password_hash"], password_hash(password, admin["salt"])):
        raise StudioError(401, "Invalid admin credentials")
    token = set_session(
        {
            "source": "studio",
            "user_id": username,
            "username": username,
            "email": "",
            "role": "studio_admin",
            "balance": 0,
            "points": 0,
        }
    )
    return self_payload(current_session({"Cookie": f"studio_session={token}"})), token


def self_payload(session: dict[str, Any]) -> dict[str, Any]:
    balance = session["balance"]
    points = studio_points_from_balance(balance, session["source"])
    if session["source"] == "studio" and session["role"] == "studio_admin":
        points = STUDIO_ADMIN_TEST_POINTS
        balance = source_balance_from_points(STUDIO_ADMIN_TEST_POINTS, "studio")
    return {
        "success": True,
        "user": {
            "id": session["user_id"],
            "username": session["username"],
            "email": session.get("email") or "",
            "source": session["source"],
            "role": session["role"],
            "balance": balance,
            "points": points,
            "pointsPerDollar": configured_points_per_dollar(),
            "sourceBalanceUnitsPerDollar": source_units_per_dollar(session["source"]),
            "rechargeUrl": recharge_url(session["source"]),
        },
    }


def recharge_url(source: str) -> str:
    if source == "mtline":
        return os.environ.get("STUDIO_MTLINE_RECHARGE_URL", "https://mtline.cc/topup")
    return os.environ.get("STUDIO_MASSMORE_RECHARGE_URL", "https://massmore.org/purchase")


def list_models(enabled_only: bool = True) -> list[dict[str, Any]]:
    where = "where m.enabled=1 and p.enabled=1" if enabled_only else ""
    with db() as conn:
        rows = conn.execute(
            f"""
            select m.*, p.name provider_name, p.api_format
            from studio_model_catalog m
            join studio_provider_configs p on p.id=m.provider_id
            {where}
            order by m.capability, m.display_name
            """
        ).fetchall()
    items = [public_model(dict(row)) for row in rows]
    logical: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        key = (str(item["capability"]), str(item["displayName"] or item["model"]))
        current = logical.get(key)
        if current is None or (item.get("failoverEnabled") and not current.get("failoverEnabled")):
            logical[key] = item
    return list(logical.values())


def public_model(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["model"],
        "model": row["model"],
        "displayName": row["display_name"],
        "capability": row["capability"],
        "creditCost": row["credit_cost"],
        "pricingRules": safe_json_object(row.get("pricing_rules") or "{}"),
        "provider": row.get("provider_name", ""),
        "apiFormat": row.get("api_format", "openai"),
        "enabled": bool(row["enabled"]),
        "failoverEnabled": bool(row.get("failover_enabled", 0)),
        "failoverRouteModelIds": safe_json_int_list(row.get("failover_route_model_ids") or "[]"),
    }


def safe_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def safe_json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    try:
        parsed = json.loads(str(value or "[]"))
        return [str(item).strip() for item in parsed if str(item).strip()] if isinstance(parsed, list) else []
    except Exception:
        return []


def safe_json_int_list(value: Any) -> list[int]:
    if isinstance(value, list):
        raw = value
    else:
        try:
            parsed = json.loads(str(value or "[]"))
            raw = parsed if isinstance(parsed, list) else []
        except Exception:
            raw = []
    result: list[int] = []
    for item in raw:
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        if parsed > 0 and parsed not in result:
            result.append(parsed)
    return result


STORAGE_SETTINGS_KEY = "storage_settings"


def default_storage_settings() -> dict[str, Any]:
    return {
        "mode": "local_indexeddb",
        "allowUserProvider": False,
        "allowUserGlobalProvider": True,
        "providers": [],
        "roundRobinCursor": 0,
    }


def normalize_storage_path_prefix(value: Any) -> str:
    raw = str(value or "").strip().strip("/")
    if not raw:
        return "canvas"
    parts = [part for part in raw.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)[:240] or "canvas"


def normalize_storage_provider(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    provider_type = "webdav" if str(raw.get("type") or "").strip().lower() == "webdav" else "s3"
    endpoint = str(raw.get("endpoint") or "").strip().rstrip("/")
    public_base_url = str(raw.get("publicBaseUrl") or raw.get("public_base_url") or "").strip().rstrip("/")
    if endpoint:
        endpoint = validate_provider_base_url(endpoint)
    if public_base_url:
        public_base_url = validate_provider_base_url(public_base_url)
    provider = {
        "id": str(raw.get("id") or "").strip()[:96],
        "name": str(raw.get("name") or "").strip()[:120],
        "type": provider_type,
        "endpoint": endpoint,
        "region": str(raw.get("region") or "auto").strip()[:80] if provider_type == "s3" else "",
        "bucket": str(raw.get("bucket") or "").strip()[:255] if provider_type == "s3" else "",
        "accessKeyId": str(raw.get("accessKeyId") or raw.get("access_key_id") or "").strip()[:512] if provider_type == "s3" else "",
        "secretAccessKey": str(raw.get("secretAccessKey") or raw.get("secret_access_key") or "").strip()[:2048] if provider_type == "s3" else "",
        "publicBaseUrl": public_base_url if provider_type == "s3" else "",
        "pathPrefix": normalize_storage_path_prefix(raw.get("pathPrefix") or raw.get("path_prefix")),
        "username": str(raw.get("username") or "").strip()[:512] if provider_type == "webdav" else "",
        "password": str(raw.get("password") or "")[:2048] if provider_type == "webdav" else "",
        "weight": max(1, min(100, int(raw.get("weight") or 1))),
        "enabled": bool(raw.get("enabled", True)),
    }
    return provider


def storage_provider_is_complete(provider: dict[str, Any]) -> bool:
    if not provider.get("endpoint"):
        return False
    if provider.get("type") == "webdav":
        return bool(provider.get("username") and provider.get("password"))
    return bool(provider.get("bucket") and provider.get("accessKeyId") and provider.get("secretAccessKey"))


def normalize_storage_settings(value: Any) -> dict[str, Any]:
    raw = safe_json_object(value)
    defaults = default_storage_settings()
    mode = str(raw.get("mode") or defaults["mode"]).strip()
    if mode not in {"local_indexeddb", "server_sqlite_s3"}:
        mode = defaults["mode"]
    providers: list[dict[str, Any]] = []
    for item in raw.get("providers") or []:
        if not isinstance(item, dict):
            continue
        provider = normalize_storage_provider(item)
        if provider["id"] == "":
            provider["id"] = f"storage-{len(providers) + 1}"
        providers.append(provider)
    return {
        "mode": mode,
        "allowUserProvider": raw.get("allowUserProvider") is True,
        "allowUserGlobalProvider": raw.get("allowUserGlobalProvider") is not False,
        "providers": providers[:12],
        "roundRobinCursor": max(0, int(raw.get("roundRobinCursor") or 0)),
    }


def storage_settings() -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select value from studio_runtime_settings where key=?", (STORAGE_SETTINGS_KEY,)).fetchone()
    return normalize_storage_settings(row["value"] if row else {})


def public_storage_settings() -> dict[str, Any]:
    settings = storage_settings()
    has_global_provider = any(item.get("enabled") and storage_provider_is_complete(item) for item in settings["providers"])
    return {
        "mode": "server_sqlite_s3" if settings["mode"] == "server_sqlite_s3" and has_global_provider else "local_indexeddb",
        "allowUserProvider": bool(settings["allowUserProvider"]),
        "allowUserGlobalProvider": bool(settings["allowUserGlobalProvider"]),
    }


def register_direct_storage_object(session: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    settings = storage_settings()
    if not settings["allowUserProvider"]:
        raise StudioError(403, "User-managed storage is disabled")
    provider = normalize_storage_provider(payload.get("provider") or {})
    if provider["type"] != "webdav" or not storage_provider_is_complete(provider):
        raise StudioError(400, "Direct registration requires a complete WebDAV provider")
    object_key = str(payload.get("objectKey") or "").strip().strip("/")
    if not object_key or len(object_key) > 1024 or ".." in object_key.split("/"):
        raise StudioError(400, "Invalid storage object key")
    try:
        size = max(0, int(payload.get("bytes") or 0))
    except (TypeError, ValueError) as exc:
        raise StudioError(400, "Invalid storage object size") from exc
    object_id = "obj_" + secrets.token_hex(16)
    content_type = str(payload.get("mimeType") or "application/octet-stream")[:255]
    stored_provider = dict(provider)
    stored_provider["password"] = ""
    stored_provider["direct"] = True
    ts = now()
    with db() as conn:
        conn.execute(
            "insert into studio_storage_objects(id,source,user_id,provider_json,object_key,mime_type,bytes,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)",
            (object_id, session["source"], session["user_id"], json.dumps(stored_provider, ensure_ascii=False), object_key, content_type, size, ts, ts),
        )
    return {"id": object_id, "url": "", "storageKey": f"server:{object_id}", "bytes": size, "mimeType": content_type}


def save_storage_settings(actor: str, value: Any) -> dict[str, Any]:
    previous = storage_settings()
    settings = normalize_storage_settings(value)
    previous_by_id = {str(item.get("id") or ""): item for item in previous.get("providers", [])}
    for provider in settings["providers"]:
        old = previous_by_id.get(str(provider.get("id") or ""))
        if old:
            if provider.get("type") == old.get("type") == "s3" and not provider.get("secretAccessKey"):
                provider["secretAccessKey"] = old.get("secretAccessKey", "")
            if provider.get("type") == old.get("type") == "s3" and not provider.get("accessKeyId"):
                provider["accessKeyId"] = old.get("accessKeyId", "")
            if provider.get("type") == old.get("type") == "webdav" and not provider.get("password"):
                provider["password"] = old.get("password", "")
    if settings["mode"] == "server_sqlite_s3":
        enabled = [item for item in settings["providers"] if item.get("enabled")]
        if not enabled:
            raise StudioError(400, "Enable at least one storage provider before enabling global storage")
        if any(not storage_provider_is_complete(item) for item in enabled):
            raise StudioError(400, "Every enabled storage provider requires its complete connection details")
    ts = now()
    serialized = json.dumps(settings, ensure_ascii=False)
    with db() as conn:
        conn.execute(
            """
            insert into studio_runtime_settings(key,value,updated_by,created_at,updated_at)
            values(?,?,?,?,?)
            on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at
            """,
            (STORAGE_SETTINGS_KEY, serialized, actor, ts, ts),
        )
    return settings


def storage_object_key(session: dict[str, Any], filename: str) -> str:
    suffix = Path(filename or "file.bin").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,12}", suffix):
        suffix = ".bin"
    source = re.sub(r"[^a-z0-9_-]+", "-", str(session.get("source") or "studio").lower()).strip("-") or "studio"
    user_hash = hashlib.sha256(str(session.get("user_id") or "").encode("utf-8")).hexdigest()[:16]
    return f"users/{source}/{user_hash}/{now()}-{secrets.token_hex(12)}{suffix}"


def storage_remote_key(provider: dict[str, Any], object_key: str) -> str:
    prefix = normalize_storage_path_prefix(provider.get("pathPrefix"))
    return f"{prefix}/{object_key}" if prefix else object_key


def storage_s3_url(provider: dict[str, Any], object_key: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(str(provider.get("endpoint") or ""))
    if not parsed.scheme or not parsed.netloc:
        raise StudioError(400, "Storage endpoint is invalid")
    bucket = str(provider.get("bucket") or "").strip()
    if not bucket:
        raise StudioError(400, "S3 bucket is required")
    encoded_key = urllib.parse.quote(storage_remote_key(provider, object_key), safe="/-_.~")
    base_path = parsed.path.rstrip("/")
    path = f"{base_path}/{urllib.parse.quote(bucket, safe='-_.~')}/{encoded_key}"
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")), path


def aws_v4_signature(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def storage_s3_request(provider: dict[str, Any], method: str, object_key: str, body: bytes | None = None) -> Any:
    url, canonical_uri = storage_s3_url(provider, object_key)
    parsed = urllib.parse.urlparse(url)
    content = body or b""
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    date_stamp = amz_date[:8]
    payload_hash = hashlib.sha256(content).hexdigest()
    host = parsed.netloc
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    region = str(provider.get("region") or "auto")
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, credential_scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])
    secret = str(provider.get("secretAccessKey") or "")
    signing_key = aws_v4_signature(aws_v4_signature(aws_v4_signature(aws_v4_signature(("AWS4" + secret).encode("utf-8"), date_stamp), region), "s3"), "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    access_key = str(provider.get("accessKeyId") or "")
    headers = {
        "Host": host,
        "X-Amz-Date": amz_date,
        "X-Amz-Content-Sha256": payload_hash,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
    }
    if method == "PUT":
        headers["Content-Type"] = "application/octet-stream"
    try:
        response = requests.request(method, url, data=content if method in {"PUT", "POST"} else None, headers=headers, timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        raise StudioError(502, "Storage provider request failed") from exc
    if response.status_code >= 400:
        raise StudioError(502, f"Storage provider returned HTTP {response.status_code}")
    return response


def storage_webdav_url(provider: dict[str, Any], object_key: str) -> str:
    endpoint = str(provider.get("endpoint") or "").rstrip("/")
    if not endpoint:
        raise StudioError(400, "WebDAV endpoint is required")
    return endpoint + "/" + urllib.parse.quote(storage_remote_key(provider, object_key), safe="/-_.~")


def storage_webdav_request(provider: dict[str, Any], method: str, object_key: str, body: bytes | None = None) -> Any:
    try:
        response = requests.request(
            method,
            storage_webdav_url(provider, object_key),
            data=body if method in {"PUT", "POST"} else None,
            auth=(str(provider.get("username") or ""), str(provider.get("password") or "")),
            timeout=REQUEST_TIMEOUT,
        )
    except Exception as exc:
        raise StudioError(502, "Storage provider request failed") from exc
    if response.status_code >= 400 and not (method == "DELETE" and response.status_code == 404):
        raise StudioError(502, f"Storage provider returned HTTP {response.status_code}")
    return response


def selected_global_storage_provider() -> dict[str, Any]:
    settings = storage_settings()
    if settings["mode"] != "server_sqlite_s3":
        raise StudioError(400, "Global object storage is not enabled")
    providers = [item for item in settings["providers"] if item.get("enabled") and storage_provider_is_complete(item)]
    if not providers:
        raise StudioError(400, "No usable global storage provider is configured")
    index = settings["roundRobinCursor"] % len(providers)
    settings["roundRobinCursor"] += 1
    ts = now()
    with db() as conn:
        conn.execute(
            "update studio_runtime_settings set value=?,updated_at=? where key=?",
            (json.dumps(settings, ensure_ascii=False), ts, STORAGE_SETTINGS_KEY),
        )
    return providers[index]


def storage_provider_for_upload(session: dict[str, Any], raw_provider: Any) -> tuple[dict[str, Any], bool]:
    if not isinstance(raw_provider, dict) or not raw_provider:
        return selected_global_storage_provider(), False
    settings = storage_settings()
    if not settings["allowUserProvider"]:
        raise StudioError(403, "User-managed storage is disabled")
    provider = normalize_storage_provider(raw_provider)
    if provider["type"] == "webdav":
        raise StudioError(400, "Use the browser WebDAV integration for a personal WebDAV provider")
    if not storage_provider_is_complete(provider) or not provider.get("publicBaseUrl"):
        raise StudioError(400, "Personal S3/R2 storage requires endpoint, bucket, keys, and a public base URL")
    return provider, True


def storage_public_url(provider: dict[str, Any], object_key: str) -> str:
    base = str(provider.get("publicBaseUrl") or "").rstrip("/")
    if not base:
        return ""
    return base + "/" + urllib.parse.quote(storage_remote_key(provider, object_key), safe="/-_.~")


def store_uploaded_object(session: dict[str, Any], provider: dict[str, Any], user_owned: bool, filename: str, content: bytes, content_type: str) -> dict[str, Any]:
    if len(content) > MAX_MULTIPART_BODY_BYTES:
        raise StudioError(413, "Storage upload is too large")
    object_key = storage_object_key(session, filename)
    if provider["type"] == "webdav":
        storage_webdav_request(provider, "PUT", object_key, content)
    else:
        storage_s3_request(provider, "PUT", object_key, content)
    object_id = "obj_" + secrets.token_hex(16)
    ts = now()
    stored_provider = dict(provider)
    if user_owned:
        # A personal S3/R2 provider is supplied for this request only. Keep the
        # public object location, never the user's credentials, in Studio's DB.
        stored_provider["accessKeyId"] = ""
        stored_provider["secretAccessKey"] = ""
        stored_provider["publicOnly"] = True
    with db() as conn:
        conn.execute(
            "insert into studio_storage_objects(id,source,user_id,provider_json,object_key,mime_type,bytes,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)",
            (object_id, session["source"], session["user_id"], json.dumps(stored_provider, ensure_ascii=False), object_key, content_type[:255] or "application/octet-stream", len(content), ts, ts),
        )
    public_url = storage_public_url(provider, object_key) if user_owned else ""
    return {
        "id": object_id,
        "url": public_url or f"/studio-api/files/{object_id}/content",
        "storageKey": f"server:{object_id}",
        "bytes": len(content),
        "mimeType": content_type[:255] or "application/octet-stream",
    }


def storage_object_for_session(object_id: str, session: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select * from studio_storage_objects where id=? and source=? and user_id=?", (object_id, session["source"], session["user_id"])).fetchone()
    if not row:
        raise StudioError(404, "Stored file was not found")
    return dict(row)


def read_storage_object(row: dict[str, Any]) -> bytes:
    raw_provider = safe_json_object(row.get("provider_json") or "{}")
    provider = normalize_storage_provider(raw_provider)
    if raw_provider.get("direct") is True:
        raise StudioError(409, "This object is available through the owner's direct WebDAV configuration")
    if raw_provider.get("publicOnly") is True:
        public_url = storage_public_url(provider, str(row["object_key"]))
        if not public_url:
            raise StudioError(410, "The personal storage object is unavailable")
        try:
            response = requests.get(public_url, timeout=REQUEST_TIMEOUT)
        except Exception as exc:
            raise StudioError(502, "Storage provider request failed") from exc
        if response.status_code >= 400:
            raise StudioError(502, f"Storage provider returned HTTP {response.status_code}")
        return bytes(response.content)
    if provider["type"] == "webdav":
        response = storage_webdav_request(provider, "GET", str(row["object_key"]))
    else:
        response = storage_s3_request(provider, "GET", str(row["object_key"]))
    return bytes(response.content)


def delete_storage_object(row: dict[str, Any], override_provider: Any = None) -> None:
    raw_provider = safe_json_object(row.get("provider_json") or "{}")
    if raw_provider.get("direct") is True:
        with db() as conn:
            conn.execute("delete from studio_storage_objects where id=?", (row["id"],))
        return
    if raw_provider.get("publicOnly") is True:
        provider = normalize_storage_provider(override_provider or {})
        required = ("endpoint", "bucket", "publicBaseUrl", "pathPrefix")
        if provider.get("type") != "s3" or not storage_provider_is_complete(provider) or any(provider.get(key) != raw_provider.get(key) for key in required):
            raise StudioError(400, "Personal S3/R2 credentials are required to delete this object")
        storage_s3_request(provider, "DELETE", str(row["object_key"]))
        with db() as conn:
            conn.execute("delete from studio_storage_objects where id=?", (row["id"],))
        return
    provider = normalize_storage_provider(raw_provider)
    if provider["type"] == "webdav":
        storage_webdav_request(provider, "DELETE", str(row["object_key"]))
    else:
        storage_s3_request(provider, "DELETE", str(row["object_key"]))
    with db() as conn:
        conn.execute("delete from studio_storage_objects where id=?", (row["id"],))


def admin_storage_settings() -> dict[str, Any]:
    settings = storage_settings()
    providers: list[dict[str, Any]] = []
    for item in settings["providers"]:
        provider = dict(item)
        if provider.get("type") == "s3":
            provider["accessKeyId"] = ""
            provider["secretAccessKey"] = ""
        else:
            provider["password"] = ""
        providers.append(provider)
    return {**settings, "providers": providers}


def public_workflow(row: dict[str, Any]) -> dict[str, Any]:
    definition = WORKFLOW_DEFINITIONS.get(str(row.get("workflow_key") or ""), {})
    return {
        "key": row.get("workflow_key", ""),
        "name": definition.get("name", row.get("workflow_key", "")),
        "description": definition.get("description", ""),
        "enabled": bool(row.get("enabled", 0)),
        "accessMode": row.get("access_mode", "all"),
        "allowedUsers": safe_json_list(row.get("allowed_users") or "[]"),
        "updatedAt": int(row.get("updated_at") or 0),
    }


def workflow_identity_tokens(session: dict[str, Any]) -> set[str]:
    source = str(session.get("source") or "").strip().lower()
    values = {
        str(session.get("user_id") or "").strip().lower(),
        str(session.get("username") or "").strip().lower(),
        str(session.get("email") or "").strip().lower(),
    }
    values.discard("")
    return values | {f"{source}:{value}" for value in values if source}


def list_workflows(session: dict[str, Any], admin: bool = False) -> list[dict[str, Any]]:
    identities = workflow_identity_tokens(session)
    is_studio_admin = session.get("role") == "studio_admin"
    with db() as conn:
        rows = [dict(row) for row in conn.execute("select * from studio_workflow_access order by workflow_key")]
    workflows: list[dict[str, Any]] = []
    for row in rows:
        item = public_workflow(row)
        if admin:
            workflows.append(item)
            continue
        if not item["enabled"]:
            continue
        allowed = {value.lower() for value in item["allowedUsers"]}
        if is_studio_admin or item["accessMode"] == "all" or identities.intersection(allowed):
            workflows.append(item)
    return workflows


def list_workflow_user_options() -> list[dict[str, str]]:
    options: dict[str, dict[str, str]] = {}
    with db() as conn:
        rows = conn.execute(
            """
            select source,user_id,username,coalesce(email,'') email from studio_sessions
            union
            select source,user_id,username,coalesce(email,'') email from studio_usage_ledger
            """
        ).fetchall()
    for row in rows:
        source = str(row["source"] or "").strip().lower()
        username = str(row["username"] or "").strip()
        email = str(row["email"] or "").strip()
        user_id = str(row["user_id"] or "").strip()
        identity = username or email or user_id
        if not identity:
            continue
        value = f"{source}:{identity}" if source else identity
        options[value.lower()] = {
            "value": value,
            "label": f"{identity} ({source or 'studio'})",
            "source": source,
            "userId": user_id,
            "username": username,
            "email": email,
        }
    return sorted(options.values(), key=lambda item: item["label"].lower())


def list_generation_concurrency_users() -> list[dict[str, Any]]:
    default_limit, overrides = generation_concurrency_snapshot()
    users: dict[tuple[str, str], dict[str, Any]] = {}
    with db() as conn:
        identity_rows = conn.execute(
            """
            select source,user_id,username,coalesce(email,'') email from studio_sessions
            union all
            select source,user_id,username,coalesce(email,'') email from studio_usage_ledger
            """
        ).fetchall()
        active_rows = conn.execute(
            """
            select source,user_id,
                sum(case when status='running' then 1 else 0 end) running,
                sum(case when status='queued' then 1 else 0 end) queued
            from studio_generation_jobs
            where status in ('running','queued')
            group by source,user_id
            """
        ).fetchall()
    for row in identity_rows:
        source = str(row["source"] or "").strip().lower()
        user_id = str(row["user_id"] or "").strip()
        if not source or not user_id:
            continue
        key = (source, user_id)
        item = users.setdefault(
            key,
            {
                "source": source,
                "userId": user_id,
                "username": "",
                "email": "",
                "running": 0,
                "queued": 0,
            },
        )
        if not item["username"]:
            item["username"] = str(row["username"] or "").strip()
        if not item["email"]:
            item["email"] = str(row["email"] or "").strip()
    for source, user_id in overrides:
        users.setdefault(
            (source, user_id),
            {"source": source, "userId": user_id, "username": "", "email": "", "running": 0, "queued": 0},
        )
    for row in active_rows:
        key = (str(row["source"]), str(row["user_id"]))
        item = users.setdefault(
            key,
            {"source": key[0], "userId": key[1], "username": "", "email": "", "running": 0, "queued": 0},
        )
        item["running"] = int(row["running"] or 0)
        item["queued"] = int(row["queued"] or 0)
    result: list[dict[str, Any]] = []
    for key, item in users.items():
        override = overrides.get(key)
        identity = item["username"] or item["email"] or item["userId"]
        result.append(
            {
                **item,
                "label": f"{identity} ({item['source']})",
                "overrideLimit": override,
                "effectiveLimit": override if override is not None else default_limit,
            }
        )
    return sorted(result, key=lambda item: (item["source"], item["label"].lower()))


def public_provider(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "api_format": row.get("api_format", "openai"),
        "protocol_template": row.get("protocol_template", protocol_template_for_api_format(row.get("api_format", "openai"))),
        "is_async": int(row.get("is_async", 0)),
        "create_path": row.get("create_path", ""),
        "poll_path_template": row.get("poll_path_template", ""),
        "content_path_template": row.get("content_path_template", ""),
        "task_id_field": row.get("task_id_field", "id"),
        "status_field": row.get("status_field", "status"),
        "result_url_field": row.get("result_url_field", "url"),
        "completed_statuses": split_comma_list(row.get("completed_statuses", "")),
        "failed_statuses": split_comma_list(row.get("failed_statuses", "")),
        "download_result": int(row.get("download_result", 1)),
        "auth_mode": row.get("auth_mode", "bearer"),
        "auth_header_name": row.get("auth_header_name", "Authorization"),
        "auth_query_name": row.get("auth_query_name", "key"),
        "extra_headers": json.loads(row.get("extra_headers") or "{}"),
        "enabled": row["enabled"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def provider_config_by_id(provider_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select * from studio_provider_configs where id=?", (provider_id,)).fetchone()
    config = row_dict(row)
    if not config:
        raise StudioError(404, "Provider was not found")
    if not int(config.get("enabled") or 0):
        raise StudioError(409, "Provider is disabled")
    return config


def discovered_upstream_models(payload: Any) -> list[dict[str, str]]:
    candidates: list[Any] = []
    if isinstance(payload, dict):
        for key in ("data", "models", "items", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                candidates.extend(value)
            elif isinstance(value, dict):
                candidates.extend(value.get("data") or value.get("models") or value.get("items") or [])
    elif isinstance(payload, list):
        candidates = payload
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in candidates:
        if isinstance(item, str):
            model_id = item.strip()
            display_name = model_id
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
            display_name = str(item.get("name") or item.get("display_name") or item.get("displayName") or model_id).strip()
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        result.append({"id": model_id, "displayName": display_name or model_id})
        if len(result) >= 1000:
            break
    return result


def provider_model_discovery(provider_id: int) -> list[dict[str, str]]:
    config = provider_config_by_id(provider_id)
    url = build_upstream_url(config, "/models")
    response = requests.get(url, headers=proxy_auth_headers(config, url), timeout=REQUEST_TIMEOUT)
    if response.status_code >= 400:
        raise StudioError(response.status_code, response.text[:500] or response.reason)
    models = discovered_upstream_models(response.json() if response.text else {})
    if not models:
        raise StudioError(502, "Upstream returned no usable models")
    return models


def real_model_test(model_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "select m.*, p.name provider_name, p.base_url, p.api_key, p.api_format, p.protocol_template, p.is_async, p.create_path, p.poll_path_template, p.content_path_template, p.task_id_field, p.status_field, p.result_url_field, p.completed_statuses, p.failed_statuses, p.download_result, p.auth_mode, p.auth_header_name, p.auth_query_name, p.extra_headers, p.enabled provider_enabled from studio_model_catalog m join studio_provider_configs p on p.id=m.provider_id where m.id=?",
            (model_id,),
        ).fetchone()
    config = row_dict(row)
    if not config:
        raise StudioError(404, "Model was not found")
    if not int(config.get("enabled") or 0) or not int(config.get("provider_enabled") or 0):
        raise StudioError(409, "Model or provider is disabled")
    capability = str(config.get("capability") or "text")
    model = str(config.get("model") or "")
    path = str(config.get("create_path") or "").strip()
    if not path:
        path = {"text": "/chat/completions", "image": "/images/generations", "video": "/videos", "audio": "/audio/speech"}.get(capability, "/chat/completions")
    payload: dict[str, Any]
    if capability == "text":
        payload = {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}
    elif capability == "image":
        payload = {"model": model, "prompt": "a simple red square on a white background", "n": 1, "size": "1024x1024"}
    elif capability == "video":
        payload = {"model": model, "prompt": "a calm blue sky", "seconds": 5, "duration": 5}
    else:
        payload = {"model": model, "input": "hi", "voice": "alloy", "response_format": "mp3"}
    url = build_upstream_url(config, path)
    started = time.monotonic()
    response = requests.post(url, json=payload, headers=proxy_headers(config, target_url=url), timeout=min(ASYNC_JOB_TIMEOUT, 120))
    elapsed = int((time.monotonic() - started) * 1000)
    ok = 200 <= response.status_code < 300
    detail = response.text[:300].replace("\n", " ") if not ok else "HTTP response indicates the model is callable"
    return {"ok": ok, "statusCode": response.status_code, "message": f"HTTP {response.status_code}: {detail} ({elapsed} ms)"}


def admin_model(row: dict[str, Any]) -> dict[str, Any]:
    item = public_model(row)
    item["rowId"] = row["id"]
    item["providerId"] = row["provider_id"]
    item["createdAt"] = row["created_at"]
    item["updatedAt"] = row["updated_at"]
    return item


def model_config_rows(model: str, capability: str | None = None) -> list[dict[str, Any]]:
    args: list[Any] = [model]
    cap_sql = ""
    if capability:
        cap_sql = "and m.capability=?"
        args.append(capability)
    with db() as conn:
        rows = conn.execute(
            f"""
            select
                m.*,
                p.name provider_name,
                p.base_url,
                p.api_key,
                p.api_format,
                p.protocol_template,
                p.is_async,
                p.create_path,
                p.poll_path_template,
                p.content_path_template,
                p.task_id_field,
                p.status_field,
                p.result_url_field,
                p.completed_statuses,
                p.failed_statuses,
                p.download_result,
                p.auth_mode,
                p.auth_header_name,
                p.auth_query_name,
                p.extra_headers
            from studio_model_catalog m
            join studio_provider_configs p on p.id=m.provider_id
            where m.model=? {cap_sql} and m.enabled=1 and p.enabled=1
            order by m.id asc
            """,
            args,
        ).fetchall()
    configs = [dict(row) for row in rows]
    if not configs:
        raise StudioError(404, f"Model is not configured: {model}")
    return configs


def model_route_configs(model: str, capability: str | None = None) -> list[dict[str, Any]]:
    rows = model_config_rows(model, capability)
    owner = next((row for row in rows if int(row.get("failover_enabled") or 0) and safe_json_int_list(row.get("failover_route_model_ids"))), rows[0])
    if not int(owner.get("failover_enabled") or 0):
        return [owner]
    route_ids = safe_json_int_list(owner.get("failover_route_model_ids"))
    if not route_ids:
        return [owner]
    placeholders = ",".join("?" for _ in route_ids)
    with db() as conn:
        route_rows = conn.execute(
            f"""
            select m.*, p.name provider_name, p.base_url, p.api_key, p.api_format, p.protocol_template,
                p.is_async, p.create_path, p.poll_path_template, p.content_path_template, p.task_id_field,
                p.status_field, p.result_url_field, p.completed_statuses, p.failed_statuses, p.download_result,
                p.auth_mode, p.auth_header_name, p.auth_query_name, p.extra_headers
            from studio_model_catalog m
            join studio_provider_configs p on p.id=m.provider_id
            where m.id in ({placeholders}) and m.capability=? and m.enabled=1 and p.enabled=1
            """,
            route_ids + [owner["capability"]],
        ).fetchall()
    by_id = {int(row["id"]): dict(row) for row in route_rows}
    routes = [by_id[route_id] for route_id in route_ids if route_id in by_id]
    return routes or [owner]


def model_config(model: str, capability: str | None = None) -> dict[str, Any]:
    return model_route_configs(model, capability)[0]


def infer_capability(path: str, payload: dict[str, Any]) -> str:
    if "/images/" in path:
        return "image"
    if "/videos" in path:
        return "video"
    if "/audio/" in path:
        return "audio"
    return "text"


def charge_count(capability: str, payload: dict[str, Any]) -> int:
    if capability == "image":
        return max(1, min(20, int(float(payload.get("n") or 1))))
    if capability == "video":
        return max(1, min(3600, int(float(payload.get("seconds") or payload.get("duration") or payload.get("duration_seconds") or 1) + 0.999999)))
    return 1


def pricing_rules(config: dict[str, Any]) -> dict[str, Any]:
    return safe_json_object(config.get("pricing_rules") or config.get("pricingRules") or "{}")


def pricing_option_cost(options: dict[str, Any], key: str, fallback: float, strict: bool = True) -> float | None:
    option = options.get(key)
    if option is None and key.endswith("p"):
        option = options.get(key[:-1])
    if option is None:
        return None
    if isinstance(option, (int, float)):
        return float(option)
    if not isinstance(option, dict):
        return fallback
    if strict and option.get("enabled") is False:
        raise StudioError(400, f"This model does not support the selected option: {key}")
    return float(option.get("credits", fallback) or 0)


def normalize_image_quality(value: Any) -> str:
    normalized = str(value or "auto").strip().lower()
    aliases = {"auto": "medium", "standard": "medium", "normal": "medium", "mid": "medium", "middle": "medium", "high": "high", "hd": "high", "low": "low", "medium": "medium"}
    return aliases.get(normalized, "medium")


def normalize_image_size_tier(value: Any) -> str:
    raw = str(value or "auto").strip().lower()
    if raw in {"auto", "", "medium", "2k"}:
        return "2k"
    if raw in {"1k", "1024"}:
        return "1k"
    if raw in {"4k", "4096", "3840"}:
        return "4k"
    match = re.match(r"^(\d+)\s*x\s*(\d+)$", raw)
    if match:
        long_side = max(int(match.group(1)), int(match.group(2)))
        if long_side <= 1280:
            return "1k"
        if long_side <= 2304:
            return "2k"
        return "4k"
    if "-4k" in raw:
        return "4k"
    if "-2k" in raw:
        return "2k"
    return "1k"


def normalize_video_resolution(value: Any) -> str:
    raw = str(value or "720").strip().lower()
    aliases = {
        "auto": "720p",
        "medium": "720p",
        "high": "720p",
        "low": "480p",
        "480": "480p",
        "480p": "480p",
        "720": "720p",
        "720p": "720p",
        "1080": "1080p",
        "1080p": "1080p",
        "4k": "4k",
        "2160": "4k",
        "2160p": "4k",
    }
    return aliases.get(raw, "720p")


def resolve_unit_price(config: dict[str, Any], capability: str, payload: dict[str, Any]) -> float:
    fallback = float(config.get("credit_cost") or 0)
    rules = pricing_rules(config)
    if capability == "image":
        image_rules = safe_json_object(rules.get("image"))
        quality_rules = safe_json_object(image_rules.get("quality"))
        size_rules = safe_json_object(image_rules.get("size"))
        if not quality_rules and not size_rules:
            return fallback
        quality = normalize_image_quality(payload.get("quality"))
        size_tier = normalize_image_size_tier(payload.get("size"))
        quality_cost = pricing_option_cost(quality_rules, quality, fallback, strict=True)
        size_cost = pricing_option_cost(size_rules, size_tier, 0, strict=True)
        if quality_cost is None and size_cost is None:
            return fallback
        return float(quality_cost or 0) + float(size_cost or 0)
    if capability == "video":
        video_rules = safe_json_object(rules.get("video"))
        resolution_rules = safe_json_object(video_rules.get("resolution"))
        if not resolution_rules:
            return fallback
        resolution = normalize_video_resolution(payload.get("resolution_name") or payload.get("resolution") or payload.get("vquality") or payload.get("quality"))
        resolution_cost = pricing_option_cost(resolution_rules, resolution, fallback, strict=True)
        return fallback if resolution_cost is None else resolution_cost
    return fallback


def balance_delta_for_credits(credits: float, source: str | None = None) -> float:
    return source_balance_from_points(credits, source)


def refresh_session_balance(session: dict[str, Any]) -> float:
    if session["source"] == "studio" and session.get("role") == "studio_admin":
        return source_balance_from_points(STUDIO_ADMIN_TEST_POINTS, "studio")
    if session["source"] == "mtline":
        if not MTLINE_BILLING_SECRET:
            raise StudioError(501, "Mtline balance settlement bridge is not configured")
        data = http_json(
            "GET",
            f"{MTLINE_BILLING_BASE}/balance?user_id={urllib.parse.quote(str(session['user_id']))}",
            headers={"X-Studio-Mtline-Secret": MTLINE_BILLING_SECRET},
        )
        balance = float(data.get("quota") or 0)
    elif session["source"] == "massmore":
        if not MASSMORE_MANAGED_SECRET:
            return float(session.get("balance") or 0)
        data = http_json(
            "GET",
            f"{MASSMORE_BRIDGE}/managed/billing/linkfoai-balance?massmore_user_id={urllib.parse.quote(str(session['user_id']))}",
            headers={"X-LinkfoAI-Managed-Secret": MASSMORE_MANAGED_SECRET},
        )
        balance = float(data.get("balance") or 0)
    else:
        return float(session.get("balance") or 0)
    with db() as conn:
        conn.execute(
            "update studio_sessions set balance=?, points=?, updated_at=? where token=?",
            (balance, studio_points_from_balance(balance, session["source"]), now(), session["token"]),
        )
    session["balance"] = balance
    session["points"] = studio_points_from_balance(balance, session["source"])
    return balance


def refresh_session_balance_safe(session: dict[str, Any]) -> None:
    try:
        refresh_session_balance(session)
    except Exception:
        pass


def apply_balance_delta(session: dict[str, Any], amount: float, kind: str, external_key: str) -> None:
    if amount <= 0:
        return
    if session["source"] == "massmore":
        if not MASSMORE_MANAGED_SECRET:
            raise StudioError(501, "MassMore balance settlement secret is not configured")
        payload = {
            "external_key": external_key,
            "kind": "usage" if kind == "debit" else "refund",
            "massmore_user_id": session["user_id"],
            "linkfoai_user_id": int(float(session["user_id"])),
            "amount": amount,
        }
        http_json("POST", f"{MASSMORE_BRIDGE}/managed/billing/linkfoai-balance-delta", payload, {"X-LinkfoAI-Managed-Secret": MASSMORE_MANAGED_SECRET})
        refresh_session_balance_safe(session)
        return
    if session["source"] == "mtline":
        if not MTLINE_BILLING_SECRET:
            raise StudioError(501, "Mtline balance settlement bridge is not configured")
        data = http_json(
            "POST",
            f"{MTLINE_BILLING_BASE}/delta",
            {
                "external_key": external_key,
                "kind": "debit" if kind == "debit" else "refund",
                "user_id": session["user_id"],
                "amount": amount,
            },
            {"X-Studio-Mtline-Secret": MTLINE_BILLING_SECRET},
        )
        balance = float(data.get("quota") or 0)
        session["balance"] = balance
        session["points"] = studio_points_from_balance(balance, session["source"])
        with db() as conn:
            conn.execute(
                "update studio_sessions set balance=?, points=?, updated_at=? where token=?",
                (session["balance"], session["points"], now(), session.get("token") or ""),
            )
        return
    if session["source"] == "studio" and session.get("role") == "studio_admin":
        return
    raise StudioError(400, "This account source cannot be billed")


def usage_provider_fields(config: dict[str, Any] | None = None) -> tuple[int, str]:
    if not config:
        return 0, ""
    try:
        provider_id = int(config.get("provider_id") or 0)
    except (TypeError, ValueError):
        provider_id = 0
    return provider_id, str(config.get("provider_name") or "").strip()


def update_usage_provider(external_key: str, config: dict[str, Any] | None) -> None:
    if not external_key:
        return
    provider_id, provider_name = usage_provider_fields(config)
    with db() as conn:
        conn.execute(
            "update studio_usage_ledger set provider_id=?,provider_name=?,updated_at=? where external_key=?",
            (provider_id, provider_name, now(), external_key),
        )


def create_usage(session: dict[str, Any], model: str, capability: str, unit_price: float, unit_count: int, path: str, provider_config: dict[str, Any] | None = None) -> tuple[str, float]:
    external_key = "studio_" + secrets.token_hex(18)
    credits = unit_price * unit_count
    delta = balance_delta_for_credits(credits, session["source"])
    provider_id, provider_name = usage_provider_fields(provider_config)
    if delta > 0 and refresh_session_balance(session) + 1e-12 < delta:
        raise StudioError(402, "Studio points are insufficient, please recharge first")
    with db() as conn:
        conn.execute(
            """
            insert into studio_usage_ledger
                (external_key,session_token,source,user_id,model,provider_id,provider_name,capability,credits,balance_delta,unit_price,unit_count,success_count,failed_count,elapsed_ms,username,email,status,request_path,created_at,updated_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                external_key,
                session["token"],
                session["source"],
                session["user_id"],
                model,
                provider_id,
                provider_name,
                capability,
                credits,
                delta,
                unit_price,
                unit_count,
                0,
                0,
                0,
                session.get("username") or "",
                session.get("email") or "",
                "pending",
                path,
                now(),
                now(),
            ),
        )
    apply_balance_delta(session, delta, "debit", external_key)
    with db() as conn:
        conn.execute("update studio_usage_ledger set status='charged', updated_at=? where external_key=?", (now(), external_key))
    return external_key, delta


def refund_usage_delta(session: dict[str, Any], external_key: str, credits: float, reason: str, refund_scope: str = "") -> None:
    if credits <= 0:
        return
    ts = now()
    scope = refund_scope.strip() or hashlib.sha256(redact_error_message(reason).encode()).hexdigest()[:20]
    refund_key = f"{external_key}_refund_{hashlib.sha256(scope.encode()).hexdigest()[:20]}"
    with db() as conn:
        conn.execute("begin immediate")
        existing = conn.execute("select status from studio_refund_ledger where refund_key=?", (refund_key,)).fetchone()
        if existing and existing["status"] in {"processing", "completed"}:
            return
        usage = conn.execute("select credits from studio_usage_ledger where external_key=?", (external_key,)).fetchone()
        if not usage:
            raise StudioError(404, "usage record was not found for refund")
        refunded = conn.execute(
            "select coalesce(sum(credits),0) total from studio_refund_ledger where external_key=? and status in ('processing','completed')",
            (external_key,),
        ).fetchone()
        available = max(0.0, float(usage["credits"] or 0) - float(refunded["total"] or 0))
        refund_credits = min(float(credits), available)
        if refund_credits <= 1e-12:
            return
        refund_delta = balance_delta_for_credits(refund_credits, session["source"])
        conn.execute(
            """
            insert into studio_refund_ledger(refund_key,external_key,credits,balance_delta,status,reason,error,created_at,updated_at)
            values(?,?,?,?,? ,?,'',?,?)
            on conflict(refund_key) do update set status='processing',reason=excluded.reason,error='',updated_at=excluded.updated_at
            """,
            (refund_key, external_key, refund_credits, refund_delta, "processing", redact_error_message(reason), ts, ts),
        )
    try:
        apply_balance_delta(session, refund_delta, "refund", refund_key)
    except Exception as exc:
        with db() as conn:
            conn.execute(
                "update studio_refund_ledger set status='failed',error=?,updated_at=? where refund_key=?",
                (redact_error_message(exc), now(), refund_key),
            )
        raise
    with db() as conn:
        conn.execute(
            "update studio_refund_ledger set status='completed',error='',updated_at=? where refund_key=?",
            (now(), refund_key),
        )


def admin_refund_usage(admin_session: dict[str, Any], external_key: str) -> float:
    with db() as conn:
        row = conn.execute("select * from studio_usage_ledger where external_key=?", (external_key,)).fetchone()
        usage = row_dict(row)
        if not usage:
            raise StudioError(404, "usage record was not found")
        credits = float(usage.get("credits") or 0)
        if usage.get("source") not in {"massmore", "mtline"}:
            raise StudioError(400, "automatic refund is available for MassMore and Mtline accounts only")
        if credits <= 0 or float(usage.get("balance_delta") or 0) <= 0:
            raise StudioError(400, "this usage record has no refundable credits")
        if usage.get("admin_refund_status") in {"processing", "completed"} or float(usage.get("admin_refund_credits") or 0) > 0:
            raise StudioError(409, "this usage record has already been refunded or is being processed")
        reserved = conn.execute(
            "update studio_usage_ledger set admin_refund_status='processing', updated_at=? where external_key=? and admin_refund_status='' and admin_refund_credits=0",
            (now(), external_key),
        )
        if not reserved.rowcount:
            raise StudioError(409, "this usage record is already being processed")
    customer_session = {
        "token": "",
        "source": usage["source"],
        "user_id": usage["user_id"],
        "role": "user",
        "balance": 0,
        "points": 0,
    }
    try:
        apply_balance_delta(customer_session, balance_delta_for_credits(credits, usage["source"]), "refund", f"{external_key}_admin_refund")
    except Exception:
        with db() as conn:
            conn.execute("update studio_usage_ledger set admin_refund_status='', updated_at=? where external_key=? and admin_refund_status='processing'", (now(), external_key))
        raise
    with db() as conn:
        conn.execute(
            "update studio_usage_ledger set admin_refund_status='completed', admin_refund_credits=?, admin_refunded_at=?, report_status='resolved', status='admin_refunded', updated_at=? where external_key=?",
            (credits, now(), now(), external_key),
        )
    admin_audit(admin_session["username"], "usage.admin_refund", {"external_key": external_key, "credits": credits})
    return credits


def mark_usage(external_key: str, status: str, error: str = "", *, success_count: int | None = None, failed_count: int | None = None, elapsed_ms: int | None = None, credits: float | None = None, balance_delta: float | None = None) -> None:
    fields: dict[str, Any] = {"status": status, "error": error[:1000], "updated_at": now()}
    if status == "success" and success_count is None:
        with db() as conn:
            row = conn.execute("select unit_count from studio_usage_ledger where external_key=?", (external_key,)).fetchone()
        if row:
            success_count = int(row["unit_count"] or 1)
    if success_count is not None:
        fields["success_count"] = success_count
    if failed_count is not None:
        fields["failed_count"] = failed_count
    if elapsed_ms is not None:
        fields["elapsed_ms"] = elapsed_ms
    if credits is not None:
        fields["credits"] = credits
    if balance_delta is not None:
        fields["balance_delta"] = balance_delta
    sets = ",".join(f"{key}=?" for key in fields)
    with db() as conn:
        conn.execute(f"update studio_usage_ledger set {sets} where external_key=?", list(fields.values()) + [external_key])


def list_usage(query: dict[str, list[str]], session: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    def value(name: str) -> str:
        return str((query.get(name) or [""])[0]).strip()

    clauses: list[str] = []
    params: list[Any] = []
    if session is not None:
        clauses.extend(["source=?", "user_id=?"])
        params.extend([session["source"], session["user_id"]])
    source = value("source")
    user = value("user")
    model = value("model")
    provider = value("provider")
    capability = value("capability")
    status = value("status")
    start_at = value("from")
    end_at = value("to")
    if source:
        clauses.append("source=?")
        params.append(source)
    if user:
        clauses.append("(username like ? or email like ? or user_id like ?)")
        needle = f"%{user}%"
        params.extend([needle, needle, needle])
    if model:
        clauses.append("model=?")
        params.append(model)
    if provider:
        clauses.append("provider_name=?")
        params.append(provider)
    if capability:
        clauses.append("capability=?")
        params.append(capability)
    if status:
        clauses.append("status=?")
        params.append(status)
    if start_at:
        try:
            clauses.append("created_at>=?")
            params.append(int(float(start_at)))
        except ValueError:
            pass
    if end_at:
        try:
            clauses.append("created_at<=?")
            params.append(int(float(end_at)))
        except ValueError:
            pass
    try:
        limit = max(1, min(500, int(value("limit") or 100)))
    except ValueError:
        limit = 100
    where = f"where {' and '.join(clauses)}" if clauses else ""
    with db() as conn:
        rows = conn.execute(
            f"select * from studio_usage_ledger {where} order by id desc limit ?",
            params + [limit],
        ).fetchall()
    return [dict(row) for row in rows]


def successful_image_count_from_payload(payload: Any) -> int:
    return len(image_items_from_payload(payload))


def provider_extra_headers(config: dict[str, Any]) -> dict[str, str]:
    raw = config.get("extra_headers") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except json.JSONDecodeError:
            raw = {}
    if not isinstance(raw, dict):
        return {}
    return {str(key): str(value) for key, value in raw.items() if value is not None}


def validate_provider_base_url(value: Any) -> str:
    base = str(value or "").strip().rstrip("/")
    parsed = urllib.parse.urlparse(base)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"https", "http"} or not hostname or parsed.username or parsed.password:
        raise StudioError(400, "Provider base URL must be an absolute HTTPS URL")
    if parsed.scheme == "http" and hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise StudioError(400, "Provider base URL must use HTTPS")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved) and hostname not in {"127.0.0.1", "::1"}:
        raise StudioError(400, "Provider base URL cannot target a private network address")
    return base


def provider_base_host(config: dict[str, Any]) -> str:
    return (urllib.parse.urlparse(str(config.get("base_url") or "")).hostname or "").lower().rstrip(".")


def target_host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().rstrip(".")


def provider_result_headers(config: dict[str, Any], target_url: str) -> dict[str, str]:
    # Providers may return a signed object URL on another host. Never forward the
    # provider secret to that URL; only the provider's own host receives auth.
    if target_host(target_url) != provider_base_host(config):
        return {}
    return proxy_auth_headers(config, target_url)


def mtline_internal_origin_token() -> str:
    if MTLINE_INTERNAL_ORIGIN_TOKEN:
        return MTLINE_INTERNAL_ORIGIN_TOKEN
    if not MTLINE_INTERNAL_ORIGIN_TOKEN_FILE:
        return ""
    try:
        return Path(MTLINE_INTERNAL_ORIGIN_TOKEN_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def internal_origin_headers(target_url: str | None) -> dict[str, str]:
    if not target_url or not MTLINE_INTERNAL_API_BASE:
        return {}
    target_host = (urllib.parse.urlparse(target_url).hostname or "").lower()
    origin_host = (urllib.parse.urlparse(MTLINE_INTERNAL_API_BASE).hostname or "").lower()
    if not target_host or target_host != origin_host:
        return {}
    token = mtline_internal_origin_token()
    if not token:
        raise StudioError(503, "Mtline direct-origin token is not configured")
    return {MTLINE_INTERNAL_ORIGIN_HEADER: token}


def provider_auth_headers(config: dict[str, Any], target_url: str | None = None) -> dict[str, str]:
    headers = provider_extra_headers(config)
    headers.update(internal_origin_headers(target_url))
    api_key = str(config.get("api_key") or "")
    if not api_key:
        return headers
    auth_mode = str(config.get("auth_mode") or "bearer").strip().lower()
    header_name = str(config.get("auth_header_name") or "Authorization").strip() or "Authorization"
    if auth_mode == "header":
        headers[header_name] = api_key
    elif auth_mode == "bearer":
        headers[header_name] = f"Bearer {api_key}"
    return headers


def with_provider_query_auth(url: str, config: dict[str, Any]) -> str:
    api_key = str(config.get("api_key") or "")
    auth_mode = str(config.get("auth_mode") or "bearer").strip().lower()
    if auth_mode != "query" or not api_key:
        return url
    query_name = str(config.get("auth_query_name") or "key").strip() or "key"
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append((query_name, api_key))
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))


def provider_api_base_url(config: dict[str, Any]) -> str:
    base = validate_provider_base_url(config["base_url"])
    hostname = (urllib.parse.urlparse(base).hostname or "").lower()
    if MASSMORE_INTERNAL_API_BASE and hostname in {"massmore.org", "www.massmore.org"}:
        base = MASSMORE_INTERNAL_API_BASE
    elif MTLINE_INTERNAL_API_BASE and hostname in {"mtline.cc", "www.mtline.cc", "api.mtline.cc", "claw.mtline.cc"}:
        base = MTLINE_INTERNAL_API_BASE
    if not base.endswith("/v1"):
        base += "/v1"
    return base


def acquire_upstream_slot(config: dict[str, Any], capability: str, session: dict[str, Any] | None = None) -> threading.BoundedSemaphore | None:
    if capability != "image" or IMAGE_UPSTREAM_CONCURRENCY == 0:
        return None
    provider_key = str(config.get("provider_id") or config.get("provider_name") or config.get("base_url") or "image")
    user_key = f"{session.get('source')}:{session.get('user_id')}" if session else "legacy"
    key = f"{provider_key}:{user_key}"
    with _IMAGE_UPSTREAM_SLOTS_LOCK:
        slot = _IMAGE_UPSTREAM_SLOTS.get(key)
        if slot is None:
            slot = threading.BoundedSemaphore(IMAGE_UPSTREAM_CONCURRENCY)
            _IMAGE_UPSTREAM_SLOTS[key] = slot
    if not slot.acquire(timeout=IMAGE_UPSTREAM_QUEUE_TIMEOUT):
        raise StudioError(429, "Image provider is busy. Please retry shortly.")
    return slot


def proxy_headers(config: dict[str, Any], content_type: str = "application/json", target_url: str | None = None) -> dict[str, str]:
    headers = provider_auth_headers(config, target_url)
    headers["Content-Type"] = content_type
    return headers


def proxy_auth_headers(config: dict[str, Any], target_url: str | None = None) -> dict[str, str]:
    return provider_auth_headers(config, target_url)


def build_upstream_url(config: dict[str, Any], path: str) -> str:
    if str(path or "").startswith(("http://", "https://")):
        absolute = validate_provider_base_url(str(path))
        if target_host(absolute) != provider_base_host(config):
            raise StudioError(400, "Provider path must stay on the configured provider host")
        return with_provider_query_auth(absolute, config)
    return with_provider_query_auth(provider_api_base_url(config) + path, config)


def is_failover_retryable(exc: Exception) -> bool:
    if isinstance(exc, StudioError):
        return exc.status in {408, 425, 429, 500, 502, 503, 504, 521, 522, 523, 524}
    return isinstance(exc, (requests.RequestException, TimeoutError, OSError))


def upstream_request_with_failover(
    model: str,
    capability: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    files: list[tuple[str, tuple[str, bytes, str]]] | None = None,
    timeout: int = REQUEST_TIMEOUT,
    require_image_result: bool = False,
    preview_callback: Callable[[list[str]], None] | None = None,
) -> tuple[Any, dict[str, Any]]:
    last_error: Exception | None = None
    routes = model_route_configs(model, capability)
    for index, config in enumerate(routes):
        upstream_url = build_upstream_url(config, path)
        route_payload = dict(payload or {})
        route_payload["model"] = str(config.get("model") or model)
        try:
            if files is not None:
                upstream = requests.request(
                    method,
                    upstream_url,
                    data=route_payload,
                    files=files,
                    headers=proxy_auth_headers(config, upstream_url),
                    timeout=timeout,
                    stream=preview_callback is not None,
                )
            else:
                upstream = requests.request(
                    method,
                    upstream_url,
                    json=route_payload,
                    headers=proxy_headers(config, target_url=upstream_url),
                    timeout=timeout,
                    stream=preview_callback is not None,
                )
            if upstream.status_code >= 400:
                raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
            if preview_callback is not None:
                consume_streamed_image_response(upstream, preview_callback)
            if require_image_result:
                _, _, _, success_count = normalized_image_response(upstream)
                if success_count <= 0:
                    raise StudioError(502, "Image provider returned no usable images")
            return upstream, config
        except Exception as exc:
            last_error = exc
            if index + 1 >= len(routes) or not is_failover_retryable(exc):
                raise
    if last_error:
        raise last_error
    raise StudioError(404, f"Model is not configured: {model}")


def resolve_result_url(config: dict[str, Any], result_url: str) -> str:
    target = str(result_url or "").strip()
    if not target:
        return ""
    if target.startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme != "https" or not parsed.hostname:
            raise StudioError(502, "Provider returned an unsafe result URL")
        return with_provider_query_auth(target, config) if target_host(target) == provider_base_host(config) else target
    return with_provider_query_auth(urllib.parse.urljoin(provider_api_base_url(config) + "/", target), config)


def remember_video_task(task_id: str, session: dict[str, Any], config: dict[str, Any], model: str, path: str, usage_key: str = "") -> None:
    if not task_id:
        return
    with db() as conn:
        conn.execute(
            """
            insert or replace into studio_video_tasks
                (task_id,session_token,model,capability,create_path,provider_id,usage_key,created_at,updated_at)
            values (?,?,?,?,?,?,?,?,?)
            """,
            (task_id, session["token"], model, "video", path, config["provider_id"], usage_key, now(), now()),
        )


def video_task_record(session: dict[str, Any], task_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select * from studio_video_tasks where task_id=? and session_token=?", (task_id, session["token"])).fetchone()
    task = row_dict(row)
    if not task:
        raise StudioError(404, "Video task is not registered in Studio")
    return task


def extract_task_id(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    candidates: list[dict[str, Any]] = [payload]
    data = payload.get("data")
    if isinstance(data, dict):
        candidates.append(data)
    if isinstance(data, list):
        candidates.extend([item for item in data if isinstance(item, dict)])
    for item in candidates:
        for key in ("id", "task_id", "video_id"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def video_task_config(session: dict[str, Any], task_id: str) -> dict[str, Any]:
    task = video_task_record(session, task_id)
    config = model_config(task["model"], "video")
    config["video_task"] = task
    return config


def task_id_from_path(path: str) -> str:
    parts = [item for item in path.strip("/").split("/") if item]
    if len(parts) >= 2 and parts[0] == "videos":
        return urllib.parse.unquote(parts[1])
    if len(parts) >= 4 and parts[:3] == ["contents", "generations", "tasks"]:
        return urllib.parse.unquote(parts[3])
    return ""


def video_result_url_from_payload(payload: Any) -> str:
    candidates: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        candidates.append(payload)
        data = payload.get("data")
        if isinstance(data, dict):
            candidates.append(data)
        elif isinstance(data, list):
            candidates.extend(item for item in data if isinstance(item, dict))
    for candidate in candidates:
        for key in ("video_url", "url"):
            value = candidate.get(key)
            if isinstance(value, str) and value.startswith(("https://", "http://")):
                return value
    return ""


def video_result_local_path(task_id: str) -> Path:
    key = video_result_r2_key(task_id).rsplit("/", 1)[-1]
    path = (generation_jobs_root() / key).resolve()
    if path.parent != generation_jobs_root():
        raise StudioError(400, "Invalid video result path")
    return path


def render_task_path(template: str, task_id: str) -> str:
    return str(template or "").replace("{task_id}", urllib.parse.quote(task_id, safe=""))


def admin_audit(actor: str, action: str, payload: Any) -> None:
    with db() as conn:
        conn.execute("insert into studio_audit_log(actor,action,payload,created_at) values(?,?,?,?)", (actor, action, json.dumps(payload, ensure_ascii=False), now()))


class Handler(BaseHTTPRequestHandler):
    server_version = "StudioManagedBackend/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def auth_rate_key(self, path: str, payload: dict[str, Any]) -> str:
        forwarded = str(self.headers.get("X-Forwarded-For") or "").split(",", 1)[0].strip()
        remote = forwarded or str(self.headers.get("X-Real-IP") or "").strip() or str(self.client_address[0])
        username = str(payload.get("username") or payload.get("email") or payload.get("pendingToken") or "").strip().lower()[:160]
        return f"{remote}:{path}:{username}"

    def send_security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")

    def require_same_origin(self) -> None:
        origin = str(self.headers.get("Origin") or "").strip()
        fetch_site = str(self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if fetch_site == "cross-site":
            raise StudioError(403, "Cross-site request was rejected")
        if not origin:
            if fetch_site == "same-site":
                raise StudioError(403, "Same-site cross-origin request was rejected")
            return
        parsed = urllib.parse.urlparse(origin)
        forwarded_host = str(self.headers.get("X-Forwarded-Host") or "").split(",", 1)[0].strip()
        expected_host = (forwarded_host or str(self.headers.get("Host") or "").strip()).lower()
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.netloc.lower() != expected_host:
            raise StudioError(403, "Request origin does not match Studio")

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError as exc:
            raise StudioError(400, "Invalid Content-Length") from exc
        if length <= 0:
            return {}
        if length > MAX_JSON_BODY_BYTES:
            raise StudioError(413, "JSON request body is too large")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StudioError(400, "Invalid JSON request body") from exc
        if not isinstance(payload, dict):
            raise StudioError(400, "JSON request body must be an object")
        return payload

    def read_multipart(self) -> tuple[dict[str, Any], list[tuple[str, tuple[str, bytes, str]]]]:
        if cgi is None:
            raise StudioError(501, "multipart form handling is unavailable in this Python runtime")
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError as exc:
            raise StudioError(400, "Invalid Content-Length") from exc
        if length <= 0 or length > MAX_MULTIPART_BODY_BYTES:
            raise StudioError(413, "Multipart request body is too large")
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST"})
        fields: dict[str, Any] = {}
        files: list[tuple[str, tuple[str, bytes, str]]] = []
        field_count = 0
        for key in form.keys():
            item = form[key]
            items = item if isinstance(item, list) else [item]
            values: list[str] = []
            for entry in items:
                if entry.filename:
                    if len(files) >= MAX_MULTIPART_FILES:
                        raise StudioError(413, f"Too many uploaded files; maximum is {MAX_MULTIPART_FILES}")
                    content = entry.file.read()
                    if len(content) > MAX_MULTIPART_BODY_BYTES:
                        raise StudioError(413, "Uploaded file is too large")
                    filename = re.sub(r"[\r\n\x00-\x1f]", "_", Path(str(entry.filename)).name)[:255] or "upload.bin"
                    files.append((str(key)[:120], (filename, content, entry.type or "application/octet-stream")))
                else:
                    field_count += 1
                    if field_count > MAX_MULTIPART_FIELDS:
                        raise StudioError(413, f"Too many multipart fields; maximum is {MAX_MULTIPART_FIELDS}")
                    values.append(entry.value)
            if values:
                fields[str(key)[:120]] = values if len(values) > 1 else values[0]
        return fields, files

    def send_json(self, status: int, payload: dict[str, Any], cookies: list[str] | None = None) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_error_json(self, exc: Exception) -> None:
        if isinstance(exc, StudioError):
            self.send_json(exc.status, {"success": False, "message": redact_error_message(exc.message)})
        else:
            self.log_error("Unhandled Studio error: %s", redact_error_message(exc))
            self.send_json(500, {"success": False, "message": "Studio internal error"})

    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path in {"/health", "/studio-api/health"}:
                self.send_json(200, {"success": True, "service": self.server_version})
                return
            if path == "/studio-api/auth/self":
                session = current_session(self.headers)
                refresh_session_balance_safe(session)
                self.send_json(200, self_payload(session))
                return
            if path == "/studio-api/account/balance":
                session = current_session(self.headers)
                refresh_session_balance_safe(session)
                self.send_json(200, self_payload(session))
                return
            if path == "/studio-api/account/recharge-url":
                session = current_session(self.headers)
                self.send_json(200, {"success": True, "url": recharge_url(session["source"])})
                return
            if path == "/studio-api/catalog/models":
                current_session(self.headers)
                self.send_json(200, {"success": True, "models": list_models(True)})
                return
            if path == "/studio-api/storage/config":
                self.send_json(200, {"success": True, "storage": public_storage_settings()})
                return
            if path == "/studio-api/workflows":
                session = current_session(self.headers)
                self.send_json(200, {"success": True, "workflows": list_workflows(session)})
                return
            if path == "/studio-api/v1/models":
                current_session(self.headers)
                self.send_json(200, {"object": "list", "data": [{"id": item["model"], "object": "model", **item} for item in list_models(True)]})
                return
            if path == "/studio-api/usage":
                session = current_session(self.headers)
                self.handle_user_usage(session, urllib.parse.parse_qs(parsed.query))
                return
            file_match = re.fullmatch(r"/studio-api/files/(obj_[a-f0-9]{32})(?:/(content|info))?", path)
            if file_match:
                session = current_session(self.headers)
                record = storage_object_for_session(file_match.group(1), session)
                if file_match.group(2) == "content":
                    raw_provider = safe_json_object(record.get("provider_json") or "{}")
                    if raw_provider.get("direct") is True:
                        raise StudioError(409, "This object requires the owner's direct WebDAV connection")
                    body = read_storage_object(record)
                    self.send_response(200)
                    self.send_header("Content-Type", str(record.get("mime_type") or "application/octet-stream"))
                    self.send_header("Cache-Control", "private, no-store")
                    self.send_security_headers()
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    try:
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                else:
                    self.send_json(200, {"success": True, "file": {
                        "id": record["id"],
                        "storageKey": f"server:{record['id']}",
                        "url": f"/studio-api/files/{record['id']}/content",
                        "objectKey": record["object_key"],
                        "direct": bool(safe_json_object(record.get("provider_json") or "{}").get("direct") is True),
                        "mimeType": record.get("mime_type") or "application/octet-stream",
                        "bytes": int(record.get("bytes") or 0),
                    }})
                return
            if path == "/studio-api/jobs":
                self.handle_generation_jobs(current_session(self.headers), urllib.parse.parse_qs(parsed.query))
                return
            job_match = re.fullmatch(r"/studio-api/jobs/(job_[a-f0-9]{32})(/result)?", path)
            if job_match:
                session = current_session(self.headers)
                job = generation_job_for_session(job_match.group(1), session)
                if job_match.group(2):
                    self.handle_generation_job_result(job)
                else:
                    self.send_json(200, {"success": True, "job": public_generation_job(job)})
                return
            if path.startswith("/studio-api/admin/"):
                self.handle_admin_get(path, urllib.parse.parse_qs(parsed.query))
                return
            if path.startswith("/studio-api/v1/"):
                self.handle_proxy("GET", path.removeprefix("/studio-api/v1"), None)
                return
            self.send_json(404, {"success": False, "message": "not found"})
        except Exception as exc:
            self.send_error_json(exc)

    def do_POST(self) -> None:  # noqa: N802
        auth_key = ""
        try:
            self.require_same_origin()
            path = urllib.parse.urlparse(self.path).path
            is_multipart = (self.headers.get("Content-Type") or "").lower().startswith("multipart/form-data")
            payload = {} if is_multipart else self.read_json()
            if path in {
                "/studio-api/auth/massmore/login",
                "/studio-api/auth/mtline/login",
                "/studio-api/auth/mtline/login/2fa",
                "/studio-api/admin/login",
            }:
                auth_key = self.auth_rate_key(path, payload)
                auth_rate_check(auth_key)
            if path == "/studio-api/auth/massmore/login":
                data, token = massmore_login(payload)
                auth_rate_success(auth_key)
                self.send_json(200, data, [response_cookie(token)])
                return
            if path == "/studio-api/auth/mtline/login":
                data, token = mtline_login(payload)
                auth_rate_success(auth_key)
                self.send_json(200, data, [response_cookie(token)] if token else None)
                return
            if path == "/studio-api/auth/mtline/login/2fa":
                data, token = mtline_login_2fa(payload)
                auth_rate_success(auth_key)
                self.send_json(200, data, [response_cookie(token)])
                return
            if path == "/studio-api/admin/login":
                data, token = admin_login(payload)
                auth_rate_success(auth_key)
                self.send_json(200, data, [response_cookie(token)])
                return
            if path == "/studio-api/auth/logout":
                revoke_session(self.headers)
                self.send_json(200, {"success": True}, [clear_cookie()])
                return
            if path == "/studio-api/files":
                session = current_session(self.headers)
                if not is_multipart:
                    raise StudioError(415, "Storage uploads require multipart/form-data")
                fields, files = self.read_multipart()
                if len(files) != 1:
                    raise StudioError(400, "Upload exactly one file")
                _, (filename, content, content_type) = files[0]
                raw_provider = safe_json_object(fields.get("provider") or {})
                provider, user_owned = storage_provider_for_upload(session, raw_provider)
                result = store_uploaded_object(session, provider, user_owned, filename, content, content_type)
                self.send_json(200, {"success": True, "file": result})
                return
            if path == "/studio-api/files/direct":
                session = current_session(self.headers)
                result = register_direct_storage_object(session, payload)
                self.send_json(200, {"success": True, "file": result})
                return
            if path == "/studio-api/usage/report":
                self.handle_usage_report(current_session(self.headers), payload)
                return
            if path == "/studio-api/generation/cancel":
                session = current_session(self.headers)
                request_id = str(payload.get("requestId") or "").strip()
                status = cancel_active_generation(session, request_id)
                self.send_json(200, {"success": True, "status": status})
                return
            internal_match = re.fullmatch(r"/studio-api/internal/jobs/(job_[a-f0-9]{32})/dispatch", path)
            if internal_match:
                body = json_bytes(payload)
                verify_async_request(self.headers, "POST", path, body)
                with db() as conn:
                    conn.execute(
                        "update studio_generation_jobs set dispatched_at=?,updated_at=? where job_id=? and status='queued'",
                        (now(), now(), internal_match.group(1)),
                    )
                record_generation_event(internal_match.group(1), "worker_dispatched")
                _JOB_WAKE_EVENT.set()
                self.send_json(202, {"success": True})
                return
            if path in {"/studio-api/jobs/image/generations", "/studio-api/jobs/image/edits"}:
                session = current_session(self.headers)
                request_path = "/images/generations" if path.endswith("/generations") else "/images/edits"
                if is_multipart:
                    fields, files = self.read_multipart()
                    idempotency_key = str(self.headers.get("Idempotency-Key") or fields.pop("idempotencyKey", "") or "").strip()
                    job = create_generation_job(session, "POST", request_path, "multipart", fields, files, idempotency_key)
                else:
                    idempotency_key = str(self.headers.get("Idempotency-Key") or payload.pop("idempotencyKey", "") or "").strip()
                    job = create_generation_job(session, "POST", request_path, "json", payload, None, idempotency_key)
                self.send_json(202, {"success": True, "job": public_generation_job(job)})
                return
            cancel_match = re.fullmatch(r"/studio-api/jobs/(job_[a-f0-9]{32})/cancel", path)
            if cancel_match:
                session = current_session(self.headers)
                job = generation_job_for_session(cancel_match.group(1), session)
                status = cancel_generation_job(job)
                self.send_json(200, {"success": True, "status": status})
                return
            generate_aliases = {
                "/studio-api/generate/text": "/chat/completions",
                "/studio-api/generate/image": "/images/generations",
                "/studio-api/generate/video": "/videos",
                "/studio-api/generate/audio": "/audio/speech",
            }
            if path in generate_aliases:
                self.handle_proxy("POST", generate_aliases[path], payload)
                return
            if path.startswith("/studio-api/admin/"):
                self.handle_admin_post(path, payload)
                return
            if path.startswith("/studio-api/v1/"):
                if is_multipart:
                    fields, files = self.read_multipart()
                    self.handle_proxy_multipart(path.removeprefix("/studio-api/v1"), fields, files)
                else:
                    self.handle_proxy("POST", path.removeprefix("/studio-api/v1"), payload)
                return
            self.send_json(404, {"success": False, "message": "not found"})
        except Exception as exc:
            if auth_key:
                auth_rate_failure(auth_key)
            self.send_error_json(exc)

    def do_PATCH(self) -> None:  # noqa: N802
        try:
            self.require_same_origin()
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/studio-api/admin/"):
                self.handle_admin_patch(path, self.read_json())
                return
            self.send_json(404, {"success": False, "message": "not found"})
        except Exception as exc:
            self.send_error_json(exc)

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            self.require_same_origin()
            path = urllib.parse.urlparse(self.path).path
            file_match = re.fullmatch(r"/studio-api/files/(obj_[a-f0-9]{32})", path)
            if file_match:
                session = current_session(self.headers)
                payload = self.read_json()
                delete_storage_object(storage_object_for_session(file_match.group(1), session), payload.get("provider") or payload)
                self.send_json(200, {"success": True})
                return
            if path.startswith("/studio-api/admin/"):
                self.handle_admin_delete(path)
                return
            self.send_json(404, {"success": False, "message": "not found"})
        except Exception as exc:
            self.send_error_json(exc)

    def handle_proxy(self, method: str, path: str, payload: dict[str, Any] | None) -> None:
        session = current_session(self.headers)
        payload = payload or {}
        model = str(payload.get("model") or "").strip()
        if method == "GET" and path.startswith("/videos/"):
            task_id = task_id_from_path(path)
            config = video_task_config(session, task_id)
            if uses_generic_async(config):
                self.handle_generic_async_poll(session, config, task_id)
                return
            if path.rstrip("/").endswith("/content"):
                self.handle_managed_video_content(session, config, task_id)
                return
            self.forward_without_charge("GET", config, path)
            return
        if method == "GET" and path.startswith("/contents/generations/tasks/"):
            task_id = task_id_from_path(path)
            config = video_task_config(session, task_id)
            if uses_generic_async(config):
                self.handle_generic_async_poll(session, config, task_id)
                return
            self.forward_without_charge("GET", config, path)
            return
        if not model:
            raise StudioError(400, "model is required")
        capability = infer_capability(path, payload)
        config = model_config(model, capability)
        count = charge_count(capability, payload)
        unit_price = resolve_unit_price(config, capability, payload)
        credits = unit_price * count
        usage_key = ""
        refunded_credits = 0.0
        request_id, cancelled = register_active_generation(self.headers, session)
        started_at = time.monotonic()
        upstream_slot = acquire_upstream_slot(config, capability, session)
        try:
            usage_key, _ = create_usage(session, model, capability, unit_price, count, path, config)
            if cancelled and cancelled.is_set():
                raise StudioError(499, "generation cancelled")
            if capability == "video" and method == "POST" and uses_generic_async(config):
                self.handle_generic_async_create(session, config, model, path, payload, usage_key)
                return
            mark_active_generation_submitted(request_id)
            upstream, selected_config = upstream_request_with_failover(
                model,
                capability,
                method,
                path,
                payload,
                timeout=REQUEST_TIMEOUT,
                require_image_result=capability == "image",
            )
            config = selected_config
            update_usage_provider(usage_key, config)
            if cancelled and cancelled.is_set():
                raise StudioError(499, "generation cancelled")
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            success_count = count
            failed_count = 0
            actual_credits = credits
            actual_delta = balance_delta_for_credits(actual_credits, session["source"])
            body = upstream.content
            content_type = upstream.headers.get("Content-Type", "application/json")
            if capability == "image":
                _, body, content_type, success_count = normalized_image_response(upstream)
                if success_count <= 0:
                    raise StudioError(502, "Image provider returned no usable images")
                failed_count = max(0, count - success_count)
                actual_credits = unit_price * success_count
                actual_delta = balance_delta_for_credits(actual_credits, session["source"])
                if failed_count and usage_key:
                    partial_refund = unit_price * failed_count
                    refund_usage_delta(session, usage_key, partial_refund, "partial image failure", "partial-image")
                    refunded_credits += partial_refund
            if usage_key:
                mark_usage(usage_key, "success", success_count=success_count, failed_count=failed_count, elapsed_ms=elapsed_ms, credits=actual_credits, balance_delta=actual_delta)
            if capability == "video" and method == "POST":
                try:
                    remember_video_task(extract_task_id(response_json(upstream)), session, config, model, path, usage_key)
                except Exception:
                    pass
            if capability != "image":
                content_type = upstream.headers.get("Content-Type", "application/json")
                body = upstream.content
            self.send_response(upstream.status_code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_security_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except Exception as exc:
            if usage_key:
                try:
                    refund_usage_delta(session, usage_key, max(0.0, credits - refunded_credits), str(exc), "terminal-failure")
                    mark_usage(usage_key, "refunded", str(exc), success_count=0, failed_count=count, elapsed_ms=int((time.monotonic() - started_at) * 1000), credits=0, balance_delta=0)
                except Exception as refund_exc:
                    mark_usage(usage_key, "refund_failed", f"{exc}; refund: {refund_exc}", elapsed_ms=int((time.monotonic() - started_at) * 1000))
            raise
        finally:
            release_active_generation(request_id)
            if upstream_slot is not None:
                upstream_slot.release()

    def handle_proxy_multipart(self, path: str, fields: dict[str, Any], files: list[tuple[str, tuple[str, bytes, str]]]) -> None:
        session = current_session(self.headers)
        model = str(fields.get("model") or "").strip()
        if not model:
            raise StudioError(400, "model is required")
        capability = infer_capability(path, fields)
        config = model_config(model, capability)
        count = charge_count(capability, fields)
        unit_price = resolve_unit_price(config, capability, fields)
        credits = unit_price * count
        usage_key = ""
        refunded_credits = 0.0
        request_id, cancelled = register_active_generation(self.headers, session)
        started_at = time.monotonic()
        upstream_slot = acquire_upstream_slot(config, capability, session)
        try:
            usage_key, _ = create_usage(session, model, capability, unit_price, count, path, config)
            if cancelled and cancelled.is_set():
                raise StudioError(499, "generation cancelled")
            if capability == "video" and uses_generic_async(config):
                self.handle_generic_async_create_multipart(session, config, model, path, fields, files, usage_key)
                return
            mark_active_generation_submitted(request_id)
            upstream, selected_config = upstream_request_with_failover(
                model,
                capability,
                "POST",
                path,
                fields,
                files=files,
                timeout=REQUEST_TIMEOUT,
                require_image_result=capability == "image",
            )
            config = selected_config
            update_usage_provider(usage_key, config)
            if cancelled and cancelled.is_set():
                raise StudioError(499, "generation cancelled")
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            success_count = count
            failed_count = 0
            actual_credits = credits
            actual_delta = balance_delta_for_credits(actual_credits, session["source"])
            if capability == "image":
                _, body, content_type, success_count = normalized_image_response(upstream)
                if success_count <= 0:
                    raise StudioError(502, "Image provider returned no usable images")
                failed_count = max(0, count - success_count)
                actual_credits = unit_price * success_count
                actual_delta = balance_delta_for_credits(actual_credits, session["source"])
                if failed_count and usage_key:
                    partial_refund = unit_price * failed_count
                    refund_usage_delta(session, usage_key, partial_refund, "partial image failure", "partial-image")
                    refunded_credits += partial_refund
            if usage_key:
                mark_usage(usage_key, "success", success_count=success_count, failed_count=failed_count, elapsed_ms=elapsed_ms, credits=actual_credits, balance_delta=actual_delta)
            if capability == "video":
                try:
                    remember_video_task(extract_task_id(response_json(upstream)), session, config, model, path, usage_key)
                except Exception:
                    pass
            self.send_response(upstream.status_code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_security_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except Exception as exc:
            if usage_key:
                try:
                    refund_usage_delta(session, usage_key, max(0.0, credits - refunded_credits), str(exc), "terminal-failure")
                    mark_usage(usage_key, "refunded", str(exc), success_count=0, failed_count=count, elapsed_ms=int((time.monotonic() - started_at) * 1000), credits=0, balance_delta=0)
                except Exception as refund_exc:
                    mark_usage(usage_key, "refund_failed", f"{exc}; refund: {refund_exc}", elapsed_ms=int((time.monotonic() - started_at) * 1000))
            raise
        finally:
            release_active_generation(request_id)
            if upstream_slot is not None:
                upstream_slot.release()

    def handle_generic_async_create(self, session: dict[str, Any], config: dict[str, Any], model: str, path: str, payload: dict[str, Any], usage_key: str) -> None:
        last_error: Exception | None = None
        selected_config = config
        create_path = str(config.get("create_path") or path).strip() or path
        upstream = None
        async_fields: dict[str, Any] = {}
        for index, route in enumerate(model_route_configs(model, "video")):
            route_path = str(route.get("create_path") or path).strip() or path
            route_url = build_upstream_url(route, route_path)
            try:
                route_payload = {**payload, "model": str(route.get("model") or model)}
                upstream = requests.request("POST", route_url, json=route_payload, headers=proxy_headers(route, target_url=route_url), timeout=REQUEST_TIMEOUT, stream=False)
                if upstream.status_code >= 400:
                    raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
                response_payload = upstream.json() if upstream.text else {}
                async_fields = extract_async_task_fields(route, response_payload)
                if not async_fields["task_id"]:
                    raise StudioError(502, f"Async provider did not return a task id: {response_payload}")
                selected_config = route
                create_path = route_path
                break
            except Exception as exc:
                last_error = exc
                if index + 1 >= len(model_route_configs(model, "video")) or not is_failover_retryable(exc):
                    raise
        if upstream is None:
            raise last_error or StudioError(502, "Async provider did not return a response")
        update_usage_provider(usage_key, selected_config)
        remember_video_task(async_fields["task_id"], session, selected_config, model, create_path, usage_key)
        if usage_key:
            mark_usage(usage_key, "success")
        body = upstream.content
        self.send_response(upstream.status_code)
        self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json"))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_generic_async_create_multipart(self, session: dict[str, Any], config: dict[str, Any], model: str, path: str, fields: dict[str, Any], files: list[tuple[str, tuple[str, bytes, str]]], usage_key: str) -> None:
        last_error: Exception | None = None
        selected_config = config
        create_path = str(config.get("create_path") or path).strip() or path
        upstream = None
        async_fields: dict[str, Any] = {}
        routes = model_route_configs(model, "video")
        for index, route in enumerate(routes):
            route_path = str(route.get("create_path") or path).strip() or path
            route_url = build_upstream_url(route, route_path)
            try:
                route_fields = {**fields, "model": str(route.get("model") or model)}
                upstream = requests.post(route_url, data=route_fields, files=files, headers=proxy_auth_headers(route, route_url), timeout=REQUEST_TIMEOUT)
                if upstream.status_code >= 400:
                    raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
                response_payload = upstream.json() if upstream.text else {}
                async_fields = extract_async_task_fields(route, response_payload)
                if not async_fields["task_id"]:
                    raise StudioError(502, f"Async provider did not return a task id: {response_payload}")
                selected_config = route
                create_path = route_path
                break
            except Exception as exc:
                last_error = exc
                if index + 1 >= len(routes) or not is_failover_retryable(exc):
                    raise
        if upstream is None:
            raise last_error or StudioError(502, "Async provider did not return a response")
        update_usage_provider(usage_key, selected_config)
        remember_video_task(async_fields["task_id"], session, selected_config, model, create_path, usage_key)
        if usage_key:
            mark_usage(usage_key, "success")
        self.forward_response(upstream)

    def handle_generic_async_poll(self, session: dict[str, Any], config: dict[str, Any], task_id: str) -> None:
        poll_path_template = str(config.get("poll_path_template") or "").strip()
        if not poll_path_template:
            raise StudioError(500, "Generic async provider is missing poll_path_template")
        upstream_url = build_upstream_url(config, render_task_path(poll_path_template, task_id))
        upstream = requests.request(
            "GET",
            upstream_url,
            headers=proxy_auth_headers(config, upstream_url),
            timeout=REQUEST_TIMEOUT,
        )
        if upstream.status_code >= 400:
            raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
        payload = upstream.json() if upstream.text else {}
        async_fields = extract_async_task_fields(config, payload)
        if async_fields["is_failed"]:
            raise StudioError(502, f"Async video task failed with status '{async_fields['status'] or 'unknown'}'")
        if not async_fields["is_completed"]:
            self.forward_response(upstream)
            return
        content_path_template = str(config.get("content_path_template") or "").strip()
        if content_path_template:
            content_url = build_upstream_url(config, render_task_path(content_path_template, task_id))
            content_upstream = requests.request(
                "GET",
                content_url,
                headers=proxy_auth_headers(config, content_url),
                timeout=REQUEST_TIMEOUT,
            )
            if content_upstream.status_code >= 400:
                raise StudioError(content_upstream.status_code, content_upstream.text[:1000] or content_upstream.reason)
            self.forward_response(content_upstream)
            return
        result_url = async_fields["result_url"]
        if not result_url:
            self.forward_response(upstream)
            return
        if not int(config.get("download_result", 1)):
            self.send_json(200, {"success": True, "task_id": task_id, "status": async_fields["status"], "url": result_url})
            return
        result_target = resolve_result_url(config, result_url)
        result_upstream = requests.request(
            "GET",
            result_target,
            headers=provider_result_headers(config, result_target),
            timeout=REQUEST_TIMEOUT,
        )
        if result_upstream.status_code >= 400:
            raise StudioError(result_upstream.status_code, result_upstream.text[:1000] or result_upstream.reason)
        self.forward_response(result_upstream)

    def handle_managed_video_content(self, session: dict[str, Any], config: dict[str, Any], task_id: str) -> None:
        """Cache a completed provider video before the browser retrieves it.

        This keeps client downloads on the Studio origin, including when a
        provider happens to return a workers.dev or other restricted URL.
        """
        task = video_task_record(session, task_id)
        r2_key = str(task.get("result_r2_key") or "")
        if r2_key:
            result_url = async_asset_download_url_for_key(video_result_r2_key(task_id, r2_key))
            with db() as conn:
                conn.execute(
                    "update studio_video_tasks set result_delivered_at=case when result_delivered_at=0 then ? else result_delivered_at end,updated_at=? where task_id=?",
                    (now(), now(), task_id),
                )
            self.send_response(302)
            self.send_header("Location", result_url)
            self.send_header("Cache-Control", "no-store")
            self.send_security_headers()
            self.end_headers()
            return

        local_result = video_result_local_path(task_id)
        if not local_result.exists():
            poll_path = f"{str(task['create_path']).rstrip('/')}/{urllib.parse.quote(task_id, safe='')}"
            poll_url = build_upstream_url(config, poll_path)
            poll = requests.get(poll_url, headers=proxy_auth_headers(config, poll_url), timeout=REQUEST_TIMEOUT)
            if poll.status_code >= 400:
                raise StudioError(poll.status_code, poll.text[:1000] or poll.reason)
            try:
                result_url = video_result_url_from_payload(poll.json() if poll.text else {})
            except ValueError as exc:
                raise StudioError(502, "Video provider returned an invalid task response") from exc
            if not result_url:
                raise StudioError(409, "Video task is not ready for download")
            target = resolve_result_url(config, result_url)
            upstream = requests.get(target, headers=provider_result_headers(config, target), timeout=REQUEST_TIMEOUT, stream=True)
            if upstream.status_code >= 400:
                raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
            try:
                with local_result.open("wb") as stream:
                    for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            stream.write(chunk)
                ensure_private_path(local_result, 0o600)
            finally:
                upstream.close()
            content_type = upstream.headers.get("Content-Type", "video/mp4")
            candidate_key = video_result_r2_key(task_id)
            try:
                response = async_worker_stream_upload(f"/assets/{candidate_key}", local_result, content_type, timeout=120)
                if response.status_code >= 400:
                    raise StudioError(response.status_code, response.text[:500] or response.reason)
                r2_key = candidate_key
            except Exception:
                r2_key = ""
            with db() as conn:
                conn.execute(
                    "update studio_video_tasks set result_file=?,result_r2_key=?,result_content_type=?,updated_at=? where task_id=?",
                    (str(local_result), r2_key, content_type, now(), task_id),
                )

        if r2_key:
            result_url = async_asset_download_url_for_key(video_result_r2_key(task_id, r2_key))
            with db() as conn:
                conn.execute(
                    "update studio_video_tasks set result_delivered_at=case when result_delivered_at=0 then ? else result_delivered_at end,updated_at=? where task_id=?",
                    (now(), now(), task_id),
                )
            self.send_response(302)
            self.send_header("Location", result_url)
            self.send_header("Cache-Control", "no-store")
            self.send_security_headers()
            self.end_headers()
            return

        # R2 is temporarily unavailable: never fall back to an external URL.
        body = local_result.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", str(task.get("result_content_type") or "video/mp4"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def forward_without_charge(self, method: str, config: dict[str, Any], path: str) -> None:
        upstream_url = build_upstream_url(config, path)
        upstream = requests.request(method, upstream_url, headers=proxy_auth_headers(config, upstream_url), timeout=REQUEST_TIMEOUT)
        if upstream.status_code >= 400:
            raise StudioError(upstream.status_code, upstream.text[:1000] or upstream.reason)
        self.forward_response(upstream)

    def forward_response(self, upstream: requests.Response) -> None:
        body = upstream.content
        self.send_response(upstream.status_code)
        self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/octet-stream"))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_generation_jobs(self, session: dict[str, Any], query: dict[str, list[str]]) -> None:
        try:
            limit = max(1, min(200, int((query.get("limit") or ["50"])[0])))
        except ValueError:
            limit = 50
        status = str((query.get("status") or [""])[0]).strip()
        clauses = ["source=?", "user_id=?"]
        params: list[Any] = [session["source"], session["user_id"]]
        if status == "active":
            clauses.append("status in ('queued','running')")
        elif status:
            clauses.append("status=?")
            params.append(status)
        with db() as conn:
            rows = conn.execute(
                f"select * from studio_generation_jobs where {' and '.join(clauses)} order by created_at desc limit ?",
                params + [limit],
            ).fetchall()
        self.send_json(200, {"success": True, "jobs": [public_generation_job(dict(row)) for row in rows]})

    def handle_generation_job_result(self, job: dict[str, Any]) -> None:
        if job["status"] != "succeeded":
            raise StudioError(409, f"Generation job is not complete: {job['status']}")
        r2_key = str(job.get("result_r2_key") or "")

        body = b""
        result_file = str(job.get("result_file") or "")
        if result_file:
            result_path = generation_job_stored_path(job["job_id"], result_file)
            if result_path.exists():
                body = result_path.read_bytes()
        if not body and r2_key:
            r2_key = generation_result_r2_key(job["job_id"], r2_key)
            response = async_worker_request("GET", f"/assets/{r2_key}", timeout=60)
            if response.status_code >= 400:
                raise StudioError(response.status_code, response.text[:500] or response.reason)
            body = response.content
        if not body:
            raise StudioError(410, "Generation result has expired")

        # Always stream the cached result through this authenticated, same-origin
        # endpoint. A 302 to workers.dev makes browser fetches depend on cross-
        # origin CORS and can leave a completed canvas node stuck in "loading".
        self.send_response(200)
        self.send_header("Content-Type", job.get("result_content_type") or "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
            with db() as conn:
                conn.execute(
                    "update studio_generation_jobs set result_delivered_at=case when result_delivered_at=0 then ? else result_delivered_at end,updated_at=? where job_id=?",
                    (now(), now(), job["job_id"]),
                )
            _CLEANUP_WAKE_EVENT.set()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_user_usage(self, session: dict[str, Any], query: dict[str, list[str]]) -> None:
        rows = list_usage(query, session=session)
        self.send_json(200, {"success": True, "usage": rows})

    def handle_usage_report(self, session: dict[str, Any], payload: dict[str, Any]) -> None:
        external_key = str(payload.get("externalKey") or "").strip()
        note = str(payload.get("note") or "").strip()[:1000]
        if not external_key:
            raise StudioError(400, "usage error code is required")
        with db() as conn:
            row = conn.execute(
                "select status from studio_usage_ledger where external_key=? and source=? and user_id=?",
                (external_key, session["source"], session["user_id"]),
            ).fetchone()
            if not row:
                raise StudioError(404, "usage record was not found")
            if str(row["status"]) == "success":
                raise StudioError(400, "only failed or refunded records can be reported")
            conn.execute(
                "update studio_usage_ledger set report_status='open', report_note=?, reported_at=?, updated_at=? where external_key=?",
                (note, now(), now(), external_key),
            )
        self.send_json(200, {"success": True})

    def handle_admin_get(self, path: str, query: dict[str, list[str]] | None = None) -> None:
        session = current_session(self.headers, admin=True)
        if path == "/studio-api/admin/providers":
            with db() as conn:
                rows = [public_provider(dict(row)) for row in conn.execute("select * from studio_provider_configs order by id desc")]
            self.send_json(200, {"success": True, "providers": rows})
            return
        if path == "/studio-api/admin/models" or path == "/studio-api/admin/pricing":
            with db() as conn:
                rows = conn.execute(
                    """
                    select m.*, p.name provider_name, p.api_format
                    from studio_model_catalog m
                    join studio_provider_configs p on p.id=m.provider_id
                    order by m.capability, m.display_name
                    """
                ).fetchall()
            self.send_json(200, {"success": True, "models": [admin_model(dict(row)) for row in rows]})
            return
        if path == "/studio-api/admin/admins":
            with db() as conn:
                rows = [dict(row) for row in conn.execute("select username,enabled,created_at from studio_admins order by username")]
            self.send_json(200, {"success": True, "admins": rows})
            return
        if path == "/studio-api/admin/users":
            with db() as conn:
                rows = conn.execute("select source,user_id,username,email,balance,points,updated_at from studio_sessions order by updated_at desc").fetchall()
            latest: dict[tuple[str, str], Any] = {}
            for row in rows:
                key = (str(row["source"] or ""), str(row["user_id"] or ""))
                latest.setdefault(key, row)
            self.send_json(200, {"success": True, "users": [
                {
                    "source": str(row["source"] or ""),
                    "userId": str(row["user_id"] or ""),
                    "username": str(row["username"] or ""),
                    "email": str(row["email"] or ""),
                    "balance": float(row["balance"] or 0),
                    "points": float(row["points"] or 0),
                    "updatedAt": int(row["updated_at"] or 0),
                }
                for row in latest.values()
            ]})
            return
        if path == "/studio-api/admin/settings":
            self.send_json(200, {"success": True, "pricing": {
                "pointsPerDollar": configured_points_per_dollar(),
                "sourceBalanceUnitsPerDollar": runtime_positive_float("pricing_sourceBalanceUnitsPerDollar", SOURCE_BALANCE_UNITS_PER_DOLLAR),
                "massmoreSourceBalanceUnitsPerDollar": runtime_positive_float("pricing_massmoreSourceBalanceUnitsPerDollar", MASSMORE_SOURCE_BALANCE_UNITS_PER_DOLLAR),
                "mtlineSourceBalanceUnitsPerDollar": runtime_positive_float("pricing_mtlineSourceBalanceUnitsPerDollar", MTLINE_SOURCE_BALANCE_UNITS_PER_DOLLAR),
            }})
            return
        if path == "/studio-api/admin/storage-settings":
            self.send_json(200, {"success": True, "storage": admin_storage_settings()})
            return
        if path == "/studio-api/admin/usage":
            rows = list_usage(query or {})
            self.send_json(200, {"success": True, "usage": rows})
            return
        if path == "/studio-api/admin/concurrency":
            default_limit, _ = generation_concurrency_snapshot()
            with db() as conn:
                totals = conn.execute(
                    """
                    select
                        sum(case when status='running' then 1 else 0 end) running,
                        sum(case when status='queued' then 1 else 0 end) queued
                    from studio_generation_jobs
                    where status in ('running','queued')
                    """
                ).fetchone()
            self.send_json(
                200,
                {
                    "success": True,
                    "globalLimit": global_generation_concurrency(),
                    "globalMaxLimit": None,
                    "runningTotal": int(totals["running"] or 0),
                    "queuedTotal": int(totals["queued"] or 0),
                    "defaultLimit": default_limit,
                    "fallbackLimit": USER_GENERATION_CONCURRENCY,
                    "maxLimit": None,
                    "users": list_generation_concurrency_users(),
                },
            )
            return
        if path == "/studio-api/admin/workflows":
            self.send_json(200, {"success": True, "workflows": list_workflows(session, admin=True)})
            return
        if path == "/studio-api/admin/workflow-users":
            self.send_json(200, {"success": True, "users": list_workflow_user_options()})
            return
        self.send_json(404, {"success": False, "message": "not found"})

    def handle_admin_post(self, path: str, payload: dict[str, Any]) -> None:
        session = current_session(self.headers, admin=True)
        ts = now()
        provider_models_match = re.fullmatch(r"/studio-api/admin/providers/(\d+)/models", path)
        if provider_models_match:
            provider_id = int(provider_models_match.group(1))
            try:
                models = provider_model_discovery(provider_id)
                self.send_json(200, {"success": True, "models": models})
            except Exception as exc:
                raise StudioError(exc.status, exc.message) if isinstance(exc, StudioError) else StudioError(502, str(exc))
            return
        provider_test_match = re.fullmatch(r"/studio-api/admin/providers/(\d+)/test", path)
        if provider_test_match:
            provider_id = int(provider_test_match.group(1))
            try:
                started = time.monotonic()
                models = provider_model_discovery(provider_id)
                result = {"ok": True, "statusCode": 200, "message": f"Provider responded with {len(models)} models in {int((time.monotonic() - started) * 1000)} ms", "modelFound": True}
            except Exception as exc:
                result = {"ok": False, "statusCode": getattr(exc, "status", None), "message": str(exc), "modelFound": False}
            self.send_json(200, {"success": True, "result": result})
            return
        model_test_match = re.fullmatch(r"/studio-api/admin/models/(\d+)/test", path)
        if model_test_match:
            try:
                result = real_model_test(int(model_test_match.group(1)))
            except Exception as exc:
                result = {"ok": False, "statusCode": getattr(exc, "status", None), "message": str(exc)}
            self.send_json(200, {"success": True, "result": result})
            return
        if path == "/studio-api/admin/usage/refund":
            external_key = str(payload.get("externalKey") or "").strip()
            if not external_key:
                raise StudioError(400, "usage error code is required")
            credits = admin_refund_usage(session, external_key)
            self.send_json(200, {"success": True, "credits": credits})
            return
        if path == "/studio-api/admin/providers":
            protocol = normalize_provider_protocol_config(payload)
            name = str(payload.get("name") or "").strip()
            if not name:
                raise StudioError(400, "provider name is required")
            base_url = validate_provider_base_url(protocol["base_url"])
            with db() as conn:
                cur = conn.execute(
                    """
                    insert into studio_provider_configs(
                        name,base_url,api_key,api_format,protocol_template,is_async,create_path,poll_path_template,
                        content_path_template,task_id_field,status_field,result_url_field,completed_statuses,
                        failed_statuses,download_result,auth_mode,auth_header_name,auth_query_name,extra_headers,
                        enabled,created_at,updated_at
                    ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        name,
                        base_url,
                        payload.get("apiKey") or payload.get("api_key"),
                        protocol["api_format"],
                        protocol["protocol_template"],
                        protocol["is_async"],
                        protocol["create_path"],
                        protocol["poll_path_template"],
                        protocol["content_path_template"],
                        protocol["task_id_field"],
                        protocol["status_field"],
                        protocol["result_url_field"],
                        protocol["completed_statuses"],
                        protocol["failed_statuses"],
                        protocol["download_result"],
                        protocol["auth_mode"],
                        protocol["auth_header_name"],
                        protocol["auth_query_name"],
                        protocol["extra_headers"],
                        int(bool(payload.get("enabled", True))),
                        ts,
                        ts,
                    ),
                )
            admin_audit(session["username"], "provider.create", {"id": cur.lastrowid, "name": payload.get("name")})
            self.send_json(200, {"success": True, "id": cur.lastrowid})
            return
        if path == "/studio-api/admin/models":
            model = str(payload.get("model") or "").strip()
            capability = str(payload.get("capability") or "").strip().lower()
            if not model or capability not in {"text", "image", "video", "audio"}:
                raise StudioError(400, "model and a valid capability are required")
            credit_cost = float(payload.get("creditCost") or 0)
            if credit_cost < 0:
                raise StudioError(400, "credit cost cannot be negative")
            with db() as conn:
                cur = conn.execute(
                    "insert into studio_model_catalog(provider_id,model,display_name,capability,credit_cost,pricing_rules,enabled,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)",
                    (
                        payload.get("providerId"),
                        model,
                        payload.get("displayName") or model,
                        capability,
                        credit_cost,
                        json.dumps(safe_json_object(payload.get("pricingRules") or payload.get("pricing_rules") or {}), ensure_ascii=False),
                        int(bool(payload.get("enabled", True))),
                        ts,
                        ts,
                    ),
                )
            admin_audit(session["username"], "model.create", {"id": cur.lastrowid, "model": payload.get("model")})
            self.send_json(200, {"success": True, "id": cur.lastrowid})
            return
        if path == "/studio-api/admin/admins":
            salt = secrets.token_hex(16)
            username = str(payload.get("username") or "").strip()
            password = str(payload.get("password") or "")
            if not username or not password:
                raise StudioError(400, "username and password are required")
            with db() as conn:
                conn.execute("insert or replace into studio_admins(username,password_hash,salt,enabled,created_at) values(?,?,?,?,?)", (username, password_hash(password, salt), salt, 1, ts))
            admin_audit(session["username"], "admin.upsert", {"username": username})
            self.send_json(200, {"success": True})
            return
        self.send_json(404, {"success": False, "message": "not found"})

    def handle_admin_patch(self, path: str, payload: dict[str, Any]) -> None:
        session = current_session(self.headers, admin=True)
        failover_match = re.fullmatch(r"/studio-api/admin/models/(\d+)/failover", path)
        if failover_match:
            model_id = int(failover_match.group(1))
            enabled = bool(payload.get("enabled"))
            route_ids = safe_json_int_list(payload.get("routeModelIds") or payload.get("route_model_ids") or [])
            with db() as conn:
                owner = conn.execute("select model,capability from studio_model_catalog where id=?", (model_id,)).fetchone()
                if not owner:
                    raise StudioError(404, "Model was not found")
                if enabled and not route_ids:
                    raise StudioError(400, "At least one provider route is required when failover is enabled")
                valid = []
                if route_ids:
                    placeholders = ",".join("?" for _ in route_ids)
                    rows = conn.execute(
                        f"select m.id,m.provider_id from studio_model_catalog m join studio_provider_configs p on p.id=m.provider_id where m.id in ({placeholders}) and m.capability=? and m.enabled=1 and p.enabled=1",
                        route_ids + [owner["capability"]],
                    ).fetchall()
                    valid = [int(row["id"]) for row in rows]
                if enabled and len(valid) != len(route_ids):
                    raise StudioError(400, "All failover routes must use the same capability and be enabled")
                if enabled and len({int(row["provider_id"]) for row in rows}) != len(rows):
                    raise StudioError(400, "A provider can appear only once in a failover route")
                conn.execute(
                    "update studio_model_catalog set failover_enabled=?,failover_route_model_ids=?,updated_at=? where id=?",
                    (int(enabled), json.dumps(route_ids if enabled else [], ensure_ascii=False), now(), model_id),
                )
            admin_audit(session["username"], "model.failover.patch", {"id": model_id, "enabled": enabled, "routeModelIds": route_ids})
            self.send_json(200, {"success": True, "modelId": model_id, "enabled": enabled, "routeModelIds": route_ids if enabled else []})
            return
        if path == "/studio-api/admin/concurrency":
            if "globalLimit" not in payload and "defaultLimit" not in payload:
                raise StudioError(400, "globalLimit or defaultLimit is required")
            response: dict[str, Any] = {"success": True}
            if "globalLimit" in payload:
                response["globalLimit"] = set_global_generation_concurrency(session["username"], payload.get("globalLimit"))
            if "defaultLimit" in payload:
                response["defaultLimit"] = set_default_generation_concurrency(session["username"], payload.get("defaultLimit"))
            admin_audit(session["username"], "concurrency.settings.patch", response)
            self.send_json(200, response)
            return
        if path == "/studio-api/admin/settings":
            values = {
                "pointsPerDollar": "STUDIO_POINTS_PER_DOLLAR",
                "sourceBalanceUnitsPerDollar": "STUDIO_SOURCE_BALANCE_UNITS_PER_DOLLAR",
                "massmoreSourceBalanceUnitsPerDollar": "STUDIO_MASSMORE_SOURCE_BALANCE_UNITS_PER_DOLLAR",
                "mtlineSourceBalanceUnitsPerDollar": "STUDIO_MTLINE_SOURCE_BALANCE_UNITS_PER_DOLLAR",
            }
            updates = {key: float(payload[key]) for key in values if key in payload}
            if not updates or any(value <= 0 for value in updates.values()):
                raise StudioError(400, "At least one positive pricing setting is required")
            # Runtime settings are persisted in the Studio database; the process
            # constants remain the safe fallback after restart.
            with db() as conn:
                for key, value in updates.items():
                    conn.execute(
                        """
                        insert into studio_runtime_settings(key,value,updated_by,created_at,updated_at)
                        values(?,?,?,?,?)
                        on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at
                        """,
                        (f"pricing_{key}", str(value), session["username"], now(), now()),
                    )
            admin_audit(session["username"], "pricing.settings.patch", updates)
            self.send_json(200, {"success": True})
            return
        if path == "/studio-api/admin/storage-settings":
            settings = save_storage_settings(session["username"], payload.get("storage") or payload)
            admin_audit(session["username"], "storage.settings.patch", {
                "mode": settings["mode"],
                "allowUserProvider": settings["allowUserProvider"],
                "providerCount": len(settings["providers"]),
            })
            self.send_json(200, {"success": True, "storage": admin_storage_settings()})
            return
        concurrency_match = re.fullmatch(r"/studio-api/admin/concurrency/users/([^/]+)/([^/]+)", path)
        if concurrency_match:
            source = urllib.parse.unquote(concurrency_match.group(1))
            user_id = urllib.parse.unquote(concurrency_match.group(2))
            limit = set_user_generation_concurrency(session["username"], source, user_id, payload.get("limit"))
            admin_audit(session["username"], "concurrency.user.patch", {"source": source, "user_id": user_id, "limit": limit})
            self.send_json(200, {"success": True, "limit": limit})
            return
        parts = path.strip("/").split("/")
        if len(parts) < 4:
            raise StudioError(404, "not found")
        kind = parts[2]
        ts = now()
        if kind == "workflows":
            workflow_key = urllib.parse.unquote(parts[3])
            if workflow_key not in WORKFLOW_DEFINITIONS:
                raise StudioError(404, "workflow was not found")
            access_mode = str(payload.get("accessMode") or payload.get("access_mode") or "all").strip().lower()
            if access_mode not in {"all", "selected"}:
                raise StudioError(400, "invalid workflow access mode")
            allowed_users = sorted({str(item).strip() for item in payload.get("allowedUsers", []) if str(item).strip()})
            with db() as conn:
                conn.execute(
                    "update studio_workflow_access set enabled=?,access_mode=?,allowed_users=?,updated_at=? where workflow_key=?",
                    (int(bool(payload.get("enabled", True))), access_mode, json.dumps(allowed_users, ensure_ascii=False), ts, workflow_key),
                )
            admin_audit(session["username"], "workflow.patch", {"key": workflow_key, "enabled": bool(payload.get("enabled", True)), "access_mode": access_mode, "allowed_users": allowed_users})
            self.send_json(200, {"success": True})
            return
        if kind == "usage":
            external_key = parts[3]
            report_status = str(payload.get("reportStatus") or "resolved").strip().lower()
            if report_status not in {"open", "resolved"}:
                raise StudioError(400, "invalid report status")
            with db() as conn:
                cur = conn.execute("update studio_usage_ledger set report_status=?, updated_at=? where external_key=? and report_status<>''", (report_status, ts, external_key))
            if not cur.rowcount:
                raise StudioError(404, "usage report was not found")
            admin_audit(session["username"], "usage.report.patch", {"external_key": external_key, "report_status": report_status})
            self.send_json(200, {"success": True})
            return
        item_id = int(parts[3])
        if kind == "providers":
            fields = {
                k: v
                for k, v in {
                    "name": payload.get("name"),
                    "base_url": payload.get("baseUrl") if "baseUrl" in payload else payload.get("base_url"),
                    "api_key": payload.get("apiKey") if "apiKey" in payload else payload.get("api_key"),
                }.items()
                if v is not None
            }
            protocol = normalize_provider_protocol_config(payload)
            if "name" in fields:
                fields["name"] = str(fields["name"] or "").strip()
                if not fields["name"]:
                    raise StudioError(400, "provider name is required")
            if "baseUrl" in payload or "base_url" in payload:
                fields["base_url"] = validate_provider_base_url(protocol["base_url"])
            for key, aliases in PROVIDER_PROTOCOL_FIELD_ALIASES.items():
                if any(alias in payload for alias in aliases):
                    fields[key] = protocol[key]
            if "enabled" in payload:
                fields["enabled"] = int(bool(payload.get("enabled")))
            update_by_id("studio_provider_configs", item_id, fields, ts)
            admin_audit(session["username"], "provider.patch", {"id": item_id})
            self.send_json(200, {"success": True})
            return
        if kind in {"models", "pricing"}:
            fields = {
                k: v
                for k, v in {
                    "provider_id": payload.get("providerId"),
                    "model": payload.get("model"),
                    "display_name": payload.get("displayName"),
                    "capability": payload.get("capability"),
                    "credit_cost": payload.get("creditCost"),
                    "pricing_rules": json.dumps(safe_json_object(payload.get("pricingRules") or payload.get("pricing_rules") or {}), ensure_ascii=False) if "pricingRules" in payload or "pricing_rules" in payload else None,
                    "enabled": int(bool(payload.get("enabled"))) if "enabled" in payload else None,
                }.items()
                if v is not None
            }
            if "model" in fields:
                fields["model"] = str(fields["model"] or "").strip()
                if not fields["model"]:
                    raise StudioError(400, "model is required")
            if "capability" in fields:
                fields["capability"] = str(fields["capability"] or "").strip().lower()
                if fields["capability"] not in {"text", "image", "video", "audio"}:
                    raise StudioError(400, "invalid model capability")
            if "credit_cost" in fields:
                fields["credit_cost"] = float(fields["credit_cost"] or 0)
                if fields["credit_cost"] < 0:
                    raise StudioError(400, "credit cost cannot be negative")
            update_by_id("studio_model_catalog", item_id, fields, ts)
            admin_audit(session["username"], "model.patch", {"id": item_id})
            self.send_json(200, {"success": True})
            return
        raise StudioError(404, "not found")

    def handle_admin_delete(self, path: str) -> None:
        session = current_session(self.headers, admin=True)
        concurrency_match = re.fullmatch(r"/studio-api/admin/concurrency/users/([^/]+)/([^/]+)", path)
        if concurrency_match:
            source = urllib.parse.unquote(concurrency_match.group(1))
            user_id = urllib.parse.unquote(concurrency_match.group(2))
            if not reset_user_generation_concurrency(source, user_id):
                raise StudioError(404, "user concurrency override was not found")
            admin_audit(session["username"], "concurrency.user.reset", {"source": source, "user_id": user_id})
            self.send_json(200, {"success": True})
            return
        parts = path.strip("/").split("/")
        if len(parts) < 4:
            raise StudioError(404, "not found")
        kind, item_id = parts[2], int(parts[3])
        if kind == "providers":
            with db() as conn:
                conn.execute("delete from studio_model_catalog where provider_id=?", (item_id,))
            delete_by_id("studio_provider_configs", item_id)
            admin_audit(session["username"], "provider.delete", {"id": item_id})
            self.send_json(200, {"success": True})
            return
        if kind in {"models", "pricing"}:
            delete_by_id("studio_model_catalog", item_id)
            admin_audit(session["username"], "model.delete", {"id": item_id})
            self.send_json(200, {"success": True})
            return
        raise StudioError(404, "not found")


def update_by_id(table: str, item_id: int, fields: dict[str, Any], ts: int) -> None:
    if not fields:
        return
    fields["updated_at"] = ts
    sets = ",".join(f"{key}=?" for key in fields)
    values = list(fields.values()) + [item_id]
    with db() as conn:
        conn.execute(f"update {table} set {sets} where id=?", values)


def delete_by_id(table: str, item_id: int) -> None:
    with db() as conn:
        conn.execute(f"delete from {table} where id=?", (item_id,))


def main() -> None:
    init_db()
    if ASYNC_GENERATION_ENABLED:
        start_generation_scheduler()
    default_concurrency, _ = generation_concurrency_snapshot()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"Studio managed backend listening on http://{HOST}:{PORT}; async={ASYNC_GENERATION_ENABLED}; global_concurrency={global_generation_concurrency()}; user_concurrency={default_concurrency}",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
