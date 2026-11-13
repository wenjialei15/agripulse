// Browser-only demo transport. No fetch, telemetry ingestion or credentials.
const demoZones = [
  { id: 'greenhouse-a', name: '温室 A · 番茄', moisture_min: 35 },
  { id: 'greenhouse-b', name: '温室 B · 叶菜', moisture_min: 35 },
  { id: 'field-c', name: '露天 C · 玉米', moisture_min: 35 },
];
const demoHistory = new Map(demoZones.map(z => [z.id, []]));
const demoStart = Date.now();
let demoStep = -1;
function demoReading(zone, index, step, timestamp) {
  const wave = Math.sin(step / 8 + index);
  const round = value => Math.round(value * 10) / 10;
  return { id: step * 3 + index + 1, zone_id: zone.id, device_id: `demo-${String(index + 1).padStart(2, '0')}`,
    temperature: round(24 + index * 1.8 + wave * 2), humidity: round(68 - index * 4 - wave * 4),
    soil_moisture: round([48, 39, 27][index] + wave * 4), light: Math.round(18000 + index * 9000 + wave * 2500),
    battery: 92 - index * 8, source: 'simulator', recorded_at: new Date(timestamp).toISOString(),
    last_seen: new Date(timestamp).toISOString(), has_reading: true };
}
for (let step = 0; step < 60; step++) {
  demoZones.forEach((zone, i) => demoHistory.get(zone.id).push(demoReading(zone, i, step, demoStart - (60 - step) * 60000)));
}
function updateDemo() {
  const step = 60 + Math.floor((Date.now() - demoStart) / 5000);
  if (step === demoStep) return;
  demoStep = step;
  demoZones.forEach((zone, i) => {
    const rows = demoHistory.get(zone.id);
    rows.push(demoReading(zone, i, step, Date.now()));
    if (rows.length > 120) rows.splice(0, rows.length - 120);
  });
}
async function request(path, options = {}) {
  updateDemo();
  const url = new URL(path, 'https://demo.invalid');
  const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/api/threshold') {
    const payload = JSON.parse(options.body);
    const zone = demoZones.find(z => z.id === payload.zone_id);
    if (!zone || !Number.isFinite(payload.moisture_min) || payload.moisture_min < 5 || payload.moisture_min > 90) throw new Error('无效演示阈值');
    zone.moisture_min = payload.moisture_min;
    return json({ ok: true });
  }
  const source = url.searchParams.get('source') || 'simulator';
  if (source !== 'simulator') throw new Error('GitHub Pages 仅提供浏览器模拟演示，请在本地运行 Python 服务接入真实设备');
  if (url.pathname === '/api/summary') {
    const devices = demoZones.map(zone => {
      const rows = demoHistory.get(zone.id);
      const row = rows[rows.length - 1];
      const warning = row.soil_moisture < zone.moisture_min;
      return { ...row, online: true, age_seconds: 0, advice: {
        level: warning ? 'warning' : 'ok', title: warning ? '建议检查土壤水分' : '水分读数在设定范围内',
        reason: `模拟读数 ${row.soil_moisture.toFixed(1)}%，${warning ? '低于' : '未低于'}浏览器演示阈值 ${zone.moisture_min}%。此提示不代表真实农艺建议。`,
      } };
    });
    return json({ devices, zones: demoZones, source: 'simulator', simulator_enabled: true, generated_at: new Date().toISOString() });
  }
  const zone = url.searchParams.get('zone') || demoZones[0].id;
  const rows = demoHistory.get(zone);
  if (!rows) throw new Error('未知演示地块');
  if (url.pathname === '/api/history') return json({ readings: rows });
  if (url.pathname === '/api/export.csv') {
    const fields = ['id','zone_id','device_id','temperature','humidity','soil_moisture','light','battery','source','recorded_at'];
    const csv = '\ufeff' + [fields.join(','), ...rows.map(r => fields.map(f => r[f]).join(','))].join('\r\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  }
  throw new Error('此功能需要本地 Python 服务');
}

