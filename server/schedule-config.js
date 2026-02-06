/**
 * Configuración de horarios para disponibilidad de reservas.
 * - weeklyDefault: horario por día de semana (0=Domingo ... 6=Sábado)
 * - dateOverrides: override por fecha (dateKey "YYYY-MM-DD")
 *
 * Cada regla puede ser:
 *   { closed: true, reason?: string }
 *   { open, close, slotMinutes?, capacityPerSlot?, reason? }
 */

const timezone = 'America/Santo_Domingo';

// Lun–Sáb: 10:00–22:00, slot 60 min, capacity 3
// Dom: cerrado
const weeklyDefault = {
  0: { closed: true, reason: 'Domingo cerrado' }, // Domingo
  1: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }, // Lunes
  2: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }, // Martes
  3: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }, // Miércoles
  4: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }, // Jueves
  5: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }, // Viernes
  6: { open: '10:00', close: '22:00', slotMinutes: 60, capacityPerSlot: 3 }  // Sábado
};

// Fechas especiales: cerrar día, o cambiar horario/slot/cupo
// Ejemplos:
//   "2026-12-25": { closed: true, reason: "Navidad" }
//   "2026-02-14": { open: "10:00", close: "16:00", slotMinutes: 30, capacityPerSlot: 2, reason: "San Valentín" }
const dateOverrides = {
  // '2026-12-25': { closed: true, reason: 'Navidad' },
};

function getDayOfWeek(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getDay();
}

/**
 * Obtiene la regla efectiva para una fecha.
 * Prioridad: dateOverrides[dateKey] > weeklyDefault[dayOfWeek]
 */
function getRuleForDate(dateKey) {
  const override = dateOverrides[dateKey];
  if (override && typeof override === 'object') {
    return override;
  }
  const dow = getDayOfWeek(dateKey);
  return weeklyDefault[dow] || { closed: true, reason: 'Sin configuración' };
}

module.exports = {
  timezone,
  weeklyDefault,
  dateOverrides,
  getRuleForDate,
  getDayOfWeek
};
