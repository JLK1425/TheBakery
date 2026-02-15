/**
 * Módulo de reservas: helpers, slots, stock diario, mutex.
 * Stock por día en inventory_cakes_daily.json (formato YYYY-MM-DD -> productId -> {available, reserved}).
 * Horarios: schedule-config.js (weeklyDefault + dateOverrides).
 */

const fs = require('fs');
const path = require('path');
const scheduleConfig = require('../schedule-config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BUSINESS_HOURS_FILE = path.join(DATA_DIR, 'business_hours.json');
const HOLIDAYS_FILE = path.join(DATA_DIR, 'holidays.json');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');
const INVENTORY_CAKES_DAILY_FILE = path.join(DATA_DIR, 'inventory_cakes_daily.json');
const STOCK_FILE = path.join(DATA_DIR, 'stock.json');
const PRODUCT_ID_MAP_FILE = path.join(DATA_DIR, 'product_id_map.json');

const DEFAULT_BUSINESS = { timezone: 'America/Santo_Domingo', default: { open: '10:00', close: '20:00' } };
const DEFAULT_HOLIDAYS = { closed: [], specialHours: {} };
const HOLD_MINUTES = 10;
const LEAD_TIME_MS = 24 * 60 * 60 * 1000;

// ---------- Helpers ----------

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
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

function normalizeDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.trim().split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Genera slots de 1h para una fecha.
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {string} open - "HH:MM"
 * @param {string} close - "HH:MM"
 * @returns {{ startAt: string, endAt: string, dateKey: string }[]}
 */
function buildSlotsForDate(dateKey, open, close) {
  const openM = parseTimeToMinutes(open);
  const closeM = parseTimeToMinutes(close);
  const [y, m, d] = dateKey.split('-').map(Number);
  const slots = [];
  for (let mins = openM; mins < closeM; mins += 60) {
    const h = Math.floor(mins / 60);
    const min = mins % 60;
    const start = new Date(y, m - 1, d, h, min, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    slots.push({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      dateKey
    });
  }
  return slots;
}

/**
 * Slots horarios para UI grid. timezone reservado para uso futuro (luxon/Intl).
 * @param {string} dateKey
 * @param {string} open
 * @param {string} close
 * @param {string} [timezone]
 * @returns {{ startAt: string, endAt: string, dateKey: string }[]}
 */
function buildHourlySlotsForDate(dateKey, open, close, timezone) {
  // timezone reservado para uso con luxon/Intl
  if (timezone) {}
  return buildSlotsForDate(dateKey, open, close);
}

const LOCALE_RD = 'es-DO';
const TZ_RD = 'America/Santo_Domingo';
const OFFSET_RD = '-04:00';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatISOWithOffsetRD(dateKey, hour, minute) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hour)}:${pad2(minute)}:00${OFFSET_RD}`;
}

function formatHourLabelRD(dateKey, hour, minute) {
  try {
    const iso = formatISOWithOffsetRD(dateKey, hour, minute);
    const d = new Date(iso);
    return d.toLocaleTimeString(LOCALE_RD, {
      timeZone: TZ_RD,
      hour12: true,
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (e) {
    return `${pad2(hour)}:${pad2(minute)}`;
  }
}

/**
 * Genera slots para un día según la regla de schedule-config.
 * @param {string} dateKey - "YYYY-MM-DD"
 * @param {object} rule - { closed?, open?, close?, slotMinutes?, capacityPerSlot? }
 * @returns {{ startAt: string, endAt: string, hourLabel: string, available: boolean, remaining: number }[]}
 */
function buildDaySlotsFromRule(dateKey, rule) {
  if (!rule || rule.closed) return [];

  const open = rule.open || '09:00';
  const close = rule.close || '18:00';
  const slotMinutes = Math.max(15, Math.min(120, Number(rule.slotMinutes) || 60));
  const capacityPerSlot = Math.max(1, Number(rule.capacityPerSlot) || 3);

  const openM = parseTimeToMinutes(open);
  const closeM = parseTimeToMinutes(close);
  const slots = [];

  for (let mins = openM; mins + slotMinutes <= closeM; mins += slotMinutes) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const endMins = mins + slotMinutes;
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;

    const startAt = formatISOWithOffsetRD(dateKey, h, m);
    const endAt = formatISOWithOffsetRD(dateKey, eh, em);
    const hourLabel = formatHourLabelRD(dateKey, h, m);

    slots.push({
      startAt,
      endAt,
      hourLabel,
      label: hourLabel,
      available: true,
      remaining: capacityPerSlot,
      isAvailable: true
    });
  }

  return slots;
}

function isClosedDate(dateKey, holidays) {
  const h = holidays || DEFAULT_HOLIDAYS;
  const closed = h.closed || [];
  return closed.some((d) => String(d).trim() === String(dateKey).trim());
}

/**
 * @param {string} dateKey
 * @param {object} businessHours
 * @param {object} holidays
 * @returns {{ open: string, close: string, isClosed: boolean }}
 */
function getHoursForDate(dateKey, businessHours, holidays) {
  const bh = businessHours || DEFAULT_BUSINESS;
  const def = bh.default || DEFAULT_BUSINESS.default;
  let open = def.open || '10:00';
  let close = def.close || '20:00';
  const closed = isClosedDate(dateKey, holidays);
  if (closed) return { open, close, isClosed: true };
  const sh = (holidays?.specialHours || {})[dateKey];
  if (sh && typeof sh === 'object') {
    if (sh.open) open = sh.open;
    if (sh.close) close = sh.close;
  }
  return { open, close, isClosed: false };
}

/**
 * Redondea al siguiente inicio de hora. Si queda fuera del horario [open, close),
 * pasa al siguiente día a las open.
 */
function roundUpToNextHour(dateTime, open, close) {
  const d = dateTime instanceof Date ? dateTime : new Date(dateTime);
  let next = new Date(d);
  next.setMinutes(0, 0, 0);
  if (d.getMinutes() > 0 || d.getSeconds() > 0 || d.getMilliseconds() > 0) {
    next.setTime(next.getTime() + 60 * 60 * 1000);
  }
  const openM = parseTimeToMinutes(open);
  const closeM = parseTimeToMinutes(close);
  const h = next.getHours();
  const m = next.getMinutes();
  const currM = h * 60 + m;

  if (currM >= closeM || currM < openM) {
    const base = new Date(next);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + (currM >= closeM ? 1 : 0));
    base.setHours(Math.floor(openM / 60), openM % 60, 0, 0);
    return base;
  }
  return next;
}

// ---------- Data access ----------

function getBusinessHours() {
  return readJson(BUSINESS_HOURS_FILE, DEFAULT_BUSINESS);
}

function getHolidays() {
  return readJson(HOLIDAYS_FILE, DEFAULT_HOLIDAYS);
}

function getReservations() {
  return readJson(RESERVATIONS_FILE, []);
}

function getInventoryDaily() {
  return readJson(INVENTORY_CAKES_DAILY_FILE, {});
}

function saveReservations(data) {
  writeJsonAtomic(RESERVATIONS_FILE, data);
}

function saveInventoryDaily(data) {
  writeJsonAtomic(INVENTORY_CAKES_DAILY_FILE, data);
}

function getStockMap() {
  const raw = readJson(STOCK_FILE, {});
  if (raw.items && typeof raw.items === 'object') {
    const flat = {};
    for (const [id, v] of Object.entries(raw.items)) {
      flat[id] = typeof v === 'object' && v !== null && 'available' in v ? Number(v.available) || 0 : Number(v) || 0;
    }
    return flat;
  }
  return raw;
}

// ---------- Product ID mapping ----------

const PASTELES_AUTOR_FILE = path.join(__dirname, '..', '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json');

let _productIdMap = null;

function getProductIdMap() {
  if (_productIdMap === null) {
    _productIdMap = readJson(PRODUCT_ID_MAP_FILE, {});
    if (Object.keys(_productIdMap).length === 0) {
      _productIdMap = construirProductIdMap();
    }
  }
  return _productIdMap;
}

/**
 * Construye mapeo id -> sku/backendId desde pasteles-autor.json si existe.
 */
function construirProductIdMap() {
  try {
    const products = readJson(PASTELES_AUTOR_FILE, []);
    if (!Array.isArray(products)) return {};
    const map = {};
    for (const p of products) {
      const id = p.id != null ? String(p.id) : '';
      const sku = p.sku || p.productId || p.backendId;
      if (id && sku) map[id] = sku;
      else if (id) map[id] = 'cake_choco_8';
    }
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Normaliza productId del frontend al ID usado en inventario.
 * Si es numérico, mapea vía product_id_map.json; si ya es SKU, lo deja igual.
 */
function normalizeProductId(productId) {
  const raw = String(productId || '').trim();
  if (!raw) return raw;
  const map = getProductIdMap();
  if (map[raw]) return map[raw];
  return raw;
}

// ---------- Stock ----------
// stock.json: stock general diario por productId ("1","2",...). Se combina con reserved de inventory_cakes_daily.

function getAvailableForProduct(inv, dateKey, productId, rawProductId) {
  const stockMap = getStockMap();
  const key = String(rawProductId || productId);
  const baseAvailable = Number(stockMap[key] ?? stockMap[productId] ?? 0);
  const day = inv[dateKey];
  const p = day && (day[key] || day[productId]);
  const reserved = p ? (Number(p.reserved) || 0) : 0;
  return Math.max(0, baseAvailable - reserved);
}

function hasStockForItems(inv, dateKey, items) {
  for (const it of items) {
    const raw = String(it.productId || it.backendProductId || '').trim();
    if (!raw) continue;
    const pid = normalizeProductId(raw) || raw;
    const qty = Math.max(0, Number(it.qty) || 0);
    if (qty <= 0) continue;
    const avail = getAvailableForProduct(inv, dateKey, pid, raw);
    if (avail < qty) return false;
  }
  return true;
}

/**
 * Verifica stock con detalles para mensajes de error.
 * Usa stock.json (stock general diario) por productId.
 * @returns {{ ok: boolean, error?: string, details?: Array, failedItems?: Array }}
 */
function checkStockForItems(inv, dateKey, items) {
  // BYPASS: stock infinito para pruebas (set STOCK_BYPASS=true en .env)
  if (process.env.STOCK_BYPASS === 'true') {
    return { ok: true, details: [], failedItems: [] };
  }

  const byRaw = {};
  for (const it of items) {
    const raw = String(it.productId || it.backendProductId || '').trim();
    if (!raw) continue;
    const qty = Math.max(0, Number(it.qty) || 0);
    if (qty <= 0) continue;
    byRaw[raw] = (byRaw[raw] || 0) + qty;
  }

  const details = [];
  const failedItems = [];
  const stockMap = getStockMap();

  for (const raw of Object.keys(byRaw)) {
    const required = byRaw[raw];
    const hasStockEntry = stockMap[String(raw)] !== undefined;
    const available = getAvailableForProduct(inv, dateKey, raw, raw);
    const passes = hasStockEntry && available >= required;

    details.push({
      productId: raw,
      resolvedId: raw,
      required,
      available: hasStockEntry ? available : 0,
      hasInventory: hasStockEntry,
      passes
    });

    if (!passes) {
      failedItems.push({ productId: raw, resolvedId: raw, required, available: hasStockEntry ? available : 0 });
    }

    if (!hasStockEntry) {
      return { ok: false, error: 'Producto sin stock configurado', details, failedItems };
    }
    if (available < required) {
      return { ok: false, error: 'Stock insuficiente para uno o más productos', details, failedItems };
    }
  }
  return { ok: true, details, failedItems: [] };
}

/**
 * Verificación de stock reutilizable para availability y hold.
 * @param {string} dateKey
 * @param {object[]} items
 * @returns {{ ok: boolean, error?: string, failedItems?: Array }}
 */
function checkItemsStock(dateKey, items) {
  const inv = getInventoryDaily();
  return checkStockForItems(inv, dateKey, items);
}

function incrementReserved(inv, dateKey, productId, delta) {
  let day = inv[dateKey];
  if (!day) {
    day = {};
    inv[dateKey] = day;
  }
  let p = day[productId];
  if (!p) {
    p = { available: 0, reserved: 0 };
    day[productId] = p;
  }
  p.reserved = Math.max(0, (Number(p.reserved) || 0) + delta);
}

// ---------- Mutex ----------

let _lock = Promise.resolve();

function withLock(fn) {
  const next = _lock.then(() => Promise.resolve(fn()));
  _lock = next.catch(() => {});
  return next;
}

// ---------- Availability ----------

/**
 * Disponibilidad en formato grid para UI calendario.
 * Usa schedule-config.js: weeklyDefault + dateOverrides.
 * Alineado con hold: checkItemsStock marca slots available=false cuando no hay stock.
 */
function computeAvailabilityGrid(days, items) {
  const tz = scheduleConfig.timezone || DEFAULT_BUSINESS.timezone;
  const ruleForMonday = scheduleConfig.weeklyDefault[1] || { open: '09:00', close: '18:00' };
  const openDefault = ruleForMonday.open || '09:00';
  const closeDefault = ruleForMonday.close || '18:00';

  const now = new Date();
  const earliest = roundUpToNextHour(new Date(now.getTime() + LEAD_TIME_MS), openDefault, closeDefault);
  const n = Math.min(Math.max(1, Number(days) || 14), 90);
  const result = { timezone: tz, days: [] };

  const itemsLog = (items || []).map((it) => ({ productId: String(it?.productId || ''), qty: Number(it?.qty) || 0 }));

  let current = new Date();
  current.setHours(0, 0, 0, 0);

  let firstDayLogged = false;

  for (let i = 0; i < n; i++) {
    const d = new Date(current);
    d.setDate(d.getDate() + i);
    const dk = normalizeDateKey(d);
    const rule = scheduleConfig.getRuleForDate(dk);

    if (rule && rule.closed) {
      result.days.push({
        dateKey: dk,
        isClosed: true,
        reason: rule.reason || 'Día cerrado',
        slots: []
      });
      continue;
    }

    const stockCheck = checkItemsStock(dk, items);
    const hasStock = stockCheck.ok;

    const rawSlots = buildDaySlotsFromRule(dk, rule);
    const slots = [];
    for (const s of rawSlots) {
      const start = new Date(s.startAt);
      if (start < earliest) continue;

      const capacityRemaining = s.remaining ?? 3;
      const available = hasStock && capacityRemaining > 0;
      const remaining = available ? capacityRemaining : 0;
      const isAvailable = available;

      slots.push({
        startAt: s.startAt,
        endAt: s.endAt,
        hourLabel: s.hourLabel,
        label: s.hourLabel,
        available,
        remaining,
        isAvailable
      });
    }

    if (process.env.NODE_ENV !== 'production' && !firstDayLogged && slots.length > 0) {
      firstDayLogged = true;
      console.log('[availability] items recibidos:', itemsLog);
      console.log('[availability] rule del día:', { dateKey: dk, open: rule?.open, close: rule?.close, capacityPerSlot: rule?.capacityPerSlot });
      console.log('[availability] stockCheck:', { ok: stockCheck.ok, failedItems: stockCheck.failedItems });
      console.log('[availability] primer slot generado:', { startAt: slots[0]?.startAt, remaining: slots[0]?.remaining, available: slots[0]?.available });
    }

    result.days.push({
      dateKey: dk,
      isClosed: false,
      reason: rule && rule.reason ? rule.reason : null,
      slots
    });
  }

  return result;
}

// ---------- Hold ----------

function generateReservationId() {
  return 'resv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function validateSlotInSchedule(slotStartAt, dateKey) {
  const rule = scheduleConfig.getRuleForDate(dateKey);
  if (rule && rule.closed) return { ok: false, reason: 'Día cerrado' };

  const slots = buildDaySlotsFromRule(dateKey, rule);
  const slotStartMs = new Date(slotStartAt).getTime();
  const slot = slots.find((s) => new Date(s.startAt).getTime() === slotStartMs);
  if (!slot) return { ok: false, reason: 'Slot no válido o fuera de horario' };

  const open = (rule && rule.open) || '09:00';
  const close = (rule && rule.close) || '18:00';
  const now = new Date();
  const earliest = roundUpToNextHour(new Date(now.getTime() + LEAD_TIME_MS), open, close);
  if (new Date(slotStartAt) < earliest) {
    return { ok: false, reason: 'Lead time mínimo 24h no cumplido' };
  }
  return { ok: true, slot };
}

/**
 * @param {string} slotStartAt
 * @param {object[]} items
 * @param {number|string} [userId]
 * @param {{ name?: string, email?: string, phone?: string }} [customer]
 * @param {() => object|null} getUserById
 */
function createHold(slotStartAt, items, userId, customer, getUserById) {
  return withLock(() => {
    let cust = customer || {};
    if (userId != null && userId !== '') {
      const u = typeof getUserById === 'function' ? getUserById(userId) : null;
      if (!u) return { success: false, error: 'Usuario no encontrado' };
      cust = { name: u.name || '', email: u.email || '', phone: u.phone || '' };
    } else {
      const n = String(cust.name || '').trim();
      const e = String(cust.email || '').trim();
      const p = String(cust.phone || '').trim();
      if (!n || !e || !p) return { success: false, error: 'customer debe tener name, email y phone cuando no se envía userId' };
    }

    const dateKey = normalizeDateKey(slotStartAt);
    const validation = validateSlotInSchedule(slotStartAt, dateKey);
    if (!validation.ok) {
      return { success: false, error: validation.reason };
    }

    const inv = getInventoryDaily();

    const check = checkStockForItems(inv, dateKey, items);

    const slotStartAtLog = validation.slot ? validation.slot.startAt : slotStartAt;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[hold] dateKey:', dateKey, 'startAt:', slotStartAtLog);
      console.log('[hold] items recibidos:', (items || []).map((it) => ({ productId: it.productId, qty: it.qty })));
      console.log('[hold] checkStock details:', (check.details || []).map((d) => ({
        productId: d.productId,
        resolvedId: d.resolvedId,
        required: d.required,
        available: d.available,
        hasInventory: d.hasInventory,
        passes: d.passes
      })));
    }

    if (!check.ok) {
      let errMsg = check.error;
      if (check.details && check.details.length > 0) {
        const problem = check.details.find((d) => !d.passes);
        if (problem) {
          if (!problem.hasInventory) {
            errMsg = `Producto (ID ${problem.productId}) sin stock configurado`;
          } else {
            errMsg = `Stock insuficiente: producto (ID ${problem.productId}) requiere ${problem.required}, disponible ${problem.available}`;
          }
        }
      }
      const result = { success: false, error: errMsg };
      if (process.env.NODE_ENV !== 'production' && check.failedItems && check.failedItems.length > 0) {
        result.details = { dateKey, startAt: slotStartAtLog, failedItems: check.failedItems };
      }
      return result;
    }

    const id = generateReservationId();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);

    const reservation = {
      id,
      status: 'HELD',
      userId: userId != null && userId !== '' ? userId : undefined,
      customer: {
        name: String(cust.name || '').trim(),
        phone: String(cust.phone || '').trim(),
        email: String(cust.email || '').trim()
      },
      dateKey,
      slotStartAt,
      items: items.map((it) => {
        const raw = String(it.productId || it.backendProductId || '').trim();
        const pid = normalizeProductId(raw) || raw;
        return {
          productId: pid,
          originalProductId: raw || undefined,
          qty: Math.max(0, Number(it.qty) || 0)
        };
      }),
      holdExpiresAt: holdExpiresAt.toISOString(),
      createdAt: now.toISOString()
    };

    for (const it of reservation.items) {
      if (!it.productId || it.qty <= 0) continue;
      const keyForStock = it.originalProductId || it.productId;
      incrementReserved(inv, dateKey, keyForStock, it.qty);
    }
    saveInventoryDaily(inv);

    const reservations = getReservations();
    reservations.push(reservation);
    saveReservations(reservations);

    return {
      success: true,
      reservationId: id,
      holdExpiresAt: holdExpiresAt.toISOString()
    };
  });
}

// ---------- Expire ----------

function expireHeld() {
  return withLock(() => {
    const now = new Date();
    const reservations = getReservations();
    const inv = getInventoryDaily();
    let expiredCount = 0;

    const updated = reservations.map((r) => {
      if (r.status !== 'HELD') return r;
      const exp = new Date(r.holdExpiresAt);
      if (exp > now) return r;
      expiredCount++;
      for (const it of r.items || []) {
        const keyForStock = it.originalProductId || it.productId;
        if (!keyForStock || it.qty <= 0) continue;
        incrementReserved(inv, r.dateKey, keyForStock, -it.qty);
      }
      return { ...r, status: 'EXPIRED' };
    });

    if (expiredCount > 0) {
      saveInventoryDaily(inv);
      saveReservations(updated);
    }
    return { expiredCount };
  });
}

module.exports = {
  readJson,
  writeJsonAtomic,
  normalizeDateKey,
  parseTimeToMinutes,
  buildSlotsForDate,
  buildHourlySlotsForDate,
  buildDaySlotsFromRule,
  roundUpToNextHour,
  isClosedDate,
  getHoursForDate,
  getBusinessHours,
  getHolidays,
  getReservations,
  getInventoryDaily,
  computeAvailabilityGrid,
  createHold,
  expireHeld,
  DATA_DIR,
  BUSINESS_HOURS_FILE,
  HOLIDAYS_FILE,
  RESERVATIONS_FILE,
  INVENTORY_CAKES_DAILY_FILE
};
