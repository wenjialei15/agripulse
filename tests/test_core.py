import math
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
