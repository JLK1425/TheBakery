/**
 * The Bakery by Fresarte - Backend Server
 * Integración con Stripe para pagos
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
// === STRIPE DESACTIVADO (usando CardNet) ===
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cardnet = require('./lib/cardnet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const reservationsLib = require('./lib/reservations');
const usersReservations = require('./lib/users-reservations');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5503';
const TEST_MODE = process.env.TEST_MODE === 'true';
const IS_PROD = process.env.NODE_ENV === 'production';

// CORS: aplicado a todas las rutas (incluye /api y /public/inventory/cakes)
app.use(cors({
  origin: ['http://127.0.0.1:5503', 'http://localhost:5503', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de debugging: log de requests + responder OPTIONS con 200 (evita fallo de preflight)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Origin:', req.get('origin'));
  console.log('Headers:', req.headers);

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS request detected - sending 200');
    return res.status(200).end();
  }

  next();
});

// [REQ] log para OPTIONS/POST checkout y api/pay/session (ruta neutral evita cancel por blockers)
app.use(function(req, res, next) {
  var isLogged = (req.method === 'OPTIONS' || req.method === 'POST') &&
    (req.path === '/create-checkout-session' || req.path === '/api/pay/session' || req.path === '/debug/ping');
  if (!isLogged) return next();
  var origin = req.get('origin') || '(none)';
  console.log('[REQ]', req.method, req.path, 'origin=', origin);
  res.on('finish', function() {
    console.log('[REQ]', req.method, req.path, 'status=', res.statusCode);
  });
  next();
});

// CardNet: recibe POST de CardNet y redirige a frontend (Live Server no acepta POST)
app.post('/cardnet/return', function (req, res) {
  console.log('[CARDNET] POST /cardnet/return -> redirect a success.html');
  res.redirect(FRONTEND_URL + '/success.html?source=cardnet');
});
app.post('/cardnet/cancel', function (req, res) {
  console.log('[CARDNET] POST /cardnet/cancel -> redirect a cancel.html');
  res.redirect(FRONTEND_URL + '/cancel.html?source=cardnet');
});

// Inventario
const INVENTORY_FILE = path.join(__dirname, 'data', 'inventory.json');

function readInventory() {
  try {
    const raw = fs.readFileSync(INVENTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo inventario:', err);
    return [];
  }
}

function writeInventory(data) {
  try {
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error escribiendo inventario:', err);
  }
}

// Pedidos
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');

function readOrders() {
  const ordersFilePath = ORDERS_FILE;
  try {
    const raw = fs.readFileSync(ordersFilePath, 'utf8');
    const orders = JSON.parse(raw);
    console.log("CARGANDO ORDERS DESDE:", ordersFilePath);
    console.log("ORDERS LOADED:", orders.map(o => o.id));
    return orders;
  } catch (err) {
    console.error('Error leyendo pedidos:', err);
    return [];
  }
}

function writeOrders(data) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error escribiendo pedidos:', err);
  }
}

// =====================
//   ARCHIVED ORDERS
// =====================
const ARCHIVED_ORDERS_FILE = path.join(__dirname, 'data', 'archived-orders.json');

function readArchivedOrders() {
  try {
    if (!fs.existsSync(ARCHIVED_ORDERS_FILE)) {
      fs.writeFileSync(ARCHIVED_ORDERS_FILE, '{}');
      return {};
    }
    return JSON.parse(fs.readFileSync(ARCHIVED_ORDERS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading archived orders:', e);
    return {};
  }
}

function writeArchivedOrders(data) {
  fs.writeFileSync(ARCHIVED_ORDERS_FILE, JSON.stringify(data, null, 2));
}

// =====================
//  PROMOTIONS / DESCUENTOS
// =====================
const PROMOTIONS_FILE = path.join(__dirname, 'data', 'promotions.json');

function readPromotions() {
  try {
    return JSON.parse(fs.readFileSync(PROMOTIONS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writePromotions(promotions) {
  fs.writeFileSync(PROMOTIONS_FILE, JSON.stringify(promotions, null, 2));
}

// Generar resumen de un grupo de pedidos
function generateDaySummary(orders) {
  const cakeMap = {};
  let totalRevenue = 0;
  let totalTax = 0;

  orders.forEach(order => {
    totalRevenue += order.subtotal || 0;
    totalTax += order.tax || 0;

    (order.items || []).forEach(item => {
      let name = 'Producto desconocido';
      let price = 0;
      let qty = item.quantity || 1;

      if (item.name) {
        name = item.name;
        price = item.price || 0;
      } else if (item.price_data && item.price_data.product_data) {
        name = item.price_data.product_data.name || 'Producto';
        price = (item.price_data.unit_amount || 0) / 100;
      }

      if (!cakeMap[name]) {
        cakeMap[name] = { name, quantity: 0, revenue: 0 };
      }
      cakeMap[name].quantity += qty;
      cakeMap[name].revenue += price * qty;
    });
  });

  // Ordenar por cantidad vendida (mayor primero)
  const topCakes = Object.values(cakeMap).sort((a, b) => b.quantity - a.quantity);

  return {
    totalOrders: orders.length,
    totalRevenue,
    totalTax,
    totalWithTax: totalRevenue + totalTax,
    topCakes
  };
}

// Archivar pedidos entregados de una fecha específica
function archiveDeliveredOrders() {
  const orders = readOrders();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // "2026-02-19"

  // Filtrar solo pedidos con status "Entregado"
  const delivered = orders.filter(o => {
    const status = String(o.status || '').trim();
    return status === 'Entregado';
  });

  if (delivered.length === 0) {
    console.log('[Archive] No hay pedidos entregados para archivar.');
    return { archived: 0 };
  }

  // Leer archivo existente
  const archived = readArchivedOrders();

  // Agrupar entregados por fecha de creación
  const byDate = {};
  delivered.forEach(order => {
    const dateStr = order.createdAt ? order.createdAt.split('T')[0] : todayStr;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(order);
  });

  // Agregar a archivo (merge si ya existe esa fecha)
  let totalArchived = 0;
  Object.entries(byDate).forEach(([dateStr, dateOrders]) => {
    if (!archived[dateStr]) {
      archived[dateStr] = {
        date: dateStr,
        archivedAt: now.toISOString(),
        summary: generateDaySummary(dateOrders),
        orders: dateOrders
      };
    } else {
      // Merge: agregar pedidos que no estén ya (por ID)
      const existingIds = new Set(archived[dateStr].orders.map(o => o.id));
      const newOrders = dateOrders.filter(o => !existingIds.has(o.id));
      archived[dateStr].orders.push(...newOrders);
      // Recalcular resumen
      archived[dateStr].summary = generateDaySummary(archived[dateStr].orders);
      archived[dateStr].archivedAt = now.toISOString();
    }
    totalArchived += dateOrders.length;
  });

  // Limpiar archivos con más de 14 días
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  Object.keys(archived).forEach(dateStr => {
    const archiveDate = new Date(dateStr + 'T00:00:00');
    if (archiveDate < twoWeeksAgo) {
      console.log(`[Archive] Eliminando archivo caducado: ${dateStr}`);
      delete archived[dateStr];
    }
  });

  // Guardar archivo
  writeArchivedOrders(archived);

  // Remover los pedidos entregados de orders.json (dejar los que NO son Entregado)
  const remaining = orders.filter(o => {
    const status = String(o.status || '').trim();
    return status !== 'Entregado';
  });
  writeOrders(remaining);

  console.log(`[Archive] ${totalArchived} pedidos archivados. ${remaining.length} pedidos restantes.`);
  return { archived: totalArchived, remaining: remaining.length };
}

// Usuarios
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo usuarios:', err);
    return [];
  }
}

function writeUsers(data) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error escribiendo usuarios:', err);
  }
}

// Admin users (sesión con express-session)
const ADMIN_USERS_FILE = path.join(__dirname, 'data', 'admin-users.json');

function ensureAdminUsersFile() {
  try {
    if (!fs.existsSync(ADMIN_USERS_FILE)) {
      fs.writeFileSync(ADMIN_USERS_FILE, '[]', 'utf8');
    }
  } catch (e) {
    console.warn('No se pudo crear admin-users.json:', e.message);
  }
}
ensureAdminUsersFile();

function readAdminUsers() {
  try {
    const raw = fs.readFileSync(ADMIN_USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function findUserByEmail(email) {
  const users = readAdminUsers();
  const e = (email || '').trim().toLowerCase();
  return users.find(u => String(u.email || '').toLowerCase() === e);
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  req.user = req.session.user;
  next();
}

// =========================
//     AUTH MIDDLEWARE (legacy JWT)
// =========================

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const decoded = jwt.verify(token, secret);
    const users = readUsers();
    const user = users.find(u => u.id === decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.user = user; // Attach user info
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Acceso denegado (solo SuperAdmin)' });
  }
  next();
}

app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-prod', // Solo para desarrollo local
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  }
}));
app.use(express.static(path.join(__dirname, '..'))); // Servir archivos estáticos del proyecto

// Rutas de datos (para compatibilidad con el frontend)
app.get('/api/products', async (req, res) => {
  try {
      const data = await fsPromises.readFile(path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar productos' });
  }
});

// Health/ping para probar CORS sin credenciales
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'pong', timestamp: new Date().toISOString() });
});

// ========== AUTH ROUTES ==========
// Registrar nuevo usuario
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validaciones
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    // Leer usuarios existentes
    const usersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'users.json');
    let users = [];
    
    try {
      const data = await fsPromises.readFile(usersPath, 'utf8');
      users = JSON.parse(data);
    } catch (error) {
      // Si el archivo no existe, crear array vacío
      console.log('Creando nuevo archivo users.json');
    }

    // Verificar si el email ya existe
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    // Crear nuevo usuario (en producción, hashear la contraseña)
    const newUser = {
      id: `USER-${Date.now()}`,
      email: email.toLowerCase(),
      password: password, // En producción, usar bcrypt para hashear
      name: name.trim(),
      createdAt: new Date().toISOString(),
      lastLogin: null
    };

    users.push(newUser);

    // Guardar usuarios
    await fsPromises.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');

    // No enviar la contraseña en la respuesta
    const { password: _, ...userResponse } = newUser;
    res.json({ 
      success: true, 
      user: userResponse,
      message: 'Usuario registrado correctamente' 
    });

  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ 
      error: 'Error al registrar usuario',
      message: error.message 
    });
  }
});

// Iniciar sesión
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Leer usuarios
    const usersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'users.json');
    let users = [];
    
    try {
      const data = await fsPromises.readFile(usersPath, 'utf8');
      users = JSON.parse(data);
    } catch (error) {
      return res.status(500).json({ error: 'Error al leer usuarios' });
    }

    // Buscar usuario
    const user = users.find(u => 
      u.email.toLowerCase() === email.toLowerCase() && 
      u.password === password // En producción, comparar hash
    );

    if (!user) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Actualizar último login
    user.lastLogin = new Date().toISOString();
    await fsPromises.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');

    // No enviar la contraseña en la respuesta
    const { password: _, ...userResponse } = user;
    res.json({ 
      success: true, 
      user: userResponse,
      message: 'Inicio de sesión exitoso' 
    });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).json({ 
      error: 'Error al iniciar sesión',
      message: error.message 
    });
  }
});

// Debug: ping POST (probar CORS con credentials)
app.post('/debug/ping', (req, res) => res.status(200).json({ ok: true }));

// Debug: echo POST con JSON (para probar que un POST con body no se cancela)
app.post('/debug/echo', (req, res) => {
  res.json({ ok: true, body: req.body });
});

// === STRIPE DESACTIVADO (usando CardNet) ===
/*
// Handler compartido: misma lógica para /api/pay/session y /create-checkout-session (wrapper compatibilidad).
async function createCheckoutSessionHandler(req, res) {
  ...
  const session = await stripe.checkout.sessions.create({ ... });
  res.json({ url: session.url });
  ...
}
app.post('/api/pay/session', createCheckoutSessionHandler);
app.post('/create-checkout-session', createCheckoutSessionHandler);
app.post('/api/pay/redirect', async function (req, res) { ... });
*/

