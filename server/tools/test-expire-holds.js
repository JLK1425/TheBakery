const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY = path.join(DATA_DIR, 'inventory_cakes_daily.json');
const CATALOG = path.join(DATA_DIR, 'inventory_cakes.json');
const RESV_FILE = path.join(DATA_DIR, 'reservations.json');
const DATE_KEY = '2026-01-27';
const PRODUCT = 'cake_choco_8';

let invBackup = null;
let resvBackup = null;
let invModified = false;
let resvModified = false;

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

function getSlotForDateKey(data) {
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

function reservedNow(inv) {
  const day = inv && inv[DATE_KEY];
  const p = day && day[PRODUCT];
  return p && typeof p.reserved === 'number' ? p.reserved : -1;
}

async function main() {
  const allPass = [];

  const invPath_ = invPath();
  let inv = read(invPath_, {});
  if (typeof inv !== 'object' || inv === null || Array.isArray(inv)) inv = {};
  invBackup = JSON.parse(JSON.stringify(inv));
  if (!inv[DATE_KEY]) inv[DATE_KEY] = {};
  inv[DATE_KEY][PRODUCT] = { available: 5, reserved: 0 };
  write(DAILY, inv);
  invModified = true;

  let resv = read(RESV_FILE, []);
  if (!Array.isArray(resv)) resv = [];
  resvBackup = JSON.parse(JSON.stringify(resv));

  const availRes = await fetch(BASE + '/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 14, items: [{ productId: PRODUCT, qty: 1 }] })
  });
  const avail = await availRes.json().catch(() => ({}));
  const slotStartAt = getSlotForDateKey(avail);
  if (!slotStartAt) {
    console.log('FAIL: no slot for ' + DATE_KEY + ' in availability');
    return { allPass: false };
  }

  const holdRes = await fetch(BASE + '/api/reservations/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slotStartAt,
      items: [{ productId: PRODUCT, qty: 1 }],
      customer: { name: 'Pedro', email: 'pedro@test.com', phone: '8090000000' }
    })
  });
  const holdData = await holdRes.json().catch(() => ({}));
  const reservationId = holdData.reservationId || null;
  if (!holdRes.ok || !reservationId) {
    console.log('FAIL: hold failed ' + (holdData.error || holdRes.status));
    return { allPass: false };
  }

  inv = read(DAILY, {});
  const r1 = reservedNow(inv);
  const passHold = r1 === 1;
  allPass.push(passHold);
  console.log(passHold ? 'PASS: reserved=1 after hold' : 'FAIL: reserved=' + r1 + ' after hold (expected 1)');

  resv = read(RESV_FILE, []);
  const res = resv.find((r) => (r.id || '') === reservationId);
  if (!res) {
    console.log('FAIL: reservation not found ' + reservationId);
    return { allPass: false };
  }
  const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
  res.holdExpiresAt = expiredAt;
  res.status = 'HELD';
  write(RESV_FILE, resv);
  resvModified = true;

  const expireRes = await fetch(BASE + '/api/reservations/expire', { method: 'POST' });
  const expireData = await expireRes.json().catch(() => ({}));
  if (!expireRes.ok || (expireData.expiredCount !== undefined && expireData.expiredCount < 1)) {
    console.log('FAIL: expire failed or expiredCount<1');
    allPass.push(false);
  } else {
    allPass.push(true);
    console.log('PASS: expire returned ok');
  }

  resv = read(RESV_FILE, []);
  const resAfter = resv.find((r) => (r.id || '') === reservationId);
  const passStatus = resAfter && (resAfter.status || '') === 'EXPIRED';
  allPass.push(passStatus);
  console.log(passStatus ? 'PASS: reservation status=EXPIRED' : 'FAIL: status=' + (resAfter ? resAfter.status : '?') + ' (expected EXPIRED)');

  inv = read(DAILY, {});
  const r2 = reservedNow(inv);
  const passReleased = r2 === 0;
  allPass.push(passReleased);
  console.log(passReleased ? 'PASS: reserved=0 after expire' : 'FAIL: reserved=' + r2 + ' after expire (expected 0)');

  return { allPass: allPass.every(Boolean) };
}

(async function run() {
  try {
    const out = await main();
    if (invModified && invBackup != null) {
      try { write(DAILY, invBackup); } catch (_) {}
    }
    if (resvModified && resvBackup != null) {
      try { write(RESV_FILE, resvBackup); } catch (_) {}
    }
    process.exit(out.allPass ? 0 : 1);
  } catch (e) {
    if (invModified && invBackup != null) {
      try { write(DAILY, invBackup); } catch (_) {}
    }
    if (resvModified && resvBackup != null) {
      try { write(RESV_FILE, resvBackup); } catch (_) {}
    }
    console.error(e.message);
    process.exit(1);
  }
})();
