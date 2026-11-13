import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

from agripulse.core import Store, simulated_reading
from agripulse.server import start_background_tasks


class BackgroundTests(unittest.TestCase):
    def test_retention_runs_without_simulator_and_preserves_device(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "test.db")
            old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(timespec="seconds")
            store.ingest(simulated_reading("field-c", 2, 0), recorded_at=old)
            stop = threading.Event()
            cleaned = threading.Event()
            original_prune = store.prune

            def prune():
                original_prune()
                cleaned.set()

            store.prune = prune
            threads = start_background_tasks(store, stop, simulator_enabled=False, retention_interval=0.01)
            try:
                self.assertTrue(cleaned.wait(3), "设备模式下没有执行清理")
            finally:
                stop.set()
                for thread in threads:
                    thread.join(timeout=3)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            self.assertEqual(store.history("field-c", "device"), [])
            self.assertEqual(len(store.latest()), 1)

    def test_retention_retries_database_errors_and_shutdown_interrupts_wait(self):
        stop = threading.Event()
        store = Mock()

        def prune():
            if store.prune.call_count == 1:
                raise sqlite3.OperationalError("busy")
            stop.set()

        store.prune.side_effect = prune
        with self.assertLogs(level="ERROR"):
            threads = start_background_tasks(store, stop, simulator_enabled=False, retention_interval=0.01)
            try:
                self.assertTrue(stop.wait(3))
            finally:
                stop.set()
                for thread in threads:
                    thread.join(timeout=3)
        self.assertEqual(store.prune.call_count, 2)

        stop = threading.Event()
        threads = start_background_tasks(store, stop, simulator_enabled=False, retention_interval=3600)
        stop.set()
        for thread in threads:
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())