// === CARDNET: Crear sesión de pago ===
app.post('/api/pay/session', async (req, res) => {
  try {
    const { line_items, items, total, customer } = req.body;

    console.log('[CARDNET] Recibido request de pago');

    // Calcular subtotal desde line_items
    let subtotal = 0;
    if (line_items && line_items.length > 0) {
      subtotal = line_items.reduce((sum, item) => {
        const unitAmount = item.price_data?.unit_amount || 0;
        const qty = item.quantity || 1;
        return sum + (unitAmount * qty);
      }, 0) / 100; // convertir de centavos a pesos
    } else if (total) {
      subtotal = parseFloat(String(total).replace(/[^0-9.]/g, ''));
    }

    if (subtotal <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }

    // Calcular ITBIS (18%)
    const tax = Math.round(subtotal * 0.18 * 100) / 100;
    const totalAmount = Math.round((subtotal + tax) * 100) / 100;

    // Obtener IP del cliente
    let clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
    clientIp = clientIp.replace('::ffff:', '').replace('::1', '127.0.0.1');

    const result = await cardnet.createSession({
      subtotal,
      tax,
      total: totalAmount,
      clientIp,
      items: line_items || items,
      customer: customer || {}
    });

    // Responder al frontend con SESSION y URL del gateway
    res.json({
      SESSION: result.SESSION,
      authorizeUrl: result.authorizeUrl,
      ordenId: result.ordenId
    });

  } catch (error) {
    console.error('[CARDNET] Error en /api/pay/session:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// === STRIPE DESACTIVADO: createCheckoutSessionFromBody y GET checkout-session ===
/*
async function createCheckoutSessionFromBody(body) { ... stripe.checkout.sessions.create ... }
app.get('/checkout-session/:sessionId', async (req, res) => { ... stripe.checkout.sessions.retrieve ... });
*/

// Parsear nombre de item CardNet/Stripe para extraer nombre de pastel y tamaño
// Input: "Pastel de Coco (6\")" o "Matcha Strawberry (8\")"
// Output: { cakeName: "Pastel de Coco", size: "6" }
function parseItemName(itemName) {
  const match = itemName.match(/^(.+?)\s*\((\d+)["'"]?\)$/);
  if (match) {
    return { cakeName: match[1].trim(), size: match[2] };
  }
  return { cakeName: itemName, size: null };
}

// Descontar stock de pasteles basado en los items de una orden
function decreaseStockFromOrder(items) {
  if (!items || items.length === 0) return;

  const cakes = readCakes();
  let stockUpdated = false;

  items.forEach(item => {
    // Extraer nombre del item (soporta formato Stripe y plano)
    let itemName = '';
    let qty = item.quantity || 1;

    if (item.name) {
      itemName = item.name;
    } else if (item.price_data && item.price_data.product_data) {
      itemName = item.price_data.product_data.name || '';
    }

    if (!itemName) return;

    const { cakeName, size } = parseItemName(itemName);
    if (!size) {
      console.log(`[STOCK] No se pudo extraer tamaño de: "${itemName}"`);
      return;
    }

    // Buscar el pastel por nombre (case-insensitive, sin acentos)
    const normalize = (str) => str.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim();

    const cake = cakes.find(c => normalize(c.name) === normalize(cakeName));

    if (!cake) {
      console.log(`[STOCK] Pastel no encontrado: "${cakeName}"`);
      return;
    }

    if (cake.sizes && cake.sizes[size] !== undefined) {
      const before = cake.sizes[size];
      cake.sizes[size] = Math.max(0, cake.sizes[size] - qty);
      console.log(`[STOCK] ${cake.name} (${size}"): ${before} → ${cake.sizes[size]} (-${qty})`);
      stockUpdated = true;
    } else {
      console.log(`[STOCK] Tamaño ${size}" no existe para ${cake.name}`);
    }
  });

  if (stockUpdated) {
    writeCakes(cakes);
    console.log('[STOCK] Stock actualizado en inventory_cakes.json');
  }
}

// === CARDNET: Verificar resultado de pago ===
app.get('/api/pay/verify', async (req, res) => {
  try {
    const sessionId = req.query.session;
    if (!sessionId) {
      return res.status(400).json({ error: 'Parámetro session requerido' });
    }

    const result = await cardnet.verifyTransaction(sessionId);

    // Si fue aprobada, guardar la orden en orders.json
    if (result.approved) {
      const ordersPath = path.join(__dirname, 'data', 'orders.json');
      let orders = [];
      try {
        orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
      } catch (e) {
        orders = [];
      }

      // Obtener datos del cliente desde la sesión guardada
      const sessionData = result.originalData.customer || {};

      orders.push({
        id: result.ordenId,
        paymentMethod: 'cardnet',
        responseCode: result.responseCode,
        authorizationCode: result.authorizationCode,
        cardNumber: result.creditCardNumber,
        referenceNumber: result.referenceNumber,
        txToken: result.txToken,
        subtotal: result.originalData.subtotal,
        tax: result.originalData.tax,
        total: result.originalData.total,
        items: result.originalData.items,
        customerName: [sessionData.firstName, sessionData.lastName].filter(Boolean).join(' ') || 'Cliente',
        customer: {
          name: [sessionData.firstName, sessionData.lastName].filter(Boolean).join(' ') || 'Cliente',
          firstName: sessionData.firstName || '',
          lastName: sessionData.lastName || '',
          phone: sessionData.phone || '',
          email: sessionData.email || null,
          cedulaLast4: sessionData.cedulaLast4 || null,
          deliveryDate: sessionData.deliveryDate || null,
          pickupTime: sessionData.pickupTime || null
        },
        status: 'Pendiente',
        createdAt: new Date().toISOString()
      });

      fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
      // Descontar stock
      decreaseStockFromOrder(result.originalData.items);
      console.log('[CARDNET] Orden guardada:', result.ordenId);
    }

    res.json(result);

  } catch (error) {
    console.error('[CARDNET] Error en /api/pay/verify:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Health check (para validar conectividad desde el frontend)
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'ok', message: 'The Bakery Server is running' });
});

// =========================
//  PROMOCIONES / DESCUENTOS
// =========================

// ── GET /api/promotions — Listar todas las promociones (admin) ──
app.get('/api/promotions', requireAdmin, (req, res) => {
  const promotions = readPromotions();
  res.json(promotions);
});

// ── GET /api/promotions/:id — Obtener una promoción (admin) ──
app.get('/api/promotions/:id', requireAdmin, (req, res) => {
  const promotions = readPromotions();
  const promo = promotions.find(p => p.id === req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });
  res.json(promo);
});

// ── POST /api/promotions — Crear nueva promoción (admin) ──
app.post('/api/promotions', requireAdmin, (req, res) => {
  const { code, description, type, value, minPurchase, maxUses, startDate, endDate, onePerCustomer } = req.body;

  // Validaciones
  if (!code || !type || !value) {
    return res.status(400).json({ error: 'Código, tipo y valor son obligatorios' });
  }

  if (!['percentage', 'fixed'].includes(type)) {
    return res.status(400).json({ error: 'Tipo debe ser "percentage" o "fixed"' });
  }

  if (type === 'percentage' && (value < 1 || value > 100)) {
    return res.status(400).json({ error: 'Porcentaje debe ser entre 1 y 100' });
  }

  const promotions = readPromotions();

  // Verificar código único (case-insensitive)
  const codeUpper = code.toUpperCase().trim();
  if (promotions.some(p => p.code === codeUpper)) {
    return res.status(400).json({ error: 'Ya existe una promoción con ese código' });
  }

  const newPromo = {
    id: 'PROMO-' + Date.now(),
    code: codeUpper,
    description: description || '',
    type: type,
    value: parseFloat(value),
    minPurchase: parseFloat(minPurchase) || 0,
    maxUses: parseInt(maxUses) || 0, // 0 = ilimitado
    currentUses: 0,
    startDate: startDate || null,
    endDate: endDate || null,
    onePerCustomer: onePerCustomer || false,
    usedBy: [], // emails/cédulas de quienes lo usaron
    active: true,
    createdAt: new Date().toISOString()
  };

  promotions.push(newPromo);
  writePromotions(promotions);

  console.log(`[PROMO] Nueva promoción creada: ${codeUpper} (${type} ${value})`);
  res.status(201).json(newPromo);
});

// ── PUT /api/promotions/:id — Editar promoción (admin) ──
app.put('/api/promotions/:id', requireAdmin, (req, res) => {
  const promotions = readPromotions();
  const index = promotions.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Promoción no encontrada' });

  const { code, description, type, value, minPurchase, maxUses, startDate, endDate, onePerCustomer, active } = req.body;

  // Si cambian el código, verificar que no exista otro con ese código
  if (code) {
    const codeUpper = code.toUpperCase().trim();
    const duplicate = promotions.find(p => p.code === codeUpper && p.id !== req.params.id);
    if (duplicate) {
      return res.status(400).json({ error: 'Ya existe otra promoción con ese código' });
    }
    promotions[index].code = codeUpper;
  }

  if (description !== undefined) promotions[index].description = description;
  if (type) promotions[index].type = type;
  if (value !== undefined) promotions[index].value = parseFloat(value);
  if (minPurchase !== undefined) promotions[index].minPurchase = parseFloat(minPurchase) || 0;
  if (maxUses !== undefined) promotions[index].maxUses = parseInt(maxUses) || 0;
  if (startDate !== undefined) promotions[index].startDate = startDate;
  if (endDate !== undefined) promotions[index].endDate = endDate;
  if (onePerCustomer !== undefined) promotions[index].onePerCustomer = onePerCustomer;
  if (active !== undefined) promotions[index].active = active;

  promotions[index].updatedAt = new Date().toISOString();
  writePromotions(promotions);

  console.log(`[PROMO] Promoción actualizada: ${promotions[index].code}`);
  res.json(promotions[index]);
});

// ── DELETE /api/promotions/:id — Eliminar promoción (admin) ──
app.delete('/api/promotions/:id', requireAdmin, (req, res) => {
  let promotions = readPromotions();
  const promo = promotions.find(p => p.id === req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });

  promotions = promotions.filter(p => p.id !== req.params.id);
  writePromotions(promotions);

  console.log(`[PROMO] Promoción eliminada: ${promo.code}`);
  res.json({ ok: true, deleted: promo.code });
});

// ── PATCH /api/promotions/:id/toggle — Activar/desactivar (admin) ──
app.patch('/api/promotions/:id/toggle', requireAdmin, (req, res) => {
  const promotions = readPromotions();
  const promo = promotions.find(p => p.id === req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });

  promo.active = !promo.active;
  promo.updatedAt = new Date().toISOString();
  writePromotions(promotions);

  console.log(`[PROMO] ${promo.code} ${promo.active ? 'activada' : 'desactivada'}`);
  res.json(promo);
});

// ── POST /api/promotions/validate — Validar código de descuento (público) ──
app.post('/api/promotions/validate', (req, res) => {
  const { code, subtotal, customerEmail, customerCedula } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Código requerido' });
  }

  const promotions = readPromotions();
  const promo = promotions.find(p => p.code === code.toUpperCase().trim());

  if (!promo) {
    return res.status(404).json({ error: 'Código de descuento no válido' });
  }

  // Verificar si está activa
  if (!promo.active) {
    return res.status(400).json({ error: 'Esta promoción no está activa' });
  }

  // Verificar fechas
  const now = new Date();
  if (promo.startDate && new Date(promo.startDate) > now) {
    return res.status(400).json({ error: 'Esta promoción aún no está vigente' });
  }
  if (promo.endDate && new Date(promo.endDate) < now) {
    return res.status(400).json({ error: 'Esta promoción ha expirado' });
  }

  // Verificar usos máximos
  if (promo.maxUses > 0 && promo.currentUses >= promo.maxUses) {
    return res.status(400).json({ error: 'Esta promoción ha alcanzado su límite de usos' });
  }

  // Verificar monto mínimo
  if (promo.minPurchase > 0 && subtotal < promo.minPurchase) {
    return res.status(400).json({
      error: `Compra mínima de RD$${promo.minPurchase.toLocaleString()} requerida`
    });
  }

  // Verificar un uso por cliente
  if (promo.onePerCustomer) {
    const identifier = customerEmail || customerCedula;
    if (identifier && promo.usedBy.includes(identifier.toLowerCase())) {
      return res.status(400).json({ error: 'Ya has usado este código de descuento' });
    }
  }

  // Calcular descuento
  let discount = 0;
  if (promo.type === 'percentage') {
    discount = Math.round((subtotal * promo.value / 100) * 100) / 100;
  } else {
    discount = Math.min(promo.value, subtotal); // No puede ser mayor que el subtotal
  }

  res.json({
    valid: true,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    discount: discount,
    description: promo.description,
    message: promo.type === 'percentage'
      ? `${promo.value}% de descuento aplicado`
      : `RD$${promo.value.toLocaleString()} de descuento aplicado`
  });
});

