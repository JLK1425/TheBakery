/**
 * The Bakery by Fresarte - Backend Server
 * Integración con Stripe para pagos
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..'))); // Servir archivos estáticos del proyecto

// Rutas de datos (para compatibilidad con el frontend)
app.get('/api/products', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'pasteles-autor.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar productos' });
  }
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
      const data = await fs.readFile(usersPath, 'utf8');
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
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');

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
      const data = await fs.readFile(usersPath, 'utf8');
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
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');

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
    
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('XXXX')) {
      return res.status(500).json({ 
        error: 'Stripe no está configurado',
        message: 'Por favor, configura tus claves en el archivo .env'
      });
    }
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
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
      metadata: session.metadata
    });
  } catch (error) {
    console.error('Error al verificar sesión:', error);
    res.status(500).json({ 
      error: 'Error al verificar la sesión',
      message: error.message 
    });
  }
});

// Guardar pedido después del pago exitoso
app.post('/save-order', async (req, res) => {
  try {
    const { sessionId, items, total, customerEmail, customerName } = req.body;
    
    console.log('Guardando pedido:', {
      sessionId,
      itemsCount: items ? items.length : 0,
      total,
      customerEmail,
      customerName
    });

    if (!items || items.length === 0) {
      return res.status(400).json({ 
        error: 'No se proporcionaron items',
        message: 'El pedido debe contener al menos un producto'
      });
    }

    // Leer orders.json existente
    const ordersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'orders.json');
    let orders = [];
    
    try {
      const data = await fs.readFile(ordersPath, 'utf8');
      orders = JSON.parse(data);
      console.log('Pedidos existentes cargados:', orders.length);
    } catch (error) {
      // Si el archivo no existe, crear array vacío
      console.log('Creando nuevo archivo orders.json');
    }

    // Verificar si el pedido ya existe (por sessionId)
    const existingOrder = orders.find(o => o.sessionId === sessionId);
    if (existingOrder) {
      console.log('Pedido ya existe:', existingOrder.id);
      return res.json({ 
        success: true, 
        orderId: existingOrder.id,
        message: 'Pedido ya existente',
        existing: true
      });
    }

    // Crear nuevo pedido
    const newOrder = {
      id: `ORD-${Date.now()}`,
      sessionId: sessionId,
      customerEmail: customerEmail || 'sin-email@ejemplo.com',
      customerName: customerName || 'Cliente',
      items: items,
      total: total,
      status: 'Pendiente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    orders.push(newOrder);

    // Guardar en orders.json
    await fs.writeFile(ordersPath, JSON.stringify(orders, null, 2), 'utf8');
    
    console.log('Pedido guardado exitosamente:', newOrder.id);

    res.json({ 
      success: true, 
      orderId: newOrder.id,
      message: 'Pedido guardado correctamente' 
    });

  } catch (error) {
    console.error('Error al guardar pedido:', error);
    res.status(500).json({ 
      error: 'Error al guardar el pedido',
      message: error.message 
    });
  }
});

// ========== ADMIN ROUTES ==========
// Obtener todos los pedidos
app.get('/api/orders', async (req, res) => {
  try {
    const ordersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'orders.json');
    let orders = [];
    
    try {
      const data = await fs.readFile(ordersPath, 'utf8');
      orders = JSON.parse(data);
    } catch (error) {
      // Si el archivo no existe, retornar array vacío
      console.log('orders.json no existe, retornando array vacío');
    }

    res.json(orders);
  } catch (error) {
    console.error('Error al cargar pedidos:', error);
    res.status(500).json({ 
      error: 'Error al cargar pedidos',
      message: error.message 
    });
  }
});

// Obtener un pedido específico por ID (para tracking)
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const ordersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'orders.json');
    let orders = [];
    
    try {
      const data = await fs.readFile(ordersPath, 'utf8');
      orders = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'No se encontraron pedidos' });
    }

    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error al cargar pedido:', error);
    res.status(500).json({ 
      error: 'Error al cargar el pedido',
      message: error.message 
    });
  }
});

// Actualizar estado de un pedido
app.put('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'El estado es requerido' });
    }

    // Validar que el estado sea válido
    const validStatuses = ['Pendiente', 'En preparación', 'Listo', 'En camino', 'Entregado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Leer pedidos
    const ordersPath = path.join(__dirname, '..', 'TheBakery', 'assets', 'data', 'orders.json');
    let orders = [];
    
    try {
      const data = await fs.readFile(ordersPath, 'utf8');
      orders = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'No se encontraron pedidos' });
    }

    // Buscar y actualizar el pedido
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();

    // Guardar cambios
    await fs.writeFile(ordersPath, JSON.stringify(orders, null, 2), 'utf8');

    res.json(orders[orderIndex]);

  } catch (error) {
    console.error('Error al actualizar estado:', error);
    res.status(500).json({ 
      error: 'Error al actualizar el estado',
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


