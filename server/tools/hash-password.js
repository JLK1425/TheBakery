/**
 * Genera hash bcrypt para contraseña.
 * Uso: node tools/hash-password.js "tu-contraseña"
 * Luego agrega manualmente el usuario a server/data/admin-users.json
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.log('Uso: node tools/hash-password.js "tu-contraseña"');
  process.exit(1);
}

bcrypt.hash(password, 10).then((hash) => {
  console.log('Hash generado (copiar a admin-users.json):');
  console.log(hash);
  console.log('\nEjemplo de entrada en admin-users.json:');
  console.log(JSON.stringify({
    id: 1,
    email: 'admin@ejemplo.com',
    passwordHash: hash,
    role: 'admin'
  }, null, 2));
});