// ── POST /api/promotions/use — Registrar uso de promoción (se llama al confirmar pago) ──
app.post('/api/promotions/use', (req, res) => {
  const { code, customerEmail, customerCedula } = req.body;

  if (!code) return res.status(400).json({ error: 'Código requerido' });

  const promotions = readPromotions();
  const promo = promotions.find(p => p.code === code.toUpperCase().trim());

  if (!promo) return res.status(404).json({ error: 'Promoción no encontrada' });

  promo.currentUses += 1;

  const identifier = (customerEmail || customerCedula || '').toLowerCase();
  if (identifier && !promo.usedBy.includes(identifier)) {
    promo.usedBy.push(identifier);
  }

  promo.lastUsedAt = new Date().toISOString();
  writePromotions(promotions);

  console.log(`[PROMO] Código ${promo.code} usado (uso #${promo.currentUses})`);
  res.json({ ok: true });
});

// =========================
// INVENTARIO DE PASTELES
// =========================

// Obtener todo el inventario
app.get('/api/inventory', (req, res) => {
  const inventory = readInventory();
  res.json(inventory);
});

// Actualizar inventario por ID
app.put('/api/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { inventory_8, inventory_12 } = req.body;

  const inventory = readInventory();
  const itemIndex = inventory.findIndex(item => item.id === id);

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Pastel no encontrado' });
  }

  if (inventory_8 !== undefined) {
    inventory[itemIndex].inventory_8 = Number(inventory_8);
  }

  if (inventory_12 !== undefined) {
    inventory[itemIndex].inventory_12 = Number(inventory_12);
  }

  writeInventory(inventory);
  res.json(inventory[itemIndex]);
});

