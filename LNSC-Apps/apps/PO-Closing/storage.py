# -*- coding: utf-8 -*-
"""SQLite 持久化：人工核对结果 + 通知日志 + 关闭标记 + 最近核查结果。库文件默认 poclose.db。"""
import json
import sqlite3
from datetime import datetime

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS verifications (
    ebeln      TEXT NOT NULL,
    ebelp      TEXT NOT NULL,
    verdict    TEXT NOT NULL CHECK (verdict IN ('PASS','FAIL')),
    note       TEXT DEFAULT '',
    verifier   TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (ebeln, ebelp)
);
CREATE TABLE IF NOT EXISTS notify_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    channel    TEXT DEFAULT '',
    status     TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS close_marks (
    ebeln      TEXT PRIMARY KEY,
    marked_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS last_run (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    ran_at  TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);
"""


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init():
    with _conn() as conn:
        conn.executescript(SCHEMA)


def save_verification(ebeln, ebelp, verdict, note, verifier):
    rec = {"ebeln": ebeln, "ebelp": ebelp, "verdict": verdict,
           "note": (note or "")[:200], "verifier": (verifier or "")[:50],
           "created_at": _now()}
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO verifications"
            " (ebeln, ebelp, verdict, note, verifier, created_at)"
            " VALUES (:ebeln, :ebelp, :verdict, :note, :verifier, :created_at)", rec)
    return rec


def verification_map():
    """返回 {'EBELN|EBELP': {...}} 供查询结果合并。"""
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM verifications").fetchall()
    return {r["ebeln"] + "|" + r["ebelp"]: dict(r) for r in rows}


def save_notify(title, content, channel, status, detail):
    with _conn() as conn:
        conn.execute(
            "INSERT INTO notify_log (title, content, channel, status, detail, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (title, content, channel or "", status, (detail or "")[:500], _now()))


def list_notify(limit=20):
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, title, channel, status, detail, created_at"
            " FROM notify_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def save_close_marks(ebelns):
    """批量记录「标记关闭」的 PO，返回条数（幂等，重复标记不报错）。"""
    now = _now()
    with _conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO close_marks (ebeln, marked_at) VALUES (?,?)",
            [(e, now) for e in ebelns])
    return len(ebelns)


def close_mark_map():
    """返回 {EBELN: marked_at}。"""
    with _conn() as conn:
        rows = conn.execute("SELECT ebeln, marked_at FROM close_marks").fetchall()
    return {r["ebeln"]: r["marked_at"] for r in rows}


def save_last_run(payload):
    """保存最近一次定时核查结果（只保留最新一条）。"""
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO last_run (id, ran_at, payload) VALUES (1, ?, ?)",
            (payload.get("ran_at", _now()), json.dumps(payload, ensure_ascii=False)))


def get_last_run():
    """读取最近一次定时核查结果；无记录返回 None。"""
    with _conn() as conn:
        row = conn.execute("SELECT payload FROM last_run WHERE id = 1").fetchone()
    return json.loads(row["payload"]) if row else None


def get_settings():
    """读取全部设置，返回 {key: value}。"""
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def save_settings(mapping):
    """覆盖式保存设置（key 已存在则更新）。"""
    with _conn() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)",
            [(k, v) for k, v in mapping.items()])
