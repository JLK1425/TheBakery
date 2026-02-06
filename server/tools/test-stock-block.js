/**
 * Test: calendario respeta stock diario.
 * Pone stock=0 para cake_choco_8 en un dateKey, llama /api/availability,
 * verifica que ese dateKey no tenga slots. Restaura inventario al final.
 *
 * Node 18+ fetch. Ejecutar: node server/tools/test-stock-block.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY_FILE = path.join(DATA_DIR, 'inventory_cakes_daily.json');
const CATALOG_FILE = path.join(DATA_DIR, 'inventory_cakes.json');
const DEFAULT_FALLBACK = {};
const REPORT_FILE = path.join(__dirname, 'test-stock-block-report.md');
const TARGET_PRODUCT = 'cake_choco_8';
const AVAILABILITY_BODY = { days: 14, items: [{ productId: TARGET_PRODUCT, qty: 1 }] };

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2);
  const json = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      fs.renameSync(tmp, filePath);
    } catch (renameErr) {
      fs.writeFileSync(filePath, json, 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function tomorrowRD() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function slotsForDateKey(data, dateKey) {
  if (!data) return [];
  if (Array.isArray(data.days)) {
    const day = data.days.find(function (d) { return (d.dateKey || '') === dateKey; });
    return day && Array.isArray(day.slots) ? day.slots : [];
  }
  if (Array.isArray(data.slots)) {
    return data.slots.filter(function (s) { return (s.dateKey || '') === dateKey; });
  }
  return [];
}

function pickDateKeyFromAvailability(data) {
  if (Array.isArray(data.days)) {
    for (let i = 0; i < data.days.length; i++) {
      const day = data.days[i];
      const dk = day.dateKey || '';
      if (!dk || day.isClosed) continue;
      const slots = day.slots || [];
      if (slots.length) return dk;
    }
    return null;
  }
  if (Array.isArray(data.slots) && data.slots.length) {
    const s = data.slots[0];
    return (s && s.dateKey) ? s.dateKey : null;
  }
  return null;
}

function snippetForDateKey(data, dateKey) {
  if (!data) return { format: 'unknown', value: null };
  if (Array.isArray(data.days)) {
    const day = data.days.find(function (d) { return (d.dateKey || '') === dateKey; });
    return { format: 'days', value: day ? { dateKey: day.dateKey, isClosed: day.isClosed, reason: day.reason, slots: day.slots } : null };
  }
  if (Array.isArray(data.slots)) {
    const list = data.slots.filter(function (s) { return (s.dateKey || '') === dateKey; });
    return { format: 'slots', value: list };
  }
  return { format: 'unknown', value: null };
}

async function fetchAvailability() {
  const r = await fetch(BASE + '/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(AVAILABILITY_BODY)
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('availability response not JSON: ' + text.slice(0, 200));
  }
  if (!r.ok) {
    throw new Error((data.error || data.message || r.statusText) + ' (status ' + r.status + ')');
  }
  return data;
}

async function run() {
  let backup = null;
  let modified = false;
  let dateKey = null;
  let pass = false;
  let availabilityResponse = null;
  let snippet = null;

  const invPath = fs.existsSync(DAILY_FILE) ? DAILY_FILE : CATALOG_FILE;
  let inv = readJson(invPath, DEFAULT_FALLBACK);
  if (typeof inv !== 'object' || inv === null || Array.isArray(inv)) inv = {};

  try {
    const initial = await fetchAvailability();
    dateKey = pickDateKeyFromAvailability(initial);
    if (!dateKey) {
      dateKey = tomorrowRD();
      console.log('No dateKey from availability; using tomorrow (RD): ' + dateKey);
    } else {
      console.log('dateKey from availability: ' + dateKey);
    }

    backup = JSON.parse(JSON.stringify(inv));
    if (!inv[dateKey]) inv[dateKey] = {};
    inv[dateKey][TARGET_PRODUCT] = { available: 0, reserved: 0 };
    writeJsonAtomic(DAILY_FILE, inv);
    modified = true;

    availabilityResponse = await fetchAvailability();
    const slots = slotsForDateKey(availabilityResponse, dateKey);
    pass = slots.length === 0;

    if (pass) {
      console.log('PASS: dateKey bloqueado por stock=0');
    } else {
      console.log('FAIL: dateKey sigue disponible con stock=0');
    }

    const s = snippetForDateKey(availabilityResponse, dateKey);
    snippet = s.value !== null ? s.value : (s.format === 'days' ? { note: 'day not found in response', dateKey } : { note: 'no slots/days for dateKey', dateKey });
  } catch (e) {
    console.error('Error:', e.message);
    if (availabilityResponse && dateKey) {
      const s = snippetForDateKey(availabilityResponse, dateKey);
      snippet = s.value !== null ? s.value : { note: 'day/slots not in response', dateKey, error: e.message };
    } else {
      snippet = { error: e.message, dateKey: dateKey || '(n/a)' };
    }
    pass = false;
    if (!dateKey) dateKey = tomorrowRD();
  } finally {
    if (modified && backup) {
      writeJsonAtomic(DAILY_FILE, backup);
      console.log('Inventario restaurado.');
    }
  }

  const result = pass ? 'PASS' : 'FAIL';
  const report = [
    '# Test stock block',
    '',
    '## dateKey probado',
    dateKey || '(n/a)',
    '',
    '## Resultado',
    result + (pass ? ': dateKey bloqueado por stock=0' : ': dateKey sigue disponible con stock=0'),
    '',
    '## Snippet (slots/days para ese dateKey)',
    '```json',
    JSON.stringify(snippet, null, 2),
    '```',
    ''
  ].join('\n');

  fs.writeFileSync(REPORT_FILE, report, 'utf8');
  console.log('Reporte: ' + REPORT_FILE);
  return { pass, dateKey, result };
}

run().then(function (out) {
  process.exit(out.pass ? 0 : 1);
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
