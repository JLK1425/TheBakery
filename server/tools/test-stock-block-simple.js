const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY = path.join(DATA_DIR, 'inventory_cakes_daily.json');
const CATALOG = path.join(DATA_DIR, 'inventory_cakes.json');
const DATE_KEY = '2026-01-26';
const PRODUCT = 'cake_choco_8';

let backup = null;
let modified = false;

function read(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {};
  }
}

function write(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function invPath() {
  return fs.existsSync(DAILY) ? DAILY : CATALOG;
}

function slotsForDateKey(data) {
  if (data.days && Array.isArray(data.days)) {
    const d = data.days.find((x) => (x.dateKey || '') === DATE_KEY);
    return d && Array.isArray(d.slots) ? d.slots : [];
  }
  if (data.slots && Array.isArray(data.slots)) {
    return data.slots.filter((s) => (s.dateKey || '') === DATE_KEY);
  }
  return [];
}

function totalSlots(data) {
  if (data.days && Array.isArray(data.days)) {
    return data.days.reduce((n, d) => n + (Array.isArray(d.slots) ? d.slots.length : 0), 0);
  }
  return (data.slots && data.slots.length) || 0;
}

async function main() {
  const p = invPath();
  let inv = read(p);
  if (typeof inv !== 'object' || inv === null || Array.isArray(inv)) inv = {};

  backup = JSON.parse(JSON.stringify(inv));
  if (!inv[DATE_KEY]) inv[DATE_KEY] = {};
  inv[DATE_KEY][PRODUCT] = { available: 0, reserved: 0 };
  write(DAILY, inv);
  modified = true;

  const r = await fetch('http://localhost:3000/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 14, items: [{ productId: PRODUCT, qty: 1 }] })
  });
  const data = await r.json().catch(() => ({}));
  const slots = slotsForDateKey(data);
  const total = totalSlots(data);
  const pass = slots.length === 0;

  if (pass) {
    console.log('PASS: dateKey 2026-01-26 bloqueado');
  } else {
    console.log('FAIL: dateKey 2026-01-26 sigue disponible');
  }
  console.log('Slots totales API: ' + total);

  return { pass, total };
}

(async function run() {
  try {
    const out = await main();
    if (modified && backup != null) {
      try { write(DAILY, backup); } catch (_) {}
    }
    process.exit(out.pass ? 0 : 1);
  } catch (e) {
    if (modified && backup != null) {
      try { write(DAILY, backup); } catch (_) {}
    }
    console.error(e.message);
    process.exit(1);
  }
})();
