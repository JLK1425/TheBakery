/**
 * Usuarios para reservas: register / lookup por email + últimos 4 dígitos de cédula.
 * Hash SHA-256 + salt. No se guarda cedulaLast4 en texto plano.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users_reservations.json');

// TODO: definir CEDULA_SALT en .env en producción. Fallback solo para desarrollo.
const CEDULA_SALT = process.env.CEDULA_SALT || 'dev-fallback-cedula-salt-change-in-production';

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

function hashCedulaLast4(cedulaLast4) {
  const s = String(cedulaLast4).trim();
  return crypto.createHash('sha256').update(s + CEDULA_SALT).digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CEDULA_LAST4_RE = /^\d{4}$/;

function register(payload) {
  const { name, email, phone, cedulaLast4 } = payload || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'name es requerido' };
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return { ok: false, error: 'email es requerido' };
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'email formato inválido' };
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return { ok: false, error: 'phone es requerido' };
  }
  if (cedulaLast4 == null || cedulaLast4 === '' || !CEDULA_LAST4_RE.test(String(cedulaLast4).trim())) {
    return { ok: false, error: 'cedulaLast4 debe ser exactamente 4 dígitos' };
  }

  const cedulaLast4Hash = hashCedulaLast4(cedulaLast4);
  const users = readJson(USERS_FILE, []);
  const normEmail = email.trim().toLowerCase();
  const existing = users.find((u) => (u.email || '').toLowerCase() === normEmail);

  if (existing) {
    existing.name = String(name || existing.name || '').trim();
    existing.phone = String(phone || existing.phone || '').trim();
    existing.cedulaLast4Hash = cedulaLast4Hash;
    writeJsonAtomic(USERS_FILE, users);
    return { ok: true, userId: existing.id };
  }

  const id = users.length > 0 ? Math.max(...users.map((u) => Number(u.id) || 0)) + 1 : 1;
  const newUser = {
    id,
    name: String(name).trim(),
    email: normEmail,
    phone: String(phone).trim(),
    cedulaLast4Hash
  };
  users.push(newUser);
  writeJsonAtomic(USERS_FILE, users);
  return { ok: true, userId: id };
}

function lookup(email, cedulaLast4) {
  if (!email || typeof email !== 'string' || !email.trim()) {
    return { ok: false, error: 'email es requerido' };
  }
  if (cedulaLast4 == null || cedulaLast4 === '' || !CEDULA_LAST4_RE.test(String(cedulaLast4).trim())) {
    return { ok: false, error: 'cedulaLast4 debe ser exactamente 4 dígitos' };
  }

  const users = readJson(USERS_FILE, []);
  const normEmail = email.trim().toLowerCase();
  const user = users.find((u) => (u.email || '').toLowerCase() === normEmail);
  if (!user) return { ok: false, found: false };

  const h = hashCedulaLast4(cedulaLast4);
  if (user.cedulaLast4Hash !== h) return { ok: false, found: false };

  return {
    ok: true,
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone
  };
}

function getById(userId) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => String(u.id) === String(userId));
}

module.exports = {
  register,
  lookup,
  getById,
  hashCedulaLast4,
  USERS_FILE
};
