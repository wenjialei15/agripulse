"""Validated telemetry, persistent storage and explainable demo rules."""
import math
import random
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ZONES = {"greenhouse-a": "温室 A · 番茄", "greenhouse-b": "温室 B · 叶菜", "field-c": "露天 C · 玉米"}
RANGES = {"temperature": (-40, 85), "humidity": (0, 100), "soil_moisture": (0, 100), "light": (0, 200000), "battery": (0, 100)}
SOURCES = ("device", "simulator")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError("上报内容必须是 JSON 对象")
    zone = payload.get("zone_id")
    device = payload.get("device_id")
    if not isinstance(zone, str) or zone not in ZONES:
        raise ValueError("未知 zone_id")
    if not isinstance(device, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", device):
        raise ValueError("device_id 需为 1–64 位字母、数字、短横线或下划线，且以字母或数字开头")
    values = {}
    for key, (low, high) in RANGES.items():
        value = payload.get(key)
        # Check bounds before math.isfinite: converting a huge JSON integer to
        # float can raise OverflowError even though it is simply out of range.
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not math.isfinite(value):
            raise ValueError(f"{key} 必须是 {low} 到 {high} 之间的有限数值")
        values[key] = float(value)
    return {"zone_id": zone, "device_id": device, **values}


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 1:
                raise ValueError("数据库版本高于当前程序支持的版本，请使用较新的 AgriPulse")
            db.execute("""CREATE TABLE IF NOT EXISTS readings (
                    id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL, device_id TEXT NOT NULL,
                    temperature REAL NOT NULL, humidity REAL NOT NULL, soil_moisture REAL NOT NULL,
                    light REAL NOT NULL, battery REAL NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL
                )""")
            db.execute("CREATE INDEX IF NOT EXISTS readings_zone_time ON readings(zone_id, recorded_at, id)")
            db.execute("CREATE INDEX IF NOT EXISTS readings_device ON readings(device_id, id)")
            db.execute("CREATE INDEX IF NOT EXISTS readings_zone_source ON readings(zone_id, source, id)")
            db.execute("CREATE INDEX IF NOT EXISTS readings_retention ON readings(recorded_at)")
            db.execute("""CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY, zone_id TEXT NOT NULL, source TEXT NOT NULL,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
            )""")
            if version == 0:
                # Backfill before retention runs. Identity then survives pruning.
                db.execute("""INSERT OR IGNORE INTO devices
                    SELECT r.device_id, r.zone_id, r.source,
                        (SELECT MIN(recorded_at) FROM readings WHERE device_id=r.device_id), r.recorded_at
                    FROM readings r JOIN (SELECT device_id, MAX(id) latest_id FROM readings GROUP BY device_id) d
                    ON r.id=d.latest_id""")
            columns = {r["name"] for r in db.execute("PRAGMA table_info(thresholds)")}
            legacy = bool(columns) and "source" not in columns
            if legacy:
                db.execute("ALTER TABLE thresholds RENAME TO thresholds_legacy")
            db.execute("""CREATE TABLE IF NOT EXISTS thresholds (
                zone_id TEXT NOT NULL, source TEXT NOT NULL, moisture_min REAL NOT NULL,
                PRIMARY KEY (zone_id, source)
            )""")
            if legacy:
                # Preserve old settings in both modes once; future edits are isolated.
                for source in SOURCES:
                    db.execute("INSERT INTO thresholds SELECT zone_id, ?, moisture_min FROM thresholds_legacy", (source,))
                db.execute("DROP TABLE thresholds_legacy")
            db.executemany("INSERT OR IGNORE INTO thresholds VALUES (?, ?, ?)",
                           [(zone, source, 35) for zone in ZONES for source in SOURCES])
            db.execute("PRAGMA user_version=1")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def ingest(self, payload, source="device", recorded_at=None):
        row = validate(payload)
        if source not in SOURCES:
            raise ValueError("无效数据来源")
        timestamp = recorded_at or now()
        with self.connection() as db:
            # The first write acquires SQLite's write lock before checking identity.
            # Concurrent first reports cannot register one ID in different zones.
            db.execute("INSERT OR IGNORE INTO devices VALUES (?, ?, ?, ?, ?)",
                       (row["device_id"], row["zone_id"], source, timestamp, timestamp))
            existing = db.execute("SELECT zone_id, source FROM devices WHERE device_id=?", (row["device_id"],)).fetchone()
            if existing["source"] != source or existing["zone_id"] != row["zone_id"]:
                raise ValueError("device_id 已被其他来源或地块使用，请使用新的设备标识")
            cur = db.execute("""INSERT INTO readings
                (zone_id, device_id, temperature, humidity, soil_moisture, light, battery, source, recorded_at)
                VALUES (:zone_id,:device_id,:temperature,:humidity,:soil_moisture,:light,:battery,:source,:recorded_at)""",
                {**row, "source": source, "recorded_at": timestamp})
            db.execute("UPDATE devices SET last_seen=? WHERE device_id=?", (timestamp, row["device_id"]))
            return cur.lastrowid

    def thresholds(self, source="simulator"):
        if source not in SOURCES:
            raise ValueError("无效数据来源")
        with self.connection() as db:
            return {r["zone_id"]: r["moisture_min"] for r in db.execute("SELECT * FROM thresholds WHERE source=?", (source,))}

    def set_threshold(self, zone, value, source="simulator"):
        if source not in SOURCES:
            raise ValueError("source 必须为 simulator 或 device")
        if not isinstance(zone, str) or zone not in ZONES or isinstance(value, bool) or not isinstance(value, (int, float)) or not 5 <= value <= 90 or not math.isfinite(value):
            raise ValueError("地块无效或阈值不在 5–90% 之间")
        with self.connection() as db:
            db.execute("UPDATE thresholds SET moisture_min=? WHERE zone_id=? AND source=?", (value, zone, source))

    def latest(self, zone=None, source=None):
        with self.connection() as db:
            rows = db.execute("""SELECT d.device_id, d.zone_id, d.source, d.first_seen, d.last_seen,
                r.id, r.temperature, r.humidity, r.soil_moisture, r.light, r.battery,
                r.recorded_at, r.id IS NOT NULL AS has_reading
                FROM devices d LEFT JOIN readings r
                ON r.id=(SELECT MAX(id) FROM readings WHERE device_id=d.device_id)
                WHERE (? IS NULL OR d.zone_id=?) AND (? IS NULL OR d.source=?)
                ORDER BY d.zone_id, d.device_id""", (zone, zone, source, source)).fetchall()
        return [{**dict(r), "has_reading": bool(r["has_reading"])} for r in rows]

    def history(self, zone, source, limit=120):
        if zone not in ZONES or source not in ("device", "simulator"):
            raise ValueError("无效地块或数据来源")
        with self.connection() as db:
            rows = db.execute("SELECT * FROM readings WHERE zone_id=? AND source=? ORDER BY id DESC LIMIT ?", (zone, source, min(max(limit, 1), 10000))).fetchall()
        return [dict(row) for row in reversed(rows)]

    def summary(self, source="simulator"):
        thresholds = self.thresholds(source)
        rows = self.latest(source=source)
        timestamp = datetime.now(timezone.utc)
        for row in rows:
            age = (timestamp - datetime.fromisoformat(row["last_seen"])).total_seconds()
            row["online"] = row["has_reading"] and age <= 60
            row["age_seconds"] = max(0, round(age))
            row["advice"] = advice(row, thresholds[row["zone_id"]])
        return {"devices": rows, "zones": [{"id": z, "name": n, "moisture_min": thresholds[z]} for z, n in ZONES.items()], "source": source, "generated_at": now()}

    def seed_demo(self):
        if self.latest(source="simulator"):
            return
        start = datetime.now(timezone.utc) - timedelta(minutes=59)
        for minute in range(60):
            for index, zone in enumerate(ZONES):
                self.ingest(simulated_reading(zone, index, minute), "simulator", (start + timedelta(minutes=minute)).isoformat(timespec="seconds"))

    def simulate(self, step):
        for index, zone in enumerate(ZONES):
            self.ingest(simulated_reading(zone, index, step), "simulator")

    def prune(self, days=30):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self.connection() as db:
            db.execute("DELETE FROM readings WHERE recorded_at < ?", (cutoff,))


def advice(row, threshold):
    if not row.get("online", True):
        return {"level": "offline", "title": "设备离线", "reason": "超过 60 秒没有新数据，请检查供电和连接；暂不生成灌溉建议。"}
    if row["soil_moisture"] < threshold:
        return {"level": "warning", "title": "建议检查土壤水分", "reason": f"当前读数 {row['soil_moisture']:.1f}%，低于设定阈值 {threshold:g}%。请结合传感器标定、土壤和作物情况人工判断是否灌溉。"}
    return {"level": "ok", "title": "水分读数在设定范围内", "reason": f"当前读数 {row['soil_moisture']:.1f}%，未低于设定阈值 {threshold:g}%。"}


def simulated_reading(zone, index, step):
    rng = random.Random(index * 10000 + step)
    wave = math.sin(step / 8 + index)
    return {"zone_id": zone, "device_id": f"demo-{index + 1:02d}",
            "temperature": round(24 + index * 1.8 + wave * 2 + rng.uniform(-0.4, 0.4), 1),
            "humidity": round(68 - index * 4 - wave * 4, 1),
            "soil_moisture": round([48, 39, 27][index] + wave * 4, 1),
            "light": round(18000 + index * 9000 + wave * 2500), "battery": 92 - index * 8}
