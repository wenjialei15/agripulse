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

async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && !$('key-dialog').open) $('key-dialog').showModal();
    throw new Error(body.error || `请求失败：${response.status}`);
  }
  return response;
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
  $('connection').textContent = paused ? '● 已暂停刷新' : '● 服务已连接';
  $('notice').textContent = source === 'simulator'
    ? (data.simulator_enabled ? '演示模式：数据来自模拟器，阈值仅用于软件演示，不代表实际作物需水量。' : '模拟器已关闭：当前显示已保存的演示历史；在线状态仍按最后上报时间判断。')
    : '真实设备模式：读数来自 HTTP 上报。土壤百分比需自行标定，灌溉提示须由人工结合现场情况判断。';
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
  const svg = svgEl('svg', { viewBox: '0 0 640 230', role: 'img', 'aria-label': `土壤水分趋势图，阈值 ${threshold}%，${readings.length} 条数据` });
  const left = 40, right = 622, top = 14, bottom = 188;
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
