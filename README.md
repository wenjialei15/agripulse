# AgriPulse ??

**��������ݣ��м���ѭ��** һ������Ӳ��Ҳ�����е�ũҵ��������Դ��Ŀ��

AgriPulse is a hardware-optional agriculture IoT starter: a live dashboard, validated HTTP telemetry ingestion, SQLite history and explainable soil-moisture hints. Built with Python's standard library and vanilla JavaScript. No cloud account, frontend build or third-party runtime dependency required.

**״̬��v0.1.0 / ������ MVP** �� **ά���ߣ�[wenjialei15](https://github.com/wenjialei15)** �� **Э�飺[MIT](LICENSE)**

## Ϊʲô�������Ŀ

ũҵ���������ų�������Ӳ������ƽ̨���û��Ӳ����ϡ�AgriPulse �ӿ����е���С��·������**�ɼ� �� �洢 �� ���ӻ� �� �ɽ�����ʾ**������ģ�����������̣��ٰ�ģ���������Լ����豸��

- **��Ӳ����������**��3 ��ģ��ؿ飬�״���������Լ 1 Сʱ��ʷ��֮��ÿ 5 ��ˢ�¡�
- **��ʾ���ֳ���ȷ�ֿ�**���л���ģ����ʾ / ��ʵ�豸����������Դ�ֱ��ѯ�͵�����
- **�������ڱ���**��SQLite �־û���Ĭ�ϱ������ 30 �죻�ɵ�����ǰ�ؿ顢��ǰ��Դ��� 10000 �� CSV ���ݡ�
- **������Խ���**��ÿ��ؿɵ�������ˮ����ֵ��ҳ��չʾ����ԭ�������豸�����ɹ����ʾ��
- **��ʵ����·��**��У����� JSON HTTP �ϱ��ӿڣ��ṩ Python �豸ʾ����ESP32 ���豸�ɰ���ͬЭ��Խӡ�
- **������Ӧʽ����**�����¡�����ʪ�ȡ��������������ա�����������״̬����ʷ���ơ�

## 30 ������

��Ҫ Python **3.9+**������ʹ������֧�ֵ� Python �汾��3.9 �����������л������������в���Ҫ `pip install`��

```bash
git clone https://github.com/wenjialei15/agripulse.git
cd agripulse
python -m agripulse
```

������� **http://127.0.0.1:8000**��Windows ����� `python` �����ã��ɽ������е� `python` ���� `py`��

�״����������� 3 �������豸��Ĭ��������ֵΪ 35%��¶�� C ����ʾ����ͨ��������ֵ������ֱ�ӿ�����ʾ��

```bash
# ֻ����ʵ�豸���ر�ģ����
python -m agripulse --no-simulator

# �Զ���˿������ݿ�·��
python -m agripulse --port 8080 --db data/my-farm.db
```

## �ϱ�һ���豸����

�����������ٴ򿪵ڶ����նˣ�

```bash
python examples/send_reading.py --once
```

�ڿ����л��� **��ʵ�豸**��ѡ�� **���� A**������ `--once` ��ÿ 5 �뷢��һ��ʾ�����ݡ�����ű����ɲ��Զ�������ʵ����������ʱ���滻����������

JSON Э��ʾ����

```json
{
  "zone_id": "greenhouse-a",
  "device_id": "esp32-01",
  "temperature": 25.6,
  "humidity": 68.2,
  "soil_moisture": 31.5,
  "light": 18600,
  "battery": 88
}
```

| �ֶ� | ��Χ / ���� |
| --- | --- |
| `zone_id` | `greenhouse-a`��`greenhouse-b`��`field-c` |
| `device_id` | 1�C64 λ��ĸ�����֡�`-`��`_`������ĸ�����ֿ�ͷ��ͬһ ID ���ɿ�ؿ����Դ���� |
| `temperature` | -40�C85 �� |
| `humidity` | 0�C100% |
| `soil_moisture` | 0�C100%���豸���б궨����Զ��� |
| `light` | 0�C200000 lx |
| `battery` | 0�C100% |

�����ֶα�������� NaN��Infinity���ַ����򲼶�ֵ��Ϊ����ֵ������ʱ���ɷ��������ɣ��豸�ύ�� `source` ��ʱ���ֶβ��Ḳ�Ƿ�������¼��HTTP ���յ�����һ�ɱ��Ϊ `device`��

## API

| ���� | ·�� | ˵�� |
| --- | --- | --- |
| GET | `/api/health` | �汾��ģ����״̬�������Ȩ |
| GET | `/api/summary?source=device` | ��ǰ�豸������״̬��������ʾ���ؿ���ֵ |
| GET | `/api/history?zone=greenhouse-a&source=device` | ��ǰ�ؿ���� 120 ����¼�������˳�򷵻� |
| GET | `/api/export.csv?zone=greenhouse-a&source=device` | ��ǰ�ؿ���� 10000 ����¼��UTF-8 CSV |
| POST | `/api/telemetry` | �ϱ����� JSON���ɹ����� 201 ���¼ ID |
| POST | `/api/threshold` | `{"zone_id":"greenhouse-a","moisture_min":35}`����Χ 5�C90 |

`source` ���� `simulator` �� `device`��Ĭ�� `simulator`��д��ʱ���� `Content-Type: application/json`��API ���󷵻� `{"error":"..."}` �Ͷ�Ӧ HTTP ״̬�롣

## ���Ӿ������豸

Ĭ��ֻ���� `127.0.0.1`�����Ҫ����������������Ҫ�������� 24 �ַ������ API key��ʾ�� Python �ϱ�������ͬһ����������ȡ��Կ��

PowerShell��

```powershell
$env:AGRIPULSE_API_KEY = python -c "import secrets; print(secrets.token_urlsafe(32))"
python -m agripulse --host 0.0.0.0 --no-simulator
```

macOS / Linux��

```bash
export AGRIPULSE_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m agripulse --host 0.0.0.0 --no-simulator
```

�豸������ `Authorization: Bearer <�����Կ>`�������������������á�����ͬһ��Կ����Կ�������ڵ�ǰҳ���ڴ��У�ˢ�º��������롣�� `/api/health` ������� API ������Կ��������Կӵ�ж�дȨ�ޡ�

���ķ�������λΪ����ʵ�����ѧ���ߣ����������������񡣿����粿��Ӧʹ�� HTTPS ������������ʿ��ƺ��������ƣ����÷���û�� TLS���û�Ȩ�޷ּ������������ӹ̡���Ҫ����ʵ��Կ���������û�ũ�����ݿ��ύ�� Git��

## ��Ŀ�ṹ��ܹ�

| ·�� | ְ�� |
| --- | --- |
| `agripulse/core.py` | ����У�顢SQLite �洢��ģ��������ֵ���� |
| `agripulse/server.py` | HTTP API����Ȩ����̬�ļ�����̨ģ������ |
| `agripulse/static/` | ���ļ�⿴�壬ԭ�� HTML / CSS / JavaScript |
| `examples/send_reading.py` | �����е� HTTP �豸�ϱ�ʾ�� |
| `tests/` | �洢�������� HTTP ���ɲ��� |
| `docs/` | ·��ͼ��API ʹ�ò����빱�׷��� |

�豸��ģ����д��ͬһ�洢�㣬����Դ�ֶθ��룻�����ÿ 5 ���ȡ���ܺ���ʷ�ӿڡ����豸�����Ʒֱ���ƣ�����Ѳ�ͬ�豸�ĵ�ƴ��һ�����ߡ����� 60 ��δ�յ������ݼ���Ϊ���ߣ����߶���������ƽ��ֵ��

## ��֤

```bash
python -m unittest discover -s tests -v
```

ǰ��Ϊԭ�� JavaScript���Ѱ�װ Node.js ʱ�ɶ������﷨��

```bash
node --check agripulse/static/app.js
```

## ��ǰ�߽�

- ��ֵ��ʾ������������ʾ�����Ǿ�ũ����֤�Ĺ��ģ�ͣ�Ҳ�������ˮ�á�
- �����ٷֱ�Ϊ��Զ����������ϴ����������ʼ��ֳ������궨��Ĭ����ֵ���������Ƽ�ֵ��
- �ؿ鵱ǰ�� `core.py` �� `ZONES` �ж��壬��֧��ҳ����ɾ�ؿ顣
- �澯Ϊ��ǰ״̬��ʾ��δʵ�ֶ����澯�¼���ʷ�����Ż��ʼ�֪ͨ��
- ��ǰ֧�� HTTP ���룻MQTT��LoRaWAN��MCP �� AI �������ں����ƻ�����δʵ�֡�
- ���ݿⱸ��Ӧ��ֹͣ�������У����汾û���Զ����ݼ����ݿ�����Ǩ��ϵͳ��

## һ��������

��ӭ�����豸���䡢�궨���̡�Ӣ�Ľ��桢���Ի��ĵ��������Ķ� [CONTRIBUTING.md](CONTRIBUTING.md) �� [·��ͼ](docs/ROADMAP.md)��

��������Ŀ�����а�������ӭ Star������������ʹ�ã���ӭ����Ӳ���ͺš�����ʾ�������븴�ֲ��衣

## License

[MIT](LICENSE) ? 2026 wenjialei15
