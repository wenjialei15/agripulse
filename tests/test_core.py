import math
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agripulse.core import Store, advice, simulated_reading, validate


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "data.db")
        self.row = simulated_reading("greenhouse-a", 0, 0)

    def tearDown(self):
        self.temp.cleanup()

    def test_rejects_invalid_readings_without_partial_write(self):
        for bad in [True, None, float("nan"), float("inf"), -1, 101, "42"]:
            with self.subTest(value=bad), self.assertRaises(ValueError):
                self.store.ingest({**self.row, "soil_moisture": bad})
        self.assertEqual(self.store.latest(), [])

    def test_device_source_is_assigned_by_server_and_cannot_impersonate_demo(self):
        self.store.ingest(self.row, "simulator")
        with self.assertRaises(ValueError):
            self.store.ingest({**self.row, "source": "simulator"})
        self.store.ingest({**self.row, "device_id": "sensor-01", "source": "simulator"})
        self.assertEqual(len(self.store.latest(source="device")), 1)
        self.assertEqual(self.store.latest(source="device")[0]["source"], "device")

    def test_history_is_bounded_chronological_and_source_filtered(self):
        for step in range(8):
            self.store.ingest(simulated_reading("greenhouse-a", 0, step), "simulator")
        self.store.ingest({**self.row, "device_id": "field-01"})
        rows = self.store.history("greenhouse-a", "simulator", 3)
        self.assertEqual([r["id"] for r in rows], [6, 7, 8])

    def test_offline_data_does_not_generate_irrigation_advice(self):
        old = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(timespec="seconds")
        self.store.ingest({**self.row, "soil_moisture": 10}, recorded_at=old)
        device = self.store.summary("device")["devices"][0]
        self.assertFalse(device["online"])
        self.assertEqual(device["advice"]["level"], "offline")

    def test_threshold_survives_reopening_and_has_clear_boundary(self):
        self.store.set_threshold("greenhouse-a", 48)
        reopened = Store(self.store.path)
        self.assertEqual(reopened.thresholds()["greenhouse-a"], 48)
        self.assertEqual(advice({**self.row, "soil_moisture": 48}, 48)["level"], "ok")
        self.assertEqual(advice({**self.row, "soil_moisture": 47.9}, 48)["level"], "warning")
        for value in [True, math.nan, 4, 91]:
            with self.assertRaises(ValueError):
                self.store.set_threshold("greenhouse-a", value)

    def test_device_ids_cannot_inject_spreadsheet_formulas(self):
        for device in ["=SUM(A1)", "+cmd", "-cmd", "@cmd", "<script>", "", "a" * 65]:
            with self.assertRaises(ValueError):
                validate({**self.row, "device_id": device})

    def test_device_cannot_silently_move_zone(self):
        self.store.ingest(self.row)
        with self.assertRaises(ValueError):
            self.store.ingest({**self.row, "zone_id": "field-c"})

    def test_retention_removes_only_expired_readings(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="seconds")
        self.store.ingest(self.row, recorded_at=old)
        self.store.ingest(self.row)
        self.store.prune()
        self.assertEqual(len(self.store.history("greenhouse-a", "device")), 1)

    def test_device_identity_survives_pruning_and_reopening(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="seconds")
        self.store.ingest(self.row, recorded_at=old)
        self.store.prune()
        reopened = Store(self.store.path)
        device = reopened.summary("device")["devices"][0]
        self.assertFalse(device["online"])
        self.assertFalse(device["has_reading"])
        self.assertIsNone(device["soil_moisture"])
        self.assertEqual(device["last_seen"], old)
        self.assertEqual(device["advice"]["level"], "offline")
        self.assertEqual(reopened.history("greenhouse-a", "device"), [])
        with self.assertRaises(ValueError):
            reopened.ingest({**self.row, "zone_id": "field-c"})
        with self.assertRaises(ValueError):
            reopened.ingest(self.row, "simulator")
        reopened.ingest(self.row)
        self.assertTrue(reopened.summary("device")["devices"][0]["online"])
        self.assertEqual(len(reopened.latest()), 1)

    def test_thresholds_are_isolated_and_survive_reopening(self):
        self.store.set_threshold("greenhouse-a", 50, "device")
        self.store.set_threshold("greenhouse-a", 20, "simulator")
        reopened = Store(self.store.path)
        self.assertEqual(reopened.thresholds("device")["greenhouse-a"], 50)
        self.assertEqual(reopened.thresholds("simulator")["greenhouse-a"], 20)
        for source in ("device", "simulator"):
            row = {**self.row, "device_id": source, "soil_moisture": 30}
            reopened.ingest(row, source)
        self.assertEqual(reopened.summary("device")["devices"][0]["advice"]["level"], "warning")
        self.assertEqual(reopened.summary("simulator")["devices"][0]["advice"]["level"], "ok")

    def test_extreme_numbers_and_invalid_zone_types_are_validation_errors(self):
        for bad in (10 ** 400, -(10 ** 400), math.nan, math.inf, -math.inf):
            with self.subTest(value=str(bad)[:20]), self.assertRaises(ValueError):
                self.store.ingest({**self.row, "temperature": bad})
            with self.assertRaises(ValueError):
                self.store.set_threshold("greenhouse-a", bad)
        for bad in ([], {}):
            with self.assertRaises(ValueError):
                self.store.ingest({**self.row, "zone_id": bad})
            with self.assertRaises(ValueError):
                self.store.set_threshold(bad, 35)
        self.assertEqual(self.store.latest(), [])

    def test_concurrent_first_reports_cannot_claim_id_in_two_zones(self):
        barrier = threading.Barrier(2)

        def ingest(zone):
            barrier.wait(timeout=5)
            try:
                self.store.ingest({**self.row, "zone_id": zone})
                return "accepted"
            except ValueError:
                return "rejected"

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(ingest, ["greenhouse-a", "field-c"]))
        self.assertCountEqual(results, ["accepted", "rejected"])
        self.assertEqual(len(self.store.latest()), 1)

    def test_v010_database_migrates_without_losing_readings_or_settings(self):
        path = Path(self.temp.name) / "legacy.db"
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="seconds")
        with sqlite3.connect(path) as db:
            db.executescript("""
                CREATE TABLE readings (
                    id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL, device_id TEXT NOT NULL,
                    temperature REAL NOT NULL, humidity REAL NOT NULL, soil_moisture REAL NOT NULL,
                    light REAL NOT NULL, battery REAL NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL
                );
                CREATE TABLE thresholds (zone_id TEXT PRIMARY KEY, moisture_min REAL NOT NULL);
                INSERT INTO thresholds VALUES ('greenhouse-a', 42);
            """)
            db.execute("INSERT INTO readings VALUES (1, 'greenhouse-a', 'legacy-01', 25, 60, 30, 1000, 90, 'device', ?)", (old,))
        migrated = Store(path)
        self.assertEqual(migrated.history("greenhouse-a", "device")[0]["id"], 1)
        self.assertEqual(migrated.thresholds("device")["greenhouse-a"], 42)
        self.assertEqual(migrated.thresholds("simulator")["greenhouse-a"], 42)
        migrated.set_threshold("greenhouse-a", 55, "device")
        migrated.prune()
        reopened = Store(path)
        self.assertEqual(reopened.latest()[0]["device_id"], "legacy-01")
        self.assertEqual(reopened.thresholds("device")["greenhouse-a"], 55)
        self.assertEqual(reopened.thresholds("simulator")["greenhouse-a"], 42)
        with reopened.connection() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