// Crear un nuevo pastel (opcional)
app.post('/api/inventory', (req, res) => {
  const { name, slug, price_8, price_12, inventory_8, inventory_12 } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'name y slug son obligatorios' });
  }

  const inventory = readInventory();
  const newId = inventory.length > 0 ? Math.max(...inventory.map(i => i.id)) + 1 : 1;

  const newItem = {
    id: newId,
    name,
    slug,
    price_8: Number(price_8) || 0,
    price_12: Number(price_12) || 0,
    inventory_8: Number(inventory_8) || 0,
    inventory_12: Number(inventory_12) || 0
  };

  inventory.push(newItem);
  writeInventory(inventory);

  res.status(201).json(newItem);
});

// =========================
//      PEDIDOS (ORDERS)
// =========================

// Obtener todos los pedidos (admin)
app.get('/api/orders', requireAdmin, (req, res) => {
  const orders = readOrders();
  res.json(orders);
});

// Obtener un pedido por ID
app.get('/api/orders/:id', (req, res) => {
  try {
    const orderId = req.params.id;
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);

  } catch (error) {
    console.error('Error consultando pedido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear un nuevo pedido
app.post('/api/orders', (req, res) => {
  try {
    const {
      id,
      sessionId,
      customerEmail,
      customerName,
      customerPhone,
      items,
      total,
      status,
      deliveryDate,
      deliverySlot,
      deliverySlotLabel,
      notes,
      address,
      deliveryType,
      reservationId
    } = req.body;

    // Validar campos requeridos
    if (!sessionId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'sessionId e items son requeridos. items debe ser un array no vacío'
      });
    }

    if (!total || typeof total !== 'number') {
      return res.status(400).json({ error: 'total es requerido y debe ser un número' });
    }

    // Leer pedidos existentes ANTES de crear uno nuevo
    const orders = readOrders();

    // Verificar si ya existe un pedido con este sessionId
    const existing = orders.find(o => o.sessionId === sessionId);
    if (existing) {
      console.log('⚠️ Pedido ya existe para sessionId:', sessionId);
      return res.status(200).json({
        success: true,
        orderId: existing.id,
        order: existing
      });
    }

    // Generar ID si no se proporciona
    const orderId = id || `ORD-${Date.now()}`;

    // Crear objeto del pedido (campos de reserva/entrega opcionales)
    const newOrder = {
      id: orderId,
      sessionId: sessionId,
      customerEmail: customerEmail || 'sin-email@ejemplo.com',
      customerName: customerName || 'Cliente',
      customerPhone: customerPhone || null,
      items: items,
      total: total,
      status: status || 'Pendiente',
      deliveryDate: deliveryDate || null,
      deliverySlot: deliverySlot || null,
      deliverySlotLabel: deliverySlotLabel || null,
      notes: notes || null,
      address: address || null,
      deliveryType: deliveryType || null,
      reservationId: reservationId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('Creando pedido:', orderId);
    console.log('❗ Detalle del pedido:', newOrder);
    
    // NO descontar inventario aquí - ya se descontó al agregar al carrito
    // El inventario ya está sincronizado desde que el usuario agregó items al carrito
    console.log('[INVENTORY UPDATE] Pedido creado - inventario ya fue descontado al agregar al carrito');
    
    // Agregar nuevo pedido
    orders.push(newOrder);

    // Guardar pedidos
    writeOrders(orders);

    console.log('✓ Pedido creado exitosamente:', orderId);
    
    res.status(201).json({
      success: true, 
      orderId: orderId,
      order: newOrder
    });

  } catch (error) {
    console.error('Error al crear pedido:', error);
    res.status(500).json({ 
      error: 'Error al crear el pedido',
      message: error.message 
    });
  }
});

// Actualizar estado de un pedido (admin)
app.put('/api/orders/:id/status', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const orders = readOrders();
  const index = orders.findIndex(o => o.id == id);

  if (index === -1) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // Mapear "En camino" (legacy) a "Listo"
  const normalizedStatus = (status === 'En camino' || status === 'on_the_way' || status === 'en_camino') ? 'Listo' : status;
  orders[index].status = normalizedStatus;
  writeOrders(orders);

  res.json(orders[index]);
});

// Eliminar pedido
// DELETE /api/orders/all - Eliminar todos los pedidos
app.delete('/api/orders/all', requireAdmin, (req, res) => {
  try {
    writeOrders([]);
    res.json({ success: true, message: 'Todos los pedidos fueron eliminados' });
  } catch (error) {
    console.error('Error eliminando todos los pedidos:', error);
    res.status(500).json({ error: 'Error al eliminar pedidos' });
  }
});

app.delete('/api/orders/:id', requireAdmin, (req, res) => {
  console.log("ID RECIBIDO PARA ELIMINAR:", req.params.id);
  try {
    let id = String(req.params.id || '').trim();

    // Normalizar guiones Unicode → guion normal
    id = id.replace(/[\u2010-\u2015]/g, "-");

    const orders = readOrders();

    // Normalizar IDs del archivo también
    const filtered = orders.filter(o => {
      const cleanStoredId = String(o.id || "")
        .trim()
        .replace(/[\u2010-\u2015]/g, "-");

      return cleanStoredId !== id;
    });

    if (filtered.length === orders.length) {
      return res.status(404).json({
        error: 'Pedido no encontrado',
        recibido: id
      });
    }

    writeOrders(filtered);

    return res.json({
      message: 'Pedido eliminado correctamente',
      eliminado: id
    });

  } catch (error) {
    return res.status(500).json({
      error: "Error eliminando pedido",
      details: error.message
    });
  }
});

// =========================
//        AUTH USUARIOS
// =========================

// Registrar usuario (por ahora uso interno, se puede limitar luego)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  }

  const users = readUsers();
  const existing = users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;

    const newUser = {
      id: newId,
      name,
      email,
      passwordHash,
      role: role || 'admin'
    };

    users.push(newUser);
    writeUsers(users);

    // No devolvemos el hash
    const { passwordHash: _, ...safeUser } = newUser;
    res.status(201).json(safeUser);
  } catch (err) {
    console.error('Error registrando usuario:', err);
    res.status(500).json({ error: 'Error interno al registrar usuario' });
  }
});

// Login admin (sesión con express-session, admin-users.json)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña son obligatorios' });
  }

  const emailNorm = String(email).trim().toLowerCase();
  const user = findUserByEmail(emailNorm);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[auth/login] admin-users file:', ADMIN_USERS_FILE);
    console.log('[auth/login] user found by email:', !!user);
  }

  if (!user || !user.passwordHash) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  try {
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[auth/login] bcrypt.compare result:', isValid);
    }
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }

    req.session.user = { id: user.id, email: user.email, role: user.role || 'admin' };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Verificar sesión admin
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ ok: true, user: req.session.user });
  }
  res.status(401).json({ ok: false });
});

// Logout admin (destruir sesión)
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ ok: true });
  });
});

// =========================
//      USER MANAGEMENT
// =========================

// Obtener lista de usuarios (solo SuperAdmin)
app.get('/api/users', requireAdmin, requireSuperAdmin, (req, res) => {
  const users = readUsers();
  const safeUsers = users.map(({ passwordHash, ...rest }) => rest);
  res.json(safeUsers);
});

// Crear usuario (solo SuperAdmin)
app.post('/api/users', requireAdmin, requireSuperAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  const users = readUsers();
  const exists = users.find(u => u.email === email);
  if (exists) {
    return res.status(400).json({ error: 'El correo ya está registrado' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    name,
    email,
    passwordHash,
    role: role || 'admin'
  };

  users.push(newUser);
  writeUsers(users);

  const { passwordHash: _, ...safe } = newUser;
  res.status(201).json(safe);
});

// Eliminar usuario (solo SuperAdmin)
app.delete('/api/users/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const users = readUsers();

  const filtered = users.filter(u => u.id !== id);

  if (filtered.length === users.length) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  writeUsers(filtered);
  res.json({ message: 'Usuario eliminado' });
});

// ============================================
// RUTAS DE INVENTARIO DE INGREDIENTES
// ============================================

const INGREDIENTS_FILE = path.join(__dirname, 'data', 'inventory_ingredients.json');

