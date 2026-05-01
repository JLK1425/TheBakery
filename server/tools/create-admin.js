/**
 * Inicializa usuario admin en admin-users.json.
 * Uso: node tools/create-admin.js [email] [password]
 * Sin args usa admin@thebakery.com / Bakery2024!
 * Crea o actualiza por email (case-insensitive), guarda bcrypt hash, nunca plaintext.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ADMIN_USERS_FILE = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, '..', 'server', 'data', 'admin-users.json')
  : path.join(__dirname, '..', 'data', 'admin-users.json');
const DEFAULT_EMAIL = 'admin@thebakery.com';
const DEFAULT_PASSWORD = 'Bakery2024!';

function readAdminUsers() {
  try {
    const raw = fs.readFileSync(ADMIN_USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeAdminUsers(data) {
  fs.writeFileSync(ADMIN_USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const email = process.argv[2] || DEFAULT_EMAIL;
  const password = process.argv[3] || DEFAULT_PASSWORD;

  const users = readAdminUsers();
  const emailLower = String(email).trim().toLowerCase();
  const idx = users.findIndex((u) => String(u.email || '').toLowerCase() === emailLower);
  const now = new Date().toISOString();
  const hash = await bcrypt.hash(password, 10);

  if (idx >= 0) {
    users[idx].passwordHash = hash;
    users[idx].email = emailLower;
    users[idx].updatedAt = now;
  } else {
    users.push({
      id: 'admin-' + Date.now(),
      email: emailLower,
      passwordHash: hash,
      role: 'admin',
      createdAt: now
    });
  }

  writeAdminUsers(users);
  const action = idx >= 0 ? 'updated' : 'created';
  console.log(`Admin ${action}: ${emailLower}`);
  console.log('');
  console.log('Credenciales para login:');
  console.log('  Email:    ' + emailLower);
  console.log('  Password: ' + password);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
