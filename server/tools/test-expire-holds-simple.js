const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY = path.join(DATA_DIR, 'inventory_cakes_daily.json');
const CATALOG = path.join(DATA_DIR, 'inventory_cakes.json');
const RESV = path.join(DATA_DIR, 'reservations.json');
const DATE_KEY = '2026-01-27';
const PRODUCT = 'cake_choco_8';

let backupInventory = null;
let backupReservations = null;

function read(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback !== undefined ? fallback : null;
  }
}

function write(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function invPath() {
  return fs.existsSync(DAILY) ? DAILY : CATALOG;
}

function getSlot(data) {
  if (data.days && Array.isArray(data.days)) {
    const d = data.days.find((x) => (x.dateKey || '') === DATE_KEY);
    const slots = d && Array.isArray(d.slots) ? d.slots : [];
    const s = slots.find((x) => x.isAvailable !== false);
    return s ? s.startAt : null;
  }
  if (data.slots && Array.isArray(data.slots)) {
    const s = data.slots.find((x) => (x.dateKey || '') === DATE_KEY);
    return s ? s.startAt : null;
  }
  return null;
}

function reserved(inv) {
  const day = inv && inv[DATE_KEY];
  const p = day && day[PRODUCT];
  return p && typeof p.reserved === 'number' ? p.reserved : -1;
}

async function run() {
  const invPath_ = invPath();
  let inv = read(invPath_, {});
  if (typeof inv !== 'object' || inv === null || Array.isArray(inv)) inv = {};
  backupInventory = JSON.parse(JSON.stringify(inv));

  let resv = read(RESV, []);
  if (!Array.isArray(resv)) resv = [];
  backupReservations = JSON.parse(JSON.stringify(resv));
  if (!fs.existsSync(RESV)) write(RESV, resv);

  if (!inv[DATE_KEY]) inv[DATE_KEY] = {};
  inv[DATE_KEY][PRODUCT] = { available: 5, reserved: 0 };
  write(DAILY, inv);

  const availR = await fetch(BASE + '/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 14, items: [{ productId: PRODUCT, qty: 1 }] })
  });
  const avail = await availR.json().catch(() => ({}));
  const slotStartAt = getSlot(avail);
  if (!slotStartAt) {
    console.log('SKIP: no hay slots para 2026-01-27');
    return 2;
  }

  const holdR = await fetch(BASE + '/api/reservations/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slotStartAt,
      items: [{ productId: PRODUCT, qty: 1 }],
      customer: { name: 'Pedro', email: 'pedro@test.com', phone: '8090000000' }
    })
  });
  const holdData = await holdR.json().catch(() => ({}));
  const reservationId = holdData.reservationId || null;
  if (!holdR.ok || !reservationId) {
    console.log('FAIL: hold failed');
    return 1;
  }

  inv = read(DAILY, {});
  if (reserved(inv) !== 1) {
    console.log('FAIL: reserved != 1 after hold');
    return 1;
  }

  resv = read(RESV, []);
  const r = resv.find((x) => (x.id || '') === reservationId);
  if (!r) {
    console.log('FAIL: reservation not found');
    return 1;
  }
  r.holdExpiresAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  r.status = 'HELD';
  write(RESV, resv);

  const expireR = await fetch(BASE + '/api/reservations/expire', { method: 'POST' });
  if (!expireR.ok) {
    console.log('FAIL: expire failed');
    return 1;
  }

  resv = read(RESV, []);
  const r2 = resv.find((x) => (x.id || '') === reservationId);
  inv = read(DAILY, {});
  const ok = r2 && (r2.status || '') === 'EXPIRED' && reserved(inv) === 0;
  if (ok) console.log('PASS: expired, reserved=0');
  else console.log('FAIL: status=' + (r2 ? r2.status : '?') + ' reserved=' + reserved(inv));
  return ok ? 0 : 1;
}

(async function () {
  let code = 1;
  try {
    code = await run();
  } catch (e) {
    console.log('FAIL: ' + (e.message || 'error'));
    code = 1;
  } finally {
    if (backupInventory != null) {
      try { write(DAILY, backupInventory); } catch (_) {}
    }
    if (backupReservations != null) {
      try { write(RESV, backupReservations); } catch (_) {}
    }
  }
  process.exit(code);
})();