function readIngredients() {
  try {
    if (!fs.existsSync(INGREDIENTS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(INGREDIENTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo ingredientes:', err);
    return [];
  }
}

function writeIngredients(data) {
  try {
    fs.writeFileSync(INGREDIENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error escribiendo ingredientes:', err);
  }
}

// GET /inventory/ingredients
app.get('/inventory/ingredients', requireAdmin, (req, res) => {
  const ingredients = readIngredients();
  res.json(ingredients);
});

// POST /inventory/ingredients/update
app.post('/inventory/ingredients/update', requireAdmin, (req, res) => {
  const updatedIngredient = req.body;
  const ingredients = readIngredients();
  
  const index = ingredients.findIndex(i => i.id === updatedIngredient.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Ingrediente no encontrado' });
  }
  
  ingredients[index] = updatedIngredient;
  writeIngredients(ingredients);
  res.json(updatedIngredient);
});

// POST /inventory/ingredients/add
app.post('/inventory/ingredients/add', requireAdmin, (req, res) => {
  const newIngredient = req.body;
  const ingredients = readIngredients();
  
  // Validar que tenga id
  if (!newIngredient.id) {
    const maxId = ingredients.length > 0 ? Math.max(...ingredients.map(i => i.id || 0)) : 0;
    newIngredient.id = maxId + 1;
  }
  
  ingredients.push(newIngredient);
  writeIngredients(ingredients);
  res.status(201).json(newIngredient);
});

// POST /inventory/ingredients/delete
app.post('/inventory/ingredients/delete', requireAuth, (req, res) => {
  const { id } = req.body;
  const ingredients = readIngredients();
  
  const filtered = ingredients.filter(i => i.id !== id);
  
  if (filtered.length === ingredients.length) {
    return res.status(404).json({ error: 'Ingrediente no encontrado' });
  }
  
  writeIngredients(filtered);
  res.json({ message: 'Ingrediente eliminado' });
});

// ============================================
// RUTAS DE INVENTARIO DE PASTELES
// ============================================

const CAKES_FILE = path.join(__dirname, 'data', 'inventory_cakes.json');

function readCakes() {
  try {
    if (!fs.existsSync(CAKES_FILE)) {
      // Si no existe, inicializar desde pasteles-autor.json
      return initializeCakesInventory();
    }
    const raw = fs.readFileSync(CAKES_FILE, 'utf8');
    const cakes = JSON.parse(raw);
    // Log para cada pastel cargado
    cakes.forEach(cake => {
      console.log("[CAKE UPDATE] Loaded cake:", cake.id, cake.name);
    });
    return cakes;
  } catch (err) {
    console.error('Error leyendo pasteles:', err);
    return [];
  }
}

function writeCakes(data) {
  try {
    fs.writeFileSync(CAKES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error escribiendo pasteles:', err);
  }
}

// Función para normalizar nombres de pasteles
function normalizeCakeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/\(.*?\)/g, "")      // remove sizes like (6")
    .replace(/Pastel de /i, "")   // remove "Pastel de"
    .replace(/Premium/i, "")      // remove extra tags
    .replace(/\s+/g, " ")         // normalize spaces
    .trim()
    .toLowerCase();
}

function initializeCakesInventory() {
  try {
    const productsPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json');
    if (fs.existsSync(productsPath)) {
      const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      const cakes = products.map(product => {
        const cake = {
          id: String(product.id),
          name: product.name,
          sizes: {
            '10': 0,
            '12': 0
          }
        };
        console.log("[CAKE UPDATE] Loaded cake:", cake.id, cake.name);
        return cake;
      });
      writeCakes(cakes);
      return cakes;
    }
  } catch (err) {
    console.error('Error inicializando inventario de pasteles:', err);
  }
  return [];
}

// ============================================
// RESERVAS TEMPORALES DE STOCK
// ============================================
const STOCK_RESERVATIONS_FILE = path.join(__dirname, 'data', 'stock-reservations.json');
const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutos

function readStockReservations() {
  try {
    if (!fs.existsSync(STOCK_RESERVATIONS_FILE)) {
      fs.writeFileSync(STOCK_RESERVATIONS_FILE, JSON.stringify({ reservations: [] }, null, 2), 'utf8');
      return { reservations: [] };
    }
    const raw = fs.readFileSync(STOCK_RESERVATIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[STOCK-RESERVATION] Error leyendo reservas:', e.message);
    return { reservations: [] };
  }
}

function writeStockReservations(data) {
  try {
    fs.writeFileSync(STOCK_RESERVATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[STOCK-RESERVATION] Error escribiendo reservas:', e.message);
  }
}

function createStockReservation(items, tempSessionId) {
  const cakes = readCakes();
  const reservationsData = readStockReservations();

  // BYPASS: stock infinito para pruebas (set STOCK_BYPASS=true en .env para activar)
  const stockBypass = process.env.STOCK_BYPASS === 'true';
  if (stockBypass) {
    console.log('[STOCK-RESERVATION] BYPASS activo - no se valida ni descuenta stock');
    const id = `RES-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
    const reservationItems = items.map(it => ({
      productId: String(it.productId || it.id || ''),
      size: String(it.size || '10'),
      quantity: Number(it.quantity) || 1
    }));
    reservationsData.reservations.push({
      id,
      sessionId: tempSessionId,
      items: reservationItems,
      expiresAt,
      status: 'pending'
    });
    writeStockReservations(reservationsData);
    console.log('[STOCK-RESERVATION] Creada (bypass):', id, 'items:', reservationItems.length);
    return { ok: true, reservationId: id, tempSessionId };
  }

  for (const it of items) {
    const productId = String(it.productId || it.id || '');
    const size = String(it.size || '10');
    const quantity = Number(it.quantity) || 1;
    const cake = cakes.find(c => String(c.id) === productId);
    if (!cake || !cake.sizes) {
      console.log('[STOCK-RESERVATION] Pastel no encontrado:', productId);
      return { ok: false, error: 'Pastel no encontrado en inventario', productId };
    }
    const current = cake.sizes[size] || 0;
    if (current < quantity) {
      console.log('[STOCK-RESERVATION] Stock insuficiente:', cake.name, size, 'disponible:', current, 'solicitado:', quantity);
      return { ok: false, error: 'Stock insuficiente', available: current, requested: quantity, productId, size };
    }
  }

  for (const it of items) {
    const productId = String(it.productId || it.id || '');
    const size = String(it.size || '10');
    const quantity = Number(it.quantity) || 1;
    const cake = cakes.find(c => String(c.id) === productId);
    cake.sizes[size] = Math.max(0, (cake.sizes[size] || 0) - quantity);
    console.log('[STOCK-RESERVATION] Reservado:', cake.name, size, 'nuevo:', cake.sizes[size]);
  }
  writeCakes(cakes);

  const id = `RES-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
  const reservationItems = items.map(it => ({
    productId: String(it.productId || it.id || ''),
    size: String(it.size || '10'),
    quantity: Number(it.quantity) || 1
  }));
  const reservation = {
    id,
    sessionId: tempSessionId,
    items: reservationItems,
    expiresAt,
    status: 'pending'
  };
  reservationsData.reservations.push(reservation);
  writeStockReservations(reservationsData);
  console.log('[STOCK-RESERVATION] Creada:', id, 'items:', reservationItems.length);
  return { ok: true, reservationId: id, tempSessionId };
}

function updateReservationWithStripeSessionId(tempSessionId, stripeSessionId) {
  const data = readStockReservations();
  const r = data.reservations.find(x => x.sessionId === tempSessionId);
  if (!r) {
    console.log('[STOCK-RESERVATION] No se encontró reserva para temp:', tempSessionId);
    return false;
  }
  r.sessionId = stripeSessionId;
  writeStockReservations(data);
  console.log('[STOCK-RESERVATION] Actualizada sessionId:', r.id, '->', stripeSessionId);
  return true;
}

function findReservationBySessionId(sessionId) {
  const data = readStockReservations();
  return data.reservations.find(r => r.sessionId === sessionId && r.status === 'pending');
}

function expireReservations() {
  const now = Date.now();
  const data = readStockReservations();
  let expired = 0;
  const cakes = readCakes();
  for (const r of data.reservations) {
    if (r.status !== 'pending') continue;
    const expiresAt = new Date(r.expiresAt).getTime();
    if (expiresAt < now) {
      for (const it of r.items) {
        const cake = cakes.find(c => String(c.id) === it.productId);
        if (cake && cake.sizes) {
          const size = String(it.size || '10');
          const qty = Number(it.quantity) || 1;
          cake.sizes[size] = (cake.sizes[size] || 0) + qty;
          console.log('[STOCK-RESERVATION] Expiró, liberado:', cake.name, size, '+', qty);
        }
      }
      r.status = 'expired';
      expired++;
    }
  }
  if (expired > 0) {
    writeCakes(cakes);
    writeStockReservations(data);
    console.log('[STOCK-RESERVATION] Expiraron', expired, 'reservas');
  }
}

// GET /inventory/cakes (requiere autenticación para admin)
app.get('/inventory/cakes', requireAdmin, (req, res) => {
  const cakes = readCakes();
  res.json(cakes);
});

// GET /public/inventory/cakes (público para frontend)
app.get('/public/inventory/cakes', (req, res) => {
  const cakes = readCakes();
  res.json(cakes);
});

// GET /server/data/cake_map.json (público para frontend)
app.get('/server/data/cake_map.json', (req, res) => {
  try {
    const cakeMapPath = path.join(__dirname, 'data', 'cake_map.json');
    const cakeMap = JSON.parse(fs.readFileSync(cakeMapPath, 'utf8'));
    res.json(cakeMap);
  } catch (err) {
    console.error('Error leyendo cake_map.json:', err);
    res.status(500).json({ error: 'Error al cargar mapeo de pasteles' });
  }
});

// POST /inventory/cakes/update
app.post('/inventory/cakes/update', requireAdmin, (req, res) => {
  const updatedCake = req.body;
  const cakes = readCakes();
  
  const index = cakes.findIndex(c => c.id === updatedCake.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Pastel no encontrado' });
  }
  
  cakes[index] = updatedCake;
  writeCakes(cakes);
  res.json(updatedCake);
});

// POST /api/inventory/decrease - Validar contra reservas o descontar (legacy sin sessionId)
app.post('/api/inventory/decrease', (req, res) => {
  try {
    const { productId, size, quantity = 1, sessionId } = req.body;
    
    if (!productId || !size) {
      return res.status(400).json({ error: 'productId y size son requeridos' });
    }
    
    const prodId = String(productId);
    const sz = String(size);
    const qty = Number(quantity) || 1;
    
    if (sessionId) {
      const reservation = findReservationBySessionId(sessionId);
      if (!reservation) {
        console.log('[STOCK-RESERVATION] decrease: no hay reserva válida para sessionId:', sessionId);
        return res.status(400).json({ error: 'No hay reserva válida para esta sesión' });
      }
      const item = reservation.items.find(it => String(it.productId) === prodId && String(it.size) === sz);
      if (!item || (item.quantity || 0) < qty) {
        console.log('[STOCK-RESERVATION] decrease: item no encontrado en reserva o cantidad insuficiente');
        return res.status(400).json({ error: 'Item no encontrado en reserva' });
      }
      const cake = readCakes().find(c => String(c.id) === prodId);
      const currentStock = cake && cake.sizes ? (cake.sizes[sz] || 0) : 0;
      console.log('[STOCK-RESERVATION] decrease: validado contra reserva, stock actual:', currentStock);
      return res.json({
        success: true,
        productId: prodId,
        size: sz,
        previousQuantity: currentStock,
        newQuantity: currentStock,
        cakeName: (cake && cake.name) || 'Producto'
      });
    }
    
    // Sin sessionId: solo validar stock disponible (NO descontar - el descuento real ocurre al reservar en checkout)
    const cakes = readCakes();
    const cake = cakes.find(c => String(c.id) === prodId);
    
    if (!cake || !cake.sizes) {
      console.warn('[INVENTORY UPDATE] Pastel no encontrado:', productId);
      return res.status(404).json({ error: 'Pastel no encontrado en inventario' });
    }
    
    const currentStock = cake.sizes[sz] || 0;
    
    if (currentStock < qty) {
      console.log('[INVENTORY UPDATE] Stock insuficiente:', cake.name, sz, 'Disponible:', currentStock, 'Solicitado:', qty);
      return res.status(400).json({ 
        error: 'Stock insuficiente',
        available: currentStock,
        requested: qty
      });
    }
    
    console.log('[STOCK-RESERVATION] decrease sin sessionId: solo validado, stock:', currentStock);
    res.json({
      success: true,
      productId: prodId,
      size: sz,
      previousQuantity: currentStock,
      newQuantity: currentStock,
      cakeName: cake.name
    });
    
  } catch (error) {
    console.error('Error al descontar inventario:', error);
    res.status(500).json({ error: 'Error al descontar inventario', message: error.message });
  }
});

// POST /api/inventory/increase - No-op en flujo reservas (stock se libera solo al expirar reserva)
app.post('/api/inventory/increase', (req, res) => {
  try {
    const { productId, size, quantity = 1 } = req.body;
    
    if (!productId || !size) {
      return res.status(400).json({ error: 'productId y size son requeridos' });
    }
    
    const cakes = readCakes();
    const cake = cakes.find(c => String(c.id) === String(productId));
    
    if (!cake || !cake.sizes) {
      console.warn('[INVENTORY UPDATE] Pastel no encontrado al recuperar:', productId);
      return res.status(404).json({ error: 'Pastel no encontrado en inventario' });
    }
    
    const currentStock = cake.sizes[size] || 0;
    console.log('[STOCK-RESERVATION] increase: no-op (stock no se descontó en add-to-cart), actual:', currentStock);
    
    res.json({
      success: true,
      productId: String(productId),
      size: size,
      previousQuantity: currentStock,
      newQuantity: currentStock,
      cakeName: cake.name
    });
    
  } catch (error) {
    console.error('Error al recuperar inventario:', error);
    res.status(500).json({ error: 'Error al recuperar inventario', message: error.message });
  }
});

// POST /api/inventory/confirm-payment - Marcar reserva como confirmada tras pago exitoso
app.post('/api/inventory/confirm-payment', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId es requerido' });
    }
    
    const reservation = findReservationBySessionId(sessionId);
    if (!reservation) {
      console.log('[STOCK-RESERVATION] confirm-payment: reserva no encontrada o ya expirada/confirmada:', sessionId);
      return res.status(404).json({ error: 'Reserva no encontrada o expirada' });
    }
    
    reservation.status = 'confirmed';
    const data = readStockReservations();
    const idx = data.reservations.findIndex(r => r.id === reservation.id);
    if (idx >= 0) data.reservations[idx] = reservation;
    writeStockReservations(data);
    
    console.log('[STOCK-RESERVATION] Pago confirmado:', reservation.id, 'sessionId:', sessionId);
    
    res.json({
      success: true,
      reservationId: reservation.id,
      message: 'Reserva confirmada'
    });
    
  } catch (error) {
    console.error('[STOCK-RESERVATION] Error confirm-payment:', error);
    res.status(500).json({ error: 'Error al confirmar pago', message: error.message });
  }
});

// ============================================
// USUARIOS RESERVAS (register / lookup por email + cedulaLast4)
// ============================================
app.post('/api/users/register', (req, res) => {
  try {
    const { name, email, phone, cedulaLast4 } = req.body || {};
    const out = usersReservations.register({ name, email, phone, cedulaLast4 });
    if (!out.ok) {
      return res.status(400).json({ error: out.error });
    }
    res.json({ userId: out.userId });
  } catch (err) {
    console.error('Error en /api/users/register:', err);
    res.status(500).json({ error: 'Error al registrar', message: err.message });
  }
});

app.post('/api/users/lookup', (req, res) => {
  try {
    const { email, cedulaLast4 } = req.body || {};
    const out = usersReservations.lookup(email, cedulaLast4);
    if (!out.ok) {
      if (out.found === false) {
        return res.status(404).json({ error: 'Usuario no encontrado o cedulaLast4 no coincide' });
      }
      return res.status(400).json({ error: out.error });
    }
    res.json({
      userId: out.userId,
      name: out.name,
      email: out.email,
      phone: out.phone
    });
  } catch (err) {
    console.error('Error en /api/users/lookup:', err);
    res.status(500).json({ error: 'Error en lookup', message: err.message });
  }
});

// ============================================
// STOCK DE PASTELES (Takeout - stock general diario)
// ============================================
const STOCK_FILE = path.join(__dirname, 'data', 'stock.json');

function readStock() {
  try {
    const raw = fs.readFileSync(STOCK_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { updatedAt: new Date().toISOString(), items: {} };
  }
}

function writeStock(data) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeStockPayload(body) {
  const updates = {};
  for (const [key, val] of Object.entries(body || {})) {
    const num = typeof val === 'object' && val !== null && 'available' in val
      ? parseInt(val.available, 10) : parseInt(val, 10);
    if (isNaN(num) || num < 0) return null;
    updates[String(key)] = num;
  }
  return updates;
}

// GET /api/stock - devuelve { updatedAt, items: { cakeId: { name, available } } }
app.get('/api/stock', async (req, res) => {
  try {
    let stock = readStock();
    if (!stock.items) {
      const flat = stock;
      stock = { updatedAt: new Date().toISOString(), items: {} };
      for (const [k, v] of Object.entries(flat)) {
        if (k === 'updatedAt') continue;
        stock.items[k] = { name: '', available: Number(v) || 0 };
      }
      if (Object.keys(stock.items).length > 0) writeStock(stock);
    }
    let products = [];
    try {
      products = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json'), 'utf8'));
    } catch (e) {}
    const byId = {};
    (products || []).forEach((p) => { byId[String(p.id)] = p.name || ''; });
    if (!stock.items || Object.keys(stock.items).length === 0) {
      (products || []).forEach((p) => {
        const id = String(p.id);
        stock.items[id] = { name: byId[id] || '', available: 0 };
      });
    } else {
      for (const id of Object.keys(stock.items)) {
        if (!stock.items[id].name && byId[id]) stock.items[id].name = byId[id];
      }
    }
    res.json({ updatedAt: stock.updatedAt || new Date().toISOString(), items: stock.items });
  } catch (e) {
    res.status(500).json({ error: 'Error al cargar stock' });
  }
});

// GET /api/stock/low - productos con stock bajo (inventory_cakes)
const STOCK_ALERTS_FILE = path.join(__dirname, 'data', 'stock-alerts.json');
const LOW_STOCK_THRESHOLD = 3;

function readStockAlerts() {
  try {
    if (!fs.existsSync(STOCK_ALERTS_FILE)) {
      fs.writeFileSync(STOCK_ALERTS_FILE, JSON.stringify({ threshold: 3, lastAlert: {}, alerts: [] }, null, 2), 'utf8');
      return { threshold: 3, lastAlert: {}, alerts: [] };
    }
    const raw = fs.readFileSync(STOCK_ALERTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[STOCK-ALERT] Error leyendo alertas:', e.message);
    return { threshold: 3, lastAlert: {}, alerts: [] };
  }
}

function writeStockAlerts(data) {
  try {
    fs.writeFileSync(STOCK_ALERTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[STOCK-ALERT] Error escribiendo alertas:', e.message);
  }
}

function getLowStockAlerts(threshold = LOW_STOCK_THRESHOLD) {
  const cakes = readCakes();
  const alerts = [];
  for (const cake of cakes) {
    if (!cake.sizes || typeof cake.sizes !== 'object') continue;
    for (const [size, qty] of Object.entries(cake.sizes)) {
      const current = Number(qty) || 0;
      if (current < threshold) {
        alerts.push({
          productId: String(cake.id),
          name: cake.name || 'Producto',
          size: String(size),
          current: current,
          threshold: threshold
        });
      }
    }
  }
  return alerts;
}

app.get('/api/stock/low', (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || LOW_STOCK_THRESHOLD;
    const alerts = getLowStockAlerts(threshold);
    res.json(alerts);
  } catch (e) {
    console.error('[STOCK-ALERT] Error GET /api/stock/low:', e.message);
    res.status(500).json({ error: 'Error al cargar alertas de stock' });
  }
});

function checkLowStockAndAlert() {
  const alerts = getLowStockAlerts();
  if (alerts.length === 0) return;
  const data = readStockAlerts();
  const now = Date.now();
  const cooldownMs = 2 * 60 * 60 * 1000; // 2 horas
  const keysToAlert = [];
  for (const a of alerts) {
    const key = `${a.productId}-${a.size}`;
    const last = data.lastAlert[key] ? new Date(data.lastAlert[key]).getTime() : 0;
    if (now - last >= cooldownMs) keysToAlert.push(key);
  }
  if (keysToAlert.length === 0) return;
  const newAlerts = alerts.filter(a => keysToAlert.includes(`${a.productId}-${a.size}`));
  data.alerts = data.alerts || [];
  const entry = { timestamp: new Date().toISOString(), items: newAlerts };
  data.alerts.push(entry);
  if (data.alerts.length > 100) data.alerts = data.alerts.slice(-100);
  for (const a of newAlerts) {
    data.lastAlert[`${a.productId}-${a.size}`] = new Date().toISOString();
  }
  writeStockAlerts(data);
  console.log('[STOCK-ALERT] Alertas guardadas:', newAlerts.length, newAlerts.map(a => a.name + ' ' + a.size).join(', '));
}

// PUT /api/stock - actualiza stock (require auth admin)
app.put('/api/stock', requireAdmin, (req, res) => {
  try {
    const updates = normalizeStockPayload(req.body);
    if (!updates) return res.status(400).json({ error: 'Stock inválido: valores deben ser números >= 0' });
    const stock = readStock();
    if (!stock.items) stock.items = {};
    let products = [];
    try {
      products = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json'), 'utf8'));
    } catch (e) {}
    const byId = {};
    (products || []).forEach((p) => { byId[String(p.id)] = p.name || ''; });
    for (const [id, available] of Object.entries(updates)) {
      stock.items[id] = { name: (stock.items[id] && stock.items[id].name) || byId[id] || '', available };
    }
    stock.updatedAt = new Date().toISOString();
    writeStock(stock);
    res.json({ updatedAt: stock.updatedAt, items: stock.items, success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar stock' });
  }
});

// ============================================
// CALENDARIO DE RESERVAS + STOCK DIARIO
// ============================================
app.post('/api/availability', (req, res) => {
  try {
    const { days = 14, items = [] } = req.body || {};
    const daysNum = Math.min(Math.max(1, Number(days) || 14), 90);
    const itemsArr = Array.isArray(items) ? items : [];
    const grid = reservationsLib.computeAvailabilityGrid(daysNum, itemsArr);

    if (process.env.NODE_ENV !== 'production') {
      const firstDay = grid.days && grid.days[0];
      const firstSlots = firstDay && Array.isArray(firstDay.slots) ? firstDay.slots : [];
      console.log('availability generated', {
        daysCount: grid.days ? grid.days.length : 0,
        firstDay: firstDay ? { dateKey: firstDay.dateKey, isClosed: firstDay.isClosed, slotsCount: firstSlots.length } : null,
        firstSlots: firstSlots.slice(0, 3)
      });
    }

    res.json(grid);
  } catch (err) {
    console.error('Error en /api/availability:', err);
    res.status(500).json({ error: 'Error al calcular disponibilidad', message: err.message });
  }
});

app.post('/api/reservations/hold', async (req, res) => {
  try {
    const { slotStartAt, items = [], userId, customer = {} } = req.body || {};
    if (!slotStartAt) {
      return res.status(400).json({ error: 'slotStartAt es requerido (ISO)' });
    }
    const itemsArr = Array.isArray(items) ? items : [];
    if (!itemsArr.length) {
      return res.status(400).json({ error: 'items debe ser un array no vacío' });
    }
    const hasUserId = userId != null && userId !== '';
    if (!hasUserId) {
      const n = String(customer?.name || '').trim();
      const e = String(customer?.email || '').trim();
      const p = String(customer?.phone || '').trim();
      if (!n || !e || !p) {
        return res.status(400).json({ error: 'userId o customer (name, email, phone) requeridos' });
      }
    }
    const getById = (id) => usersReservations.getById(id);
    const result = await reservationsLib.createHold(slotStartAt, itemsArr, userId, customer, getById);
    if (!result.success) {
      const payload = { error: result.error };
      if (result.details && process.env.NODE_ENV !== 'production') {
        payload.details = result.details;
      }
      return res.status(400).json(payload);
    }
    res.json({
      reservationId: result.reservationId,
      holdExpiresAt: result.holdExpiresAt
    });
  } catch (err) {
    console.error('Error en /api/reservations/hold:', err);
    res.status(500).json({ error: 'Error al apartar reserva', message: err.message });
  }
});

// GET /api/reservations/validate/:id — valida si la reserva existe, está HELD y no expiró
app.get('/api/reservations/validate/:id', (req, res) => {
  try {
    const id = (req.params.id || '').trim();
    if (!id) return res.status(400).json({ valid: false, error: 'ID requerido' });
    const reservations = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'reservations.json'), 'utf8'));
    const r = reservations.find((x) => String(x.id) === id);
    if (!r) return res.json({ valid: false, reason: 'no_existe' });
    if (r.status !== 'HELD') return res.json({ valid: false, reason: 'expirada_o_invalida' });
    const now = new Date();
    const exp = new Date(r.holdExpiresAt || 0);
    if (exp <= now) return res.json({ valid: false, reason: 'expirada' });
    res.json({
      valid: true,
      dateKey: r.dateKey,
      slotStartAt: r.slotStartAt,
      holdExpiresAt: r.holdExpiresAt
    });
  } catch (e) {
    res.status(500).json({ valid: false, error: 'Error al validar' });
  }
});

// POST /api/reservations/expire — marcar HELD vencidas como EXPIRED y liberar stock
app.post('/api/reservations/expire', async (req, res) => {
  try {
    const { expiredCount } = await reservationsLib.expireHeld();
    res.json({ expiredCount });
  } catch (err) {
    console.error('Error en /api/reservations/expire:', err);
    res.status(500).json({ error: 'Error al expirar reservas', message: err.message });
  }
});

// ============================================
// CUSTOMER DATA & BAKERY CONFIG ENDPOINTS
// ============================================

// Leer configuración del bakery
const bakeryConfigPath = path.join(__dirname, 'data', 'bakery-config.json');
const customersPath = path.join(__dirname, 'data', 'customers.json');
const dailyOrdersPath = path.join(__dirname, 'data', 'daily-orders.json');

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// GET /api/bakery/config — Devuelve configuración pública (timer, min horas, etc)
app.get('/api/bakery/config', (req, res) => {
  try {
    const config = readJSON(bakeryConfigPath, {
      maxOrdersPerDay: 8,
      minHoursInAdvance: 48,
      cartTimerMinutes: 15,
      blockedDays: []
    });
    // Solo enviar lo que el frontend necesita (no notas internas)
    res.json({
      cartTimerMinutes: config.cartTimerMinutes,
      minHoursInAdvance: config.minHoursInAdvance,
      blockedDays: config.blockedDays || []
    });
  } catch (error) {
    console.error('[CONFIG] Error:', error.message);
    res.status(500).json({ error: 'Error leyendo configuración' });
  }
});

// GET /api/bakery/availability?date=YYYY-MM-DD — Verifica disponibilidad de una fecha
app.get('/api/bakery/availability', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Parámetro date requerido (YYYY-MM-DD)' });
    }

    const config = readJSON(bakeryConfigPath, { maxOrdersPerDay: 8, minHoursInAdvance: 48, blockedDays: [] });
    const dailyOrders = readJSON(dailyOrdersPath, {});

    // Verificar si la fecha está bloqueada
    if (config.blockedDays && config.blockedDays.includes(date)) {
      return res.json({ available: false, reason: 'Fecha no disponible', slotsLeft: 0 });
    }

    // Verificar mínimo de horas de anticipación
    const deliveryDate = new Date(date + 'T00:00:00');
    const now = new Date();
    const hoursUntilDelivery = (deliveryDate - now) / (1000 * 60 * 60);

    if (hoursUntilDelivery < config.minHoursInAdvance) {
      return res.json({
        available: false,
        reason: 'Se requieren al menos ' + config.minHoursInAdvance + ' horas de anticipación',
        slotsLeft: 0
      });
    }

    // Verificar cuántos pedidos hay para esa fecha
    const ordersForDate = dailyOrders[date] || 0;
    const slotsLeft = Math.max(0, config.maxOrdersPerDay - ordersForDate);

    res.json({
      available: slotsLeft > 0,
      slotsLeft: slotsLeft,
      maxOrders: config.maxOrdersPerDay,
      reason: slotsLeft > 0 ? 'Disponible' : 'Agenda completa para esta fecha'
    });

  } catch (error) {
    console.error('[AVAILABILITY] Error:', error.message);
    res.status(500).json({ error: 'Error verificando disponibilidad' });
  }
});

// POST /api/customers — Guardar datos del cliente
app.post('/api/customers', (req, res) => {
  try {
    const { firstName, lastName, phone, email, cedulaLast4, deliveryDate, pickupTime } = req.body;

    // Validaciones básicas
    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'Nombre, apellido y teléfono son requeridos' });
    }

    if (!email && !cedulaLast4) {
      return res.status(400).json({ error: 'Email o últimos 4 dígitos de cédula son requeridos' });
    }

    if (!deliveryDate) {
      return res.status(400).json({ error: 'Fecha de entrega es requerida' });
    }

    // Crear registro del cliente
    const customer = {
      id: 'CUST-' + Date.now(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : null,
      cedulaLast4: cedulaLast4 ? cedulaLast4.trim() : null,
      deliveryDate,
      pickupTime: pickupTime || null,
      createdAt: new Date().toISOString(),
      marketingConsent: true // por defecto acepta, se puede cambiar
    };

    // Guardar en customers.json
    const customers = readJSON(customersPath, []);
    customers.push(customer);
    writeJSON(customersPath, customers);

    // Incrementar contador de pedidos para la fecha
    const dailyOrders = readJSON(dailyOrdersPath, {});
    dailyOrders[deliveryDate] = (dailyOrders[deliveryDate] || 0) + 1;
    writeJSON(dailyOrdersPath, dailyOrders);

    console.log('[CUSTOMER] Nuevo cliente guardado:', customer.id, '-', customer.firstName, customer.lastName);
    console.log('[CUSTOMER] Pedidos para', deliveryDate + ':', dailyOrders[deliveryDate]);

    res.json({
      success: true,
      customerId: customer.id,
      message: 'Datos guardados correctamente'
    });

  } catch (error) {
    console.error('[CUSTOMER] Error:', error.message);
    res.status(500).json({ error: 'Error guardando datos del cliente' });
  }
});

