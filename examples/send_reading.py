"""HTTP example device. Replace read_sensors() with your actual sensor driver."""
import argparse
import json
import math
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def read_sensors(step, zone, device):
    # These are TEST VALUES, not readings from physical hardware.
    return {"zone_id": zone, "device_id": device,
            "temperature": round(25 + math.sin(step / 5), 1), "humidity": 66,
            "soil_moisture": round(31 + math.sin(step / 8) * 3, 1), "light": 18600, "battery": 88}


def main():
    parser = argparse.ArgumentParser(description="���Ͳ������ݣ�����ʵ������ʱ�滻 read_sensors()")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--device", default="example-01")
    parser.add_argument("--zone", default="greenhouse-a", choices=["greenhouse-a", "greenhouse-b", "field-c"])
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("url ������ HTTP(S) �����ַ�����ܰ���ƾ֤����ѯ������Ƭ��")
    key = os.environ.get("AGRIPULSE_API_KEY", "")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    step = 0
    try:
        while True:
            payload = read_sensors(step, args.zone, args.device)
            request = Request(args.url.rstrip("/") + "/api/telemetry", data=json.dumps(payload).encode(), headers=headers, method="POST")
            try:
                with urlopen(request, timeout=10) as response:
                    print(response.status, response.read().decode())
            except HTTPError as exc:
                print("HTTP ����", exc.code, exc.read().decode(errors="replace"))
                if args.once:
                    raise SystemExit(1)
            except URLError:
                print("�޷����ӷ�����������״̬����ַ������")
                if args.once:
                    raise SystemExit(1)
            if args.once:
                break
            step += 1
            time.sleep(5)
    except KeyboardInterrupt:
        print("��ֹͣ�ϱ�")


if __name__ == "__main__":
    main()
