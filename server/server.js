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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const reservationsLib = require('./lib/reservations');
const usersReservations = require('./lib/users-reservations');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';
const TEST_MODE = process.env.TEST_MODE === 'true';

// ---------------- CORS (con credentials: true no usar "*"; origin debe ser explícito) ----------------
const CORS_ORIGINS = [
  FRONTEND_URL,
  'http://127.0.0.1:5503',
  'http://localhost:5503',
  'http://127.0.0.1:5502',
  'http://localhost:5502',
  'http://127.0.0.1:5501',
  'http://localhost:5501'
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || CORS_ORIGINS.includes(origin)) {
      cb(null, origin || CORS_ORIGINS[0]);
    } else {
      cb(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// -------------------------------------


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

// =========================
//     AUTH MIDDLEWARE
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

// Middleware (CORS ya aplicado arriba con credentials)
app.use(express.json());
app.use(cookieParser());
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

// Crear sesión de checkout de Stripe
app.post('/create-checkout-session', async (req, res) => {
  try {
    console.log('=== INICIO CHECKOUT SESSION ===');
    const { line_items, items, total, customerEmail, customerName } = req.body;

    console.log('Datos recibidos:', {
      line_items_count: line_items?.length || 0,
      items_count: items?.length || 0,
      total: total,
      customerEmail: customerEmail
    });

    // Validar que tenemos line_items
    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
      console.error('Error: line_items vacío o inválido');
      return res.status(400).json({ error: 'El carrito está vacío o el formato de items es incorrecto' });
    }

    // Validar que tenemos la clave de Stripe
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('XXXX')) {
      console.error('Error: Stripe no configurado');
      return res.status(500).json({ 
        error: 'Stripe no está configurado. Por favor, configura tus claves en el archivo .env' 
      });
    }

    console.log('Stripe configurado correctamente');

    // Calcular total si no se proporcionó
    let orderTotal = total;
    if (!orderTotal && items && items.length > 0) {
      orderTotal = items.reduce((sum, item) => {
        const price = typeof item.basePrice === 'number' 
          ? item.basePrice 
          : parseFloat((item.price || item.basePrice || '0').replace(/[^0-9.]/g, ''));
        return sum + (price * (item.quantity || 1));
      }, 0);
      orderTotal = orderTotal * 1.18; // Agregar ITBIS
    }

    // Normalizar URLs de imágenes en line_items (reemplazar espacios por guiones bajos)
    let normalizedItems = line_items;
    if (line_items && Array.isArray(line_items)) {
      normalizedItems = line_items.map((item, index) => {
        if (item.price_data?.product_data?.images && Array.isArray(item.price_data.product_data.images)) {
          item.price_data.product_data.images = item.price_data.product_data.images.map(imgUrl => {
            if (typeof imgUrl === 'string') {
              const originalUrl = imgUrl;
              // Normalizar: reemplazar espacios por guiones bajos en nombres de archivo
              imgUrl = imgUrl.replace(/cake (\d+)\.png/g, 'cake_$1.png')
                          .replace(/cake autor (\d+)\.png/g, 'cake_autor_$1.png')
                          .replace(/([^\/]+) ([\w\d]+\.png)/g, '$1_$2');
              
              if (originalUrl !== imgUrl) {
                console.log(`Imagen normalizada [item ${index}]: "${originalUrl}" -> "${imgUrl}"`);
              }
              
              // Validar que no tenga espacios
              if (imgUrl.includes(' ')) {
                console.warn(`⚠️ Advertencia: URL aún contiene espacios [item ${index}]: "${imgUrl}"`);
              }
              
              return imgUrl;
            }
            return imgUrl;
          });
        }
        return item;
      });
    }
    
    console.log('Line items normalizados:', normalizedItems.length);

    // Preparar items para metadata (usar items del body o construir desde line_items)
    let itemsForMetadata = items || [];
    if (itemsForMetadata.length === 0 && normalizedItems) {
      // Construir items desde line_items como fallback
      itemsForMetadata = normalizedItems.map((lineItem, index) => ({
        id: `item-${index}`,
        productId: `item-${index}`,
        name: lineItem.price_data?.product_data?.name || 'Producto',
        price: `RD$${(lineItem.price_data.unit_amount / 100).toFixed(2)}`,
        basePrice: lineItem.price_data.unit_amount / 100,
        quantity: lineItem.quantity || 1,
        image: lineItem.price_data?.product_data?.images?.[0] || '',
        size: '',
        message: '',
        giftCard: false,
        addon: '',
        addonPrice: 0
      }));
    }

    // Preparar metadata reducido para Stripe (máximo 500 caracteres por campo)
    // Solo enviar resumen corto, no el JSON completo
    const itemsCount = itemsForMetadata.length;
    const productIds = itemsForMetadata.map(item => item.productId || item.id || '').filter(id => id).join(',');
    const metadataTotal = orderTotal ? orderTotal.toString() : '0';

    // Crear sesión de checkout con line_items directamente de Stripe
    console.log('Creando sesión de Stripe...');
    console.log('Primer line_item ejemplo:', JSON.stringify(normalizedItems[0], null, 2));
    console.log('Metadata reducido:', { itemsCount, productIds: productIds.substring(0, 50) + '...', total: metadataTotal });
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: normalizedItems, // Usar normalizedItems con URLs normalizadas
      mode: 'payment',
      success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel.html`,
      customer_email: customerEmail || undefined,
      metadata: {
        customerName: customerName || 'Cliente',
        customerEmail: customerEmail || '',
        itemsCount: itemsCount.toString(),
        productIds: productIds.substring(0, 200), // Limitar a 200 caracteres para estar seguro
        orderTotal: metadataTotal
      },
      locale: 'es'
    });

    console.log('✅ Sesión creada exitosamente:', session.id);
    console.log('URL de checkout:', session.url);

    res.json({ 
      sessionId: session.id,
      url: session.url 
    });

  } catch (error) {
    console.error('Error al crear sesión de checkout:', error);
    console.error('Error details:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      raw: error.raw
    });
    res.status(500).json({ 
      error: 'Error al procesar el pago',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        type: error.type,
        code: error.code
      } : undefined
    });
  }
});

// Verificar estado de la sesión (para success.html)
app.get('/checkout-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('Verificando sesión de checkout:', sessionId);
    
    // Si TEST_MODE está activo, devolver datos falsos
    if (TEST_MODE) {
      console.warn('⚠️ TEST MODE: checkout-session está devolviendo datos falsos');
      
      return res.json({
        id: sessionId,
        payment_status: 'paid',
        amount_total: 12345,
        currency: 'dop',
        customer_email: 'test@example.com',
        metadata: {
          customerName: 'Cliente de Prueba'
        },
        line_items: {
          data: [
            {
              price: {
                id: 'price_test_1',
                product: 'prod_test_2'
              },
              description: 'Pastel de Prueba',
              quantity: 1,
              amount_total: 12345
            }
          ]
        }
      });
    }
    
    // Modo normal: usar Stripe real
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('XXXX')) {
      return res.status(500).json({ 
        error: 'Stripe no está configurado',
        message: 'Por favor, configura tus claves en el archivo .env'
      });
    }
    
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    
    console.log('Sesión recuperada:', {
      id: session.id,
      payment_status: session.payment_status,
      customer_email: session.customer_email
    });
    
    res.json({
      id: session.id,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_email,
      metadata: session.metadata,
      line_items: session.line_items
    });
  } catch (error) {
    console.error('Error al verificar sesión:', error);
    res.status(500).json({ 
      error: 'Error al verificar la sesión',
      message: error.message 
    });
  }
});


// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'The Bakery Server is running',
    stripe_configured: !!(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('XXXX'))
  });
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

// Obtener todos los pedidos
app.get('/api/orders', (req, res) => {
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

// Actualizar estado de un pedido
app.put('/api/orders/:id/status', (req, res) => {
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
app.delete('/api/orders/all', requireAuth, (req, res) => {
  try {
    writeOrders([]);
    res.json({ success: true, message: 'Todos los pedidos fueron eliminados' });
  } catch (error) {
    console.error('Error eliminando todos los pedidos:', error);
    res.status(500).json({ error: 'Error al eliminar pedidos' });
  }
});

app.delete('/api/orders/:id', (req, res) => {
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

// Login de usuario
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  try {
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const token = jwt.sign(
      { id: user.id, role: user.role },
      secret,
      { expiresIn: '8h' }
    );

    // Cookie HTTPOnly para que el navegador la envíe automáticamente
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false, // en local debe ser false
    });
    

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno en login' });
  }
});

// Ruta para verificar sesión actual (útil para proteger ADM desde el frontend)
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const payload = jwt.verify(token, secret);
    const users = readUsers();
    const user = users.find(u => u.id === payload.id);

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Error verificando token:', err);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
  res.json({ message: 'Sesión cerrada correctamente' });
});

// =========================
//      USER MANAGEMENT
// =========================

// Obtener lista de usuarios (solo SuperAdmin)
app.get('/api/users', requireAuth, requireSuperAdmin, (req, res) => {
  const users = readUsers();
  const safeUsers = users.map(({ passwordHash, ...rest }) => rest);
  res.json(safeUsers);
});

// Crear usuario (solo SuperAdmin)
app.post('/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
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
app.get('/inventory/ingredients', requireAuth, (req, res) => {
  const ingredients = readIngredients();
  res.json(ingredients);
});

// POST /inventory/ingredients/update
app.post('/inventory/ingredients/update', requireAuth, (req, res) => {
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
app.post('/inventory/ingredients/add', requireAuth, (req, res) => {
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

// GET /inventory/cakes (requiere autenticación para admin)
app.get('/inventory/cakes', requireAuth, (req, res) => {
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
app.post('/inventory/cakes/update', requireAuth, (req, res) => {
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

// POST /api/inventory/decrease - Descontar inventario al agregar al carrito
app.post('/api/inventory/decrease', (req, res) => {
  try {
    const { productId, size, quantity = 1 } = req.body;
    
    if (!productId || !size) {
      return res.status(400).json({ error: 'productId y size son requeridos' });
    }
    
    const cakes = readCakes();
    const cake = cakes.find(c => String(c.id) === String(productId));
    
    if (!cake || !cake.sizes) {
      console.warn('[INVENTORY UPDATE] Pastel no encontrado:', productId);
      return res.status(404).json({ error: 'Pastel no encontrado en inventario' });
    }
    
    const currentStock = cake.sizes[size] || 0;
    
    if (currentStock < quantity) {
      console.log('[INVENTORY UPDATE] Stock insuficiente:', cake.name, size, 'Disponible:', currentStock, 'Solicitado:', quantity);
      return res.status(400).json({ 
        error: 'Stock insuficiente',
        available: currentStock,
        requested: quantity
      });
    }
    
    const newQuantity = currentStock - quantity;
    cake.sizes[size] = Math.max(0, newQuantity);
    
    writeCakes(cakes);
    
    console.log('[INVENTORY UPDATE]', cake.name, size, newQuantity);
    
    res.json({
      success: true,
      productId: String(productId),
      size: size,
      previousQuantity: currentStock,
      newQuantity: cake.sizes[size],
      cakeName: cake.name
    });
    
  } catch (error) {
    console.error('Error al descontar inventario:', error);
    res.status(500).json({ error: 'Error al descontar inventario', message: error.message });
  }
});

// POST /api/inventory/increase - Recuperar inventario al eliminar del carrito
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
    const newQuantity = currentStock + quantity;
    cake.sizes[size] = newQuantity;
    
    writeCakes(cakes);
    
    console.log('[INVENTORY UPDATE]', cake.name, size, newQuantity);
    
    res.json({
      success: true,
      productId: String(productId),
      size: size,
      previousQuantity: currentStock,
      newQuantity: cake.sizes[size],
      cakeName: cake.name
    });
    
  } catch (error) {
    console.error('Error al recuperar inventario:', error);
    res.status(500).json({ error: 'Error al recuperar inventario', message: error.message });
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

// PUT /api/stock - actualiza stock (require auth admin)
app.put('/api/stock', requireAuth, (req, res) => {
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🍰 The Bakery Server running on http://localhost:${PORT}`);
  console.log(`📦 Frontend URL: ${FRONTEND_URL}`);
  console.log(`💳 Stripe configured: ${!!(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('XXXX'))}\n`);
  
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('XXXX')) {
    console.log('⚠️  ADVERTENCIA: Stripe no está configurado.');
    console.log('   Por favor, configura tus claves en server/.env\n');
  }
});