// GET /api/customers — Listar todos los clientes
app.get('/api/customers', (req, res) => {
  try {
    const customers = readJSON(customersPath, []);
    // Ordenar por fecha de creación (más reciente primero)
    customers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(customers);
  } catch (error) {
    console.error('[CUSTOMERS] Error:', error.message);
    res.status(500).json({ error: 'Error leyendo clientes' });
  }
});

// DELETE /api/customers/:id — Eliminar un cliente
app.delete('/api/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    let customers = readJSON(customersPath, []);
    const before = customers.length;
    customers = customers.filter(c => c.id !== id);

    if (customers.length === before) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    writeJSON(customersPath, customers);
    console.log('[CUSTOMERS] Cliente eliminado:', id);
    res.json({ success: true });
  } catch (error) {
    console.error('[CUSTOMERS] Error eliminando:', error.message);
    res.status(500).json({ error: 'Error eliminando cliente' });
  }
});

// =========================
//   ARCHIVO Y REPORTES
// =========================

// Archivar manualmente pedidos entregados (botón admin)
app.post('/api/orders/archive', requireAdmin, (req, res) => {
  try {
    const result = archiveDeliveredOrders();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Error archivando pedidos:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Obtener lista de reportes disponibles (fechas archivadas)
app.get('/api/reports', requireAdmin, (req, res) => {
  try {
    const archived = readArchivedOrders();
    const reports = Object.values(archived).map(entry => ({
      date: entry.date,
      archivedAt: entry.archivedAt,
      summary: entry.summary
    })).sort((a, b) => b.date.localeCompare(a.date)); // Más reciente primero

    res.json(reports);
  } catch (error) {
    console.error('Error obteniendo reportes:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Obtener reporte detallado de un día específico
app.get('/api/reports/:date', requireAdmin, (req, res) => {
  try {
    const archived = readArchivedOrders();
    const report = archived[req.params.date];

    if (!report) {
      return res.status(404).json({ ok: false, error: 'Reporte no encontrado para esa fecha' });
    }

    res.json(report);
  } catch (error) {
    console.error('Error obteniendo reporte:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
//   AUTO-ARCHIVE TIMER
// =========================

function scheduleNightlyArchive() {
  const now = new Date();
  const next1159 = new Date(now);
  next1159.setHours(23, 59, 0, 0);

  // Si ya pasó las 11:59 de hoy, programar para mañana
  if (now >= next1159) {
    next1159.setDate(next1159.getDate() + 1);
  }

  const msUntilArchive = next1159.getTime() - now.getTime();
  const hoursUntil = (msUntilArchive / (1000 * 60 * 60)).toFixed(1);
  console.log(`[Archive] Próximo archivo automático en ${hoursUntil} horas (${next1159.toLocaleString()})`);

  setTimeout(() => {
    console.log('[Archive] Ejecutando archivo automático nocturno...');
    archiveDeliveredOrders();
    // Reprogramar para mañana
    scheduleNightlyArchive();
  }, msUntilArchive);
}

// Iniciar timer al arrancar el servidor
scheduleNightlyArchive();

// También limpiar archivos caducados al iniciar
(function cleanupOnStart() {
  const archived = readArchivedOrders();
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  let cleaned = 0;

  Object.keys(archived).forEach(dateStr => {
    const archiveDate = new Date(dateStr + 'T00:00:00');
    if (archiveDate < twoWeeksAgo) {
      delete archived[dateStr];
      cleaned++;
    }
  });

  if (cleaned > 0) {
    writeArchivedOrders(archived);
    console.log(`[Archive] Limpieza inicial: ${cleaned} reportes caducados eliminados.`);
  }
})();

// Iniciar servidor (0.0.0.0 = todas las interfaces)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍰 The Bakery Server running on http://127.0.0.1:${PORT} (listening on 0.0.0.0:${PORT})`);
  console.log(`📦 Frontend URL: ${FRONTEND_URL}`);
  console.log(`💳 Stripe configured: ${!!(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('XXXX'))}\n`);
  
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('XXXX')) {
    console.log('⚠️  ADVERTENCIA: Stripe no está configurado.');
    console.log('   Por favor, configura tus claves en server/.env\n');
  }

  // Cron: expirar reservas temporales cada 2 minutos
  setInterval(() => {
    try {
      expireReservations();
    } catch (e) {
      console.error('[STOCK-RESERVATION] Error en cron expire:', e.message);
    }
  }, 2 * 60 * 1000);
  console.log('[STOCK-RESERVATION] Cron expiración reservas: cada 2 min');

  // Cron: verificar stock bajo cada 5 minutos
  setInterval(() => {
    try {
      checkLowStockAndAlert();
    } catch (e) {
      console.error('[STOCK-ALERT] Error en cron stock bajo:', e.message);
    }
  }, 5 * 60 * 1000);
  console.log('[STOCK-ALERT] Cron stock bajo: cada 5 min');
});


