# The Bakery Server - Guía de Instalación

Este es el servidor backend para The Bakery by Fresarte, que maneja la integración con Stripe para procesar pagos.

## 📋 Requisitos Previos

- Node.js (versión 14 o superior)
- npm (viene con Node.js)
- Cuenta de Stripe (puedes crear una gratis en https://stripe.com)

## 🚀 Instalación

### 1. Instalar dependencias

```bash
cd server
npm install
```

### 2. Configurar Stripe

1. Crea una cuenta en [Stripe](https://stripe.com) si no tienes una
2. Ve al [Dashboard de Stripe](https://dashboard.stripe.com/test/apikeys)
3. Copia tu **Clave Secreta** (Secret Key) y tu **Clave Pública** (Publishable Key)
4. Crea un archivo `.env` en la carpeta `server/`:

```bash
cp .env.example .env
```

5. Edita el archivo `.env` y pega tus claves:

```env
STRIPE_SECRET_KEY=sk_test_tu_clave_secreta_aqui
STRIPE_PUBLISHABLE_KEY=pk_test_tu_clave_publica_aqui
PORT=3000
FRONTEND_URL=http://localhost:5500
```

**⚠️ IMPORTANTE:** 
- Usa las claves de **TEST** (empiezan con `sk_test_` y `pk_test_`)
- Nunca compartas tus claves secretas
- El archivo `.env` está en `.gitignore` y no se subirá a Git

### 3. Iniciar el servidor

**Modo desarrollo (con auto-reload):**
```bash
npm run dev
```

**Modo producción:**
```bash
npm start
```

El servidor estará corriendo en `http://localhost:3000`

## 🔧 Configuración del Frontend

Asegúrate de que tu servidor frontend (Live Server, etc.) esté corriendo en el puerto configurado en `FRONTEND_URL` (por defecto `http://localhost:5500`).

Si usas un puerto diferente, actualiza `FRONTEND_URL` en el archivo `.env`.

## 📝 Endpoints Disponibles

### `POST /create-checkout-session`
Crea una sesión de checkout de Stripe.

**Body:**
```json
{
  "items": [
    {
      "name": "Pastel de Chocolate",
      "basePrice": 1500,
      "quantity": 1,
      "image": "url-de-imagen"
    }
  ],
  "customerEmail": "cliente@ejemplo.com",
  "customerName": "Nombre Cliente"
}
```

**Response:**
```json
{
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/..."
}
```

### `GET /checkout-session/:sessionId`
Verifica el estado de una sesión de checkout.

### `POST /api/orders`
Crea un nuevo pedido después del pago exitoso.

**Body:**
```json
{
  "id": "ORD-1763590462748",
  "sessionId": "cs_test_...",
  "customerEmail": "cliente@ejemplo.com",
  "customerName": "Nombre Cliente",
  "items": [...],
  "total": 2950,
  "status": "Pendiente"
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "ORD-1763590462748",
  "order": {...}
}
```

### `GET /api/orders`
Obtiene todos los pedidos.

### `PUT /api/orders/:id/status`
Actualiza el estado de un pedido.

### `DELETE /api/orders/:id`
Elimina un pedido.

### `GET /health`
Verifica el estado del servidor y la configuración de Stripe.

## 🧪 Probar el Sistema

1. Inicia el servidor backend: `npm start`
2. Abre tu frontend en el navegador
3. Agrega productos al carrito
4. Ve a `cart.html` y haz clic en "Finalizar Pedido"
5. Serás redirigido a Stripe Checkout
6. Usa una tarjeta de prueba:
   - **Número:** `4242 4242 4242 4242`
   - **Fecha:** Cualquier fecha futura
   - **CVC:** Cualquier 3 dígitos
   - **Código Postal:** Cualquier código postal

## 🔒 Seguridad

- Las claves secretas nunca deben estar en el código del frontend
- El servidor valida todas las solicitudes
- Los pagos se procesan a través de Stripe (PCI compliant)

## 📚 Recursos

- [Documentación de Stripe](https://stripe.com/docs)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Stripe Dashboard](https://dashboard.stripe.com)

## 📅 Calendario de reservas y stock diario

Slots 1h (10:00–20:00), lead time 24h, festivos y stock por día/producto. Respuestas en formato grid para UI.

### `POST /api/users/register`

Registro (o actualización por email). Hash de `cedulaLast4` con SHA-256 + salt (`CEDULA_SALT` en `.env`).

**Body:** `{ "name", "email", "phone", "cedulaLast4" }` (cedulaLast4 = 4 dígitos)

**Response:** `{ "userId" }`

```bash
curl -s -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Maria Lopez","email":"maria@ejemplo.com","phone":"8095551234","cedulaLast4":"1234"}'
```

### `POST /api/users/lookup`

Busca por email y valida `cedulaLast4` (hash). 404 si no coincide.

**Body:** `{ "email", "cedulaLast4" }`

**Response:** `200 { "userId", "name", "email", "phone" }` | `404`

```bash
curl -s -X POST http://localhost:3000/api/users/lookup \
  -H "Content-Type: application/json" \
  -d '{"email":"maria@ejemplo.com","cedulaLast4":"1234"}'
```

### `POST /api/availability`

Grid de días con slots (formato UI). Incluye días cerrados (`isClosed`, `reason`).

**Body:** `{ "days": 14, "items": [{ "productId", "qty" }] }`

**Response:**
```json
{
  "timezone": "America/Santo_Domingo",
  "days": [
    { "dateKey": "2026-01-26", "isClosed": false, "reason": null, "slots": [
      { "startAt": "…", "endAt": "…", "isAvailable": true }
    ]},
    { "dateKey": "2026-01-27", "isClosed": true, "reason": "HOLIDAY_CLOSED", "slots": [] }
  ]
}
```

```bash
curl -s -X POST http://localhost:3000/api/availability \
  -H "Content-Type: application/json" \
  -d '{"days":14,"items":[{"productId":"cake_choco_8","qty":1}]}'
# O con archivo: curl ... -d @test-availability.json
```

### `POST /api/reservations/hold`

Aparta slot y reserva stock (hold 10 min). `userId` **o** `customer` (name, email, phone) obligatorios.

**Body:** `{ "slotStartAt": ISO, "items": [{ "productId", "qty" }], "userId"?, "customer"? }`

**Response:** `{ "reservationId", "holdExpiresAt" }`

```bash
# Con customer:
curl -s -X POST http://localhost:3000/api/reservations/hold \
  -H "Content-Type: application/json" \
  -d '{"slotStartAt":"2026-01-26T15:00:00.000Z","items":[{"productId":"cake_choco_8","qty":1}],"customer":{"name":"Maria","phone":"8095551234","email":"maria@ejemplo.com"}}'

# Con userId (tras register/lookup):
curl -s -X POST http://localhost:3000/api/reservations/hold \
  -H "Content-Type: application/json" \
  -d '{"slotStartAt":"2026-01-26T15:00:00.000Z","items":[{"productId":"cake_choco_8","qty":1}],"userId":1}'
```

### `POST /api/reservations/expire`

Marca HELD vencidas como EXPIRED y libera stock.

**Response:** `{ "expiredCount" }`

```bash
curl -s -X POST http://localhost:3000/api/reservations/expire \
  -H "Content-Type: application/json" -d "{}"
```

### Archivos de datos

- `server/data/business_hours.json`: `timezone`, `default.open` / `default.close`
- `server/data/holidays.json`: `closed` (YYYY-MM-DD), `specialHours` (fecha → `{ open, close }`)
- `server/data/reservations.json`: array de reservas
- `server/data/users_reservations.json`: usuarios para reservas (register/lookup). `users.json` sigue para auth admin.
- `server/data/inventory_cakes_daily.json`: stock diario `{ "YYYY-MM-DD": { "productId": { "available", "reserved" } } }`

---

## ❓ Solución de Problemas

### Error: "Stripe no está configurado"
- Verifica que el archivo `.env` existe y tiene las claves correctas
- Asegúrate de que las claves no contengan espacios

### Error: "CORS"
- Verifica que `FRONTEND_URL` en `.env` coincida con la URL de tu frontend
- Asegúrate de que el servidor backend esté corriendo

### Error: "Cannot find module"
- Ejecuta `npm install` en la carpeta `server/`


