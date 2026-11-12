import csv
import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from agripulse.core import Store, simulated_reading
from agripulse.server import make_handler


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "test.db")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.store, "test-key"))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def call(self, path, payload=None, key="test-key", extra=None):
        headers = {"Authorization": "Bearer " + key}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        headers.update(extra or {})
        request = Request(self.base + path, headers=headers, data=json.dumps(payload).encode() if payload is not None else None)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def test_health_public_but_data_and_mutations_require_key(self):
        self.assertEqual(self.call("/api/health", key="wrong")[0], 200)
        self.assertEqual(self.call("/api/summary", key="wrong")[0], 401)
        self.assertEqual(self.call("/api/telemetry", simulated_reading("field-c", 2, 1), key="wrong")[0], 401)

    def test_ingest_summary_history_and_csv_roundtrip(self):
        row = {**simulated_reading("field-c", 2, 1), "device_id": "esp32-01"}
        status, body, _ = self.call("/api/telemetry", row)
        self.assertEqual(status, 201)
        status, body, _ = self.call("/api/summary?source=device")
        self.assertEqual(json.loads(body)["devices"][0]["device_id"], "esp32-01")
        status, body, _ = self.call("/api/history?zone=field-c&source=device")
        self.assertEqual(len(json.loads(body)["readings"]), 1)
        status, body, headers = self.call("/api/export.csv?zone=field-c&source=device")
        self.assertIn("text/csv", headers["Content-Type"])
        self.assertEqual(list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))[0]["device_id"], "esp32-01")
        self.assertEqual(self.call("/api/threshold", {"zone_id": "field-c", "moisture_min": 25})[0], 200)
        self.assertEqual(self.store.thresholds()["field-c"], 25)

    def test_cross_origin_write_is_rejected(self):
        status, _, _ = self.call("/api/threshold", {"zone_id": "field-c", "moisture_min": 25}, extra={"Origin": "https://other.example"})
        self.assertEqual(status, 403)

    def test_invalid_json_values_and_unknown_zone_return_400(self):
        for payload in [[], {"zone_id": "missing"}, {**simulated_reading("field-c", 2, 1), "humidity": float("nan")}]:
            self.assertEqual(self.call("/api/telemetry", payload)[0], 400)
        self.assertEqual(self.call("/api/history?zone=missing")[0], 400)
        self.assertEqual(self.call("/api/history?source=anything")[0], 400)

    def test_assets_have_security_headers_and_no_path_traversal(self):
        for path in ["/", "/app.js", "/style.css", "/favicon.svg"]:
            status, body, headers = self.call(path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.call("/../core.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
