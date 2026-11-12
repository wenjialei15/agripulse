"""Local-first HTTP application. Start with python -m agripulse."""
import argparse
import csv
import hmac
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .core import Store, ZONES

STATIC = Path(__file__).parent / "static"
MAX_BODY = 16384


def make_handler(store, api_key="", simulator_enabled=True):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AgriPulse/0.1"

        def reply(self, status, body, content_type="application/json; charset=utf-8"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("Authorization", "")
            if api_key and not hmac.compare_digest(supplied.encode(), ("Bearer " + api_key).encode()):
                self.reply(401, {"error": "��Ҫ��Ч�� Bearer API key"})
                return False
            return True

        def do_GET(self):
            route = urlsplit(self.path)
            if route.path == "/api/health":
                return self.reply(200, {"status": "ok", "version": "0.1.0", "simulator_enabled": simulator_enabled})
            if route.path.startswith("/api/"):
                if not self.authorized():
                    return
                query = parse_qs(route.query)
                source = query.get("source", ["simulator"])[0]
                if source not in ("simulator", "device"):
                    return self.reply(400, {"error": "source ֻ���� simulator �� device"})
                if route.path == "/api/summary":
                    return self.reply(200, {**store.summary(source), "simulator_enabled": simulator_enabled})
                if route.path in ("/api/history", "/api/export.csv"):
                    zone = query.get("zone", ["greenhouse-a"])[0]
                    if zone not in ZONES:
                        return self.reply(400, {"error": "δ֪�ؿ�"})
                    limit = 10000 if route.path.endswith(".csv") else 120
                    rows = store.history(zone, source, limit)
                    if route.path.endswith(".csv"):
                        output = io.StringIO(newline="")
                        fields = ["id", "zone_id", "device_id", "temperature", "humidity", "soil_moisture", "light", "battery", "source", "recorded_at"]
                        writer = csv.DictWriter(output, fieldnames=fields)
                        writer.writeheader()
                        writer.writerows(rows)
                        return self.reply(200, ("\ufeff" + output.getvalue()).encode("utf-8"), "text/csv; charset=utf-8")
                    return self.reply(200, {"readings": rows})
                return self.reply(404, {"error": "API ������"})
            assets = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8"), "/favicon.svg": ("favicon.svg", "image/svg+xml")}
            if route.path not in assets:
                return self.reply(404, {"error": "ҳ�治����"})
            name, mime = assets[route.path]
            self.reply(200, (STATIC / name).read_bytes(), mime)

        def do_POST(self):
            if not self.authorized():
                return
            # Reject browser requests from a different origin, including null origins.
            origin = self.headers.get("Origin")
            host = self.headers.get("Host", "")
            if origin and origin not in ("http://" + host, "https://" + host):
                return self.reply(403, {"error": "��������վд��"})
            path = urlsplit(self.path).path
            if path not in ("/api/telemetry", "/api/threshold"):
                return self.reply(404, {"error": "API ������"})
            if self.headers.get_content_type() != "application/json":
                return self.reply(415, {"error": "Content-Type ����Ϊ application/json"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BODY:
                    return self.reply(413, {"error": "���������Ϊ 1�C16384 �ֽ�"})
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError("���������Ϊ JSON ����")
                if path == "/api/telemetry":
                    return self.reply(201, {"id": store.ingest(payload), "source": "device"})
                store.set_threshold(payload.get("zone_id"), payload.get("moisture_min"))
                return self.reply(200, {"ok": True})
            except (ValueError, UnicodeError, TypeError) as exc:
                self.reply(400, {"error": str(exc)})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="AgriPulse ũҵ��������ʾ���豸���")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", default="data/agripulse.db")
    parser.add_argument("--no-simulator", action="store_true")
    args = parser.parse_args()
    key = os.environ.get("AGRIPULSE_API_KEY", "")
    if args.host not in ("127.0.0.1", "localhost", "::1") and len(key) < 24:
        parser.error("�Ǳ���������Ҫ���� 24 �ַ��� AGRIPULSE_API_KEY�������粿����ͨ�� HTTPS ���������")
    store = Store(args.db)
    store.prune()
    stop = threading.Event()
    if not args.no_simulator:
        store.seed_demo()

        def simulate():
            step = 60
            while not stop.is_set():
                store.simulate(step)
                if step % 720 == 0:
                    store.prune()
                step += 1
                stop.wait(5)

        threading.Thread(target=simulate, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(store, key, not args.no_simulator))
    server.daemon_threads = True
    print(f"AgriPulse: http://{args.host}:{args.port}  (Ctrl+C ֹͣ)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
