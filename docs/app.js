'use strict';
const $ = (id) => document.getElementById(id);
let source = 'simulator';
let apiKey = '';
let paused = false;
let loading = false;
let generation = 0;
let summary = null;
let savedNotice = '';
const ns = 'http://www.w3.org/2000/svg';

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


function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs, text) {
  const node = document.createElementNS(ns, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSummary(data) {
  const online = data.devices.filter((d) => d.online);
  const mean = (key) => online.length ? (online.reduce((sum, d) => sum + d[key], 0) / online.length).toFixed(1) : '—';
  $('temperature').textContent = mean('temperature');
  $('humidity').textContent = mean('humidity');
  $('moisture').textContent = mean('soil_moisture');
  $('online').textContent = `${online.length} / ${data.devices.length}`;
  $('device-count').textContent = String(data.devices.length);
  $('online-foot').textContent = `${data.devices.filter((d) => d.advice.level === 'warning').length} 条水分提示 · ${data.devices.length - online.length} 台离线`;
  $('updated').textContent = `更新于 ${new Date(data.generated_at).toLocaleTimeString('zh-CN', { hour12: false })}`;
  $('connection').textContent = paused ? '● 已暂停刷新' : '● 浏览器模拟演示';
  $('notice').textContent = 'GitHub Pages 浏览器模拟演示：所有读数均为合成数据，阈值修改仅在当前页面有效。真实设备接入和 SQLite 存储请在本地运行 Python 服务。';
  const zoneNames = Object.fromEntries(data.zones.map((z) => [z.id, z.name]));
  const zone = data.zones.find((z) => z.id === $('zone').value);
  if (document.activeElement !== $('threshold') && !savedNotice) $('threshold').value = zone.moisture_min;
  $('threshold-label').textContent = `${zone.moisture_min}%`;
  $('device-rows').replaceChildren();
  for (const d of data.devices) {
    const row = el('tr');
    const identity = el('td');
    identity.append(el('span', 'device-id', d.device_id), el('span', 'device-zone', zoneNames[d.zone_id]));
    const state = el('td');
    state.append(el('span', d.online ? 'status' : 'status offline', d.online ? '● 在线' : '○ 离线'));
    row.append(identity, state, el('td', '', `${d.temperature.toFixed(1)} ℃`), el('td', '', `${d.humidity.toFixed(1)}%`), el('td', d.advice.level === 'warning' ? 'low' : '', `${d.soil_moisture.toFixed(1)}%`), el('td', '', `${Math.round(d.light).toLocaleString()} lx`), el('td', '', `${d.battery.toFixed(0)}%`));
    $('device-rows').append(row);
  }
  $('empty').hidden = data.devices.length > 0;
  $('empty').textContent = source === 'device' ? '尚无真实设备数据。按 README 的 HTTP 示例上报后，设备会出现在这里。' : '暂无演示数据。启动服务时启用模拟器即可生成。';
  $('advice-list').replaceChildren();
  const selected = data.devices.filter((d) => d.zone_id === zone.id);
  if (!selected.length) $('advice-list').append(el('p', 'advice-empty', '当前地块暂无设备数据。'));
  for (const d of selected) {
    const card = el('article', `advice-card ${d.advice.level}`);
    card.append(el('h3', '', `${d.device_id} · ${d.advice.title}`), el('p', '', d.advice.reason));
    $('advice-list').append(card);
  }
}

function renderChart(readings, threshold) {
  const container = $('chart');
  container.replaceChildren();
  if (!readings.length) {
    container.append(el('div', 'chart-empty', '暂无历史数据，等待设备上报。'));
    return;
  }
  const svg = svgEl('svg', { viewBox: `0 0 ${Math.max(300, Math.min(640, container.clientWidth - 32))} 230`, role: 'img', 'aria-label': `土壤水分趋势图，阈值 ${threshold}%，${readings.length} 条数据` });
  const left = 40, right = Math.max(300, Math.min(640, container.clientWidth - 32)) - 18, top = 14, bottom = 188;
  const times = readings.map((r) => new Date(r.recorded_at).getTime());
  const first = Math.min(...times), last = Math.max(...times);
  const x = (time) => first === last ? (left + right) / 2 : left + (time - first) / (last - first) * (right - left);
  const y = (v) => bottom - v / 100 * (bottom - top);
  for (const tick of [0, 25, 50, 75, 100]) {
    svg.append(svgEl('line', { x1: left, y1: y(tick), x2: right, y2: y(tick), stroke: '#edf0e7' }));
    svg.append(svgEl('text', { x: left - 10, y: y(tick) + 4, 'text-anchor': 'end' }, tick));
  }
  svg.append(svgEl('line', { x1: left, y1: y(threshold), x2: right, y2: y(threshold), stroke: '#c3a36c', 'stroke-dasharray': '5 5' }));
  const groups = new Map();
  for (const r of readings) {
    if (!groups.has(r.device_id)) groups.set(r.device_id, []);
    groups.get(r.device_id).push(r);
  }
  const colors = ['#61894b', '#4d8e9c', '#aa8847', '#8b74a3'];
  [...groups.entries()].forEach(([device, points], index) => {
    points.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    const color = colors[index % colors.length];
    const poly = svgEl('polyline', { points: points.map((r) => `${x(new Date(r.recorded_at).getTime())},${y(r.soil_moisture)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    poly.append(svgEl('title', {}, device));
    svg.append(poly);
    const p = points[points.length - 1];
    const dot = svgEl('circle', { cx: x(new Date(p.recorded_at).getTime()), cy: y(p.soil_moisture), r: 4, fill: color, stroke: 'white', 'stroke-width': 2 });
    dot.append(svgEl('title', {}, `${device}：${p.soil_moisture}%`));
    svg.append(dot);
  });
  for (const [time, anchor] of [[first, 'start'], [last, 'end']]) {
    svg.append(svgEl('text', { x: x(time), y: 215, 'text-anchor': anchor }, new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })));
  }
  container.append(svg);
}

async function refresh(force = false) {
  if (paused && !force) return;
  if (loading) { if (force) generation++; return; }
  loading = true;
  const currentGeneration = generation;
  const currentSource = source;
  const zoneId = $('zone').value;
  try {
    const [data, history] = await Promise.all([
      request(`/api/summary?source=${currentSource}`).then((r) => r.json()),
      request(`/api/history?zone=${encodeURIComponent(zoneId)}&source=${currentSource}`).then((r) => r.json()),
    ]);
    if (currentGeneration !== generation || currentSource !== source || zoneId !== $('zone').value) return;
    summary = data;
    renderSummary(data);
    renderChart(history.readings, data.zones.find((z) => z.id === zoneId).moisture_min);
    $('error').hidden = true;
  } catch (error) {
    if (currentGeneration !== generation) return;
    $('connection').textContent = '○ 连接中断';
    $('error').textContent = `${error.message}。页面保留最后一次成功读取的数据，请检查服务连接。`;
    $('error').hidden = false;
  } finally {
    loading = false;
    if (currentGeneration !== generation) refresh(true);
  }
}

document.querySelectorAll('[data-source]').forEach((button) => {
  button.addEventListener('click', () => {
    if (source === button.dataset.source) return;
    source = button.dataset.source;
    generation++;
    summary = null;
    // Clear old-source readings immediately, even if the next fetch fails.
    for (const id of ['temperature', 'humidity', 'moisture', 'online']) $(id).textContent = '—';
    $('device-rows').replaceChildren();
    $('advice-list').replaceChildren();
    $('chart').replaceChildren(el('div', 'chart-empty', '正在加载所选数据来源…'));
    $('device-count').textContent = '0';
    $('online-foot').textContent = '等待当前来源的数据';
    $('notice').textContent = source === 'device' ? '正在加载真实设备数据…' : '正在加载模拟演示数据…';
    document.querySelectorAll('[data-source]').forEach((b) => {
      b.classList.toggle('selected', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    refresh(true);
  });
});
$('zone').addEventListener('change', () => { generation++; savedNotice = ''; refresh(true); });
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? '继续刷新' : '暂停刷新';
  $('connection').textContent = paused ? '● 已暂停刷新' : '正在连接…';
  if (!paused) refresh(true);
});
$('threshold-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const value = Number($('threshold').value);
  if (!Number.isFinite(value) || value < 5 || value > 90) return;
  button.disabled = true;
  try {
    await request('/api/threshold', { method: 'POST', body: JSON.stringify({ zone_id: $('zone').value, moisture_min: value }) });
    savedNotice = 'saved';
    button.textContent = '已保存';
    generation++;
    await refresh(true);
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
  } finally {
    button.disabled = false;
    setTimeout(() => { savedNotice = ''; button.textContent = '保存阈值'; }, 1800);
  }
});
$('export').addEventListener('click', async () => {
  $('export').disabled = true;
  try {
    const response = await request(`/api/export.csv?zone=${encodeURIComponent($('zone').value)}&source=${source}`);
    const url = URL.createObjectURL(await response.blob());
    const link = el('a');
    link.href = url;
    link.download = `agripulse-${$('zone').value}-${source}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
  } finally { $('export').disabled = false; }
});
$('key-button').addEventListener('click', () => $('key-dialog').showModal());
$('cancel-key').addEventListener('click', () => $('key-dialog').close());
$('key-form').addEventListener('submit', (event) => {
  event.preventDefault();
  apiKey = $('api-key').value;
  $('api-key').value = '';
  $('key-dialog').close();
  generation++;
  refresh(true);
});
document.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a === link));
}));
refresh();
setInterval(() => refresh(), 5000);
