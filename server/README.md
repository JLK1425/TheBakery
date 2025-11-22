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

### `POST /save-order`
Guarda un pedido después del pago exitoso.

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

## ❓ Solución de Problemas

### Error: "Stripe no está configurado"
- Verifica que el archivo `.env` existe y tiene las claves correctas
- Asegúrate de que las claves no contengan espacios

### Error: "CORS"
- Verifica que `FRONTEND_URL` en `.env` coincida con la URL de tu frontend
- Asegúrate de que el servidor backend esté corriendo

### Error: "Cannot find module"
- Ejecuta `npm install` en la carpeta `server/`


