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
    throw new Error(body.error || `����ʧ�ܣ�${response.status}`);
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
  const mean = (key) => online.length ? (online.reduce((sum, d) => sum + d[key], 0) / online.length).toFixed(1) : '��';
  $('temperature').textContent = mean('temperature');
  $('humidity').textContent = mean('humidity');
  $('moisture').textContent = mean('soil_moisture');
  $('online').textContent = `${online.length} / ${data.devices.length}`;
  $('device-count').textContent = String(data.devices.length);
  $('online-foot').textContent = `${data.devices.filter((d) => d.advice.level === 'warning').length} ��ˮ����ʾ �� ${data.devices.length - online.length} ̨����`;
  $('updated').textContent = `������ ${new Date(data.generated_at).toLocaleTimeString('zh-CN', { hour12: false })}`;
  $('connection').textContent = paused ? '�� ����ͣˢ��' : '�� ����������';
  $('notice').textContent = source === 'simulator'
    ? (data.simulator_enabled ? '��ʾģʽ����������ģ��������ֵ������������ʾ��������ʵ��������ˮ����' : 'ģ�����ѹرգ���ǰ��ʾ�ѱ������ʾ��ʷ������״̬�԰�����ϱ�ʱ���жϡ�')
    : '��ʵ�豸ģʽ���������� HTTP �ϱ��������ٷֱ������б궨�������ʾ�����˹�����ֳ�����жϡ�';
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
    state.append(el('span', d.online ? 'status' : 'status offline', d.online ? '�� ����' : '�� ����'));
    row.append(identity, state, el('td', '', `${d.temperature.toFixed(1)} ��`), el('td', '', `${d.humidity.toFixed(1)}%`), el('td', d.advice.level === 'warning' ? 'low' : '', `${d.soil_moisture.toFixed(1)}%`), el('td', '', `${Math.round(d.light).toLocaleString()} lx`), el('td', '', `${d.battery.toFixed(0)}%`));
    $('device-rows').append(row);
  }
  $('empty').hidden = data.devices.length > 0;
  $('empty').textContent = source === 'device' ? '������ʵ�豸���ݡ��� README �� HTTP ʾ���ϱ����豸����������' : '������ʾ���ݡ���������ʱ����ģ�����������ɡ�';
  $('advice-list').replaceChildren();
  const selected = data.devices.filter((d) => d.zone_id === zone.id);
  if (!selected.length) $('advice-list').append(el('p', 'advice-empty', '��ǰ�ؿ������豸���ݡ�'));
  for (const d of selected) {
    const card = el('article', `advice-card ${d.advice.level}`);
    card.append(el('h3', '', `${d.device_id} �� ${d.advice.title}`), el('p', '', d.advice.reason));
    $('advice-list').append(card);
  }
}

function renderChart(readings, threshold) {
  const container = $('chart');
  container.replaceChildren();
  if (!readings.length) {
    container.append(el('div', 'chart-empty', '������ʷ���ݣ��ȴ��豸�ϱ���'));
    return;
  }
  const svg = svgEl('svg', { viewBox: '0 0 640 230', role: 'img', 'aria-label': `����ˮ������ͼ����ֵ ${threshold}%��${readings.length} ������` });
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
    dot.append(svgEl('title', {}, `${device}��${p.soil_moisture}%`));
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
    $('connection').textContent = '�� �����ж�';
    $('error').textContent = `${error.message}��ҳ�汣�����һ�γɹ���ȡ�����ݣ�����������ӡ�`;
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
    for (const id of ['temperature', 'humidity', 'moisture', 'online']) $(id).textContent = '��';
    $('device-rows').replaceChildren();
    $('advice-list').replaceChildren();
    $('chart').replaceChildren(el('div', 'chart-empty', '���ڼ�����ѡ������Դ��'));
    $('device-count').textContent = '0';
    $('online-foot').textContent = '�ȴ���ǰ��Դ������';
    $('notice').textContent = source === 'device' ? '���ڼ�����ʵ�豸���ݡ�' : '���ڼ���ģ����ʾ���ݡ�';
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
  $('pause').textContent = paused ? '����ˢ��' : '��ͣˢ��';
  $('connection').textContent = paused ? '�� ����ͣˢ��' : '�������ӡ�';
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
    button.textContent = '�ѱ���';
    generation++;
    await refresh(true);
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
  } finally {
    button.disabled = false;
    setTimeout(() => { savedNotice = ''; button.textContent = '������ֵ'; }, 1800);
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
