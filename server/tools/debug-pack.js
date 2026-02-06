/**
 * Debug Pack: valida calendario + stock.
 * 1) POST /api/availability
 * 2) Toma el primer slot con isAvailable=true
 * 3) POST /api/reservations/hold con ese slot
 * 4) Escribe debug-pack.md con respuestas y notas
 *
 * Usa fetch nativo (Node 18+). Ejecutar: node server/tools/debug-pack.js
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const AVAILABILITY_BODY = {
  days: 14,
  items: [{ productId: 'cake_choco_8', qty: 1 }]
};
const HOLD_CUSTOMER = {
  name: 'Pedro',
  email: 'pedro@test.com',
  phone: '8090000000'
};

const OUTPUT_FILE = path.join(__dirname, '..', 'debug-pack.md');

function now() {
  return new Date().toISOString();
}

function findFirstAvailableSlot(availability) {
  // Formato grid: { days: [ { slots: [ { startAt, isAvailable } ] } ] }
  const days = availability && availability.days;
  if (Array.isArray(days)) {
    for (const day of days) {
      const slots = day.slots;
      if (!Array.isArray(slots)) continue;
      for (const s of slots) {
        if (s && s.startAt && s.isAvailable === true) return s;
      }
    }
    return null;
  }
  // Formato flat: { slots: [ { startAt, endAt, dateKey } ] } — todos disponibles
  const flat = availability && availability.slots;
  if (Array.isArray(flat) && flat.length) {
    const s = flat[0];
    return s && s.startAt ? { ...s, isAvailable: true } : null;
  }
  return null;
}

async function run() {
  const executedAt = now();
  let availabilityRes = null;
  let availabilityJson = null;
  let holdRes = null;
  let holdJson = null;
  let firstSlot = null;
  let noSlotsNote = null;

  // 1) POST /api/availability
  try {
    availabilityRes = await fetch(`${BASE}/api/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(AVAILABILITY_BODY)
    });
    const text = await availabilityRes.text();
    try {
      availabilityJson = JSON.parse(text);
    } catch {
      availabilityJson = { _raw: text, _parseError: true };
    }
    if (!availabilityRes.ok) {
      availabilityJson._httpStatus = availabilityRes.status;
      availabilityJson._httpStatusText = availabilityRes.statusText;
      console.error('Availability failed:', availabilityRes.status, text);
    } else {
      firstSlot = findFirstAvailableSlot(availabilityJson);
      if (!firstSlot) noSlotsNote = 'No se encontraron slots disponibles (isAvailable=true).';
    }
  } catch (e) {
    availabilityJson = { _error: e.message, _stack: e.stack };
    console.error('Availability fetch error:', e.message);
  }
  if (availabilityJson && !availabilityRes) {
    availabilityJson._note = 'Request failed before response (fetch error).';
  }

  // 2) POST /api/reservations/hold (solo si hay slot)
  if (firstSlot) {
    try {
      const holdBody = {
        slotStartAt: firstSlot.startAt,
        items: [{ productId: 'cake_choco_8', qty: 1 }],
        customer: HOLD_CUSTOMER
      };
      holdRes = await fetch(`${BASE}/api/reservations/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(holdBody)
      });
      const text = await holdRes.text();
      try {
        holdJson = JSON.parse(text);
      } catch {
        holdJson = { _raw: text, _parseError: true };
      }
      if (!holdRes.ok) {
        holdJson._httpStatus = holdRes.status;
        holdJson._httpStatusText = holdRes.statusText;
        console.error('Hold failed:', holdRes.status, text);
      }
    } catch (e) {
      holdJson = { _error: e.message, _stack: e.stack };
      console.error('Hold fetch error:', e.message);
    }
  }

  // 3) Escribir debug-pack.md
  const lines = [
    '# Debug Pack — Calendario + Stock',
    '',
    '## Fecha/hora de ejecución',
    executedAt,
    '',
    '## Request /api/availability',
    '```json',
    JSON.stringify(AVAILABILITY_BODY, null, 2),
    '```',
    '',
    '## Response /api/availability',
    '```json',
    JSON.stringify(availabilityJson, null, 2),
    '```',
    ''
  ];

  if (noSlotsNote) {
    lines.push('## Nota', '', noSlotsNote, '');
  }

  lines.push(
    '## Request /api/reservations/hold',
    firstSlot
      ? '```json\n' +
        JSON.stringify(
          {
            slotStartAt: firstSlot.startAt,
            items: [{ productId: 'cake_choco_8', qty: 1 }],
            customer: HOLD_CUSTOMER
          },
          null,
          2
        ) +
        '\n```'
      : '(no ejecutado — sin slot disponible)',
    '',
    '## Response /api/reservations/hold',
    '```json',
    JSON.stringify(holdJson != null ? holdJson : { _skipped: 'Sin slot disponible' }, null, 2),
    '```',
    ''
  );

  const out = lines.join('\n');
  fs.writeFileSync(OUTPUT_FILE, out, 'utf8');
  console.log('Written:', OUTPUT_FILE);
  console.log('\n--- debug-pack.md ---\n');
  console.log(out);
  console.log('\n--- fin ---');
  return OUTPUT_FILE;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
