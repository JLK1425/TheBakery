# Guía de Debug - The Bakery by Fresarte

## Problemas Comunes y Soluciones

### 1. Error en success.html: "Error al Procesar"

**Síntomas:**
- El pago se completa en Stripe
- Pero aparece error en success.html

**Posibles causas:**
1. El servidor backend no está corriendo
2. CORS bloqueando las peticiones
3. El carrito se limpió antes de guardar el pedido

**Soluciones:**

#### Verificar que el servidor esté corriendo:
```bash
cd server
npm start
```

Deberías ver:
```
🍰 The Bakery Server running on http://localhost:3000
```

#### Verificar CORS:
- Asegúrate de que `FRONTEND_URL` en `.env` coincida con tu URL del frontend
- Por defecto: `FRONTEND_URL=http://localhost:5500`

#### Verificar en la consola del navegador:
1. Abre las DevTools (F12)
2. Ve a la pestaña "Console"
3. Busca errores de red o CORS
4. Ve a la pestaña "Network"
5. Verifica que las peticiones a `localhost:3000` estén funcionando

### 2. Error en mi-pedido.html: "No se proporcionó un ID de pedido"

**Síntomas:**
- El link de tracking no tiene el ID del pedido

**Solución:**
- Verifica que el link en success.html tenga el formato: `mi-pedido.html?id=ORD-XXXXX`
- El ID debe generarse correctamente en el servidor

### 3. Error en admin/pedidos.html: "Error al cargar pedidos"

**Síntomas:**
- El dashboard no muestra los pedidos

**Soluciones:**

#### Verificar que orders.json existe:
```bash
Test-Path "TheBakery\assets\data\orders.json"
```

#### Verificar que el servidor esté corriendo
#### Verificar que el endpoint funcione:
Abre en el navegador: `http://localhost:3000/api/orders`

Deberías ver un JSON con los pedidos.

### 4. El carrito se vacía antes de guardar el pedido

**Solución:**
- Ya está corregido en el código actualizado
- El carrito solo se limpia DESPUÉS de guardar exitosamente el pedido

### 5. Verificar logs del servidor

El servidor ahora muestra logs detallados:
- Cuando se verifica una sesión
- Cuando se guarda un pedido
- Errores con detalles

Revisa la consola del servidor para ver qué está pasando.

## Comandos Útiles

### Iniciar el servidor:
```bash
cd server
npm start
```

### Verificar que el servidor esté corriendo:
```bash
curl http://localhost:3000/health
```

O abre en el navegador: `http://localhost:3000/health`

### Verificar pedidos:
```bash
curl http://localhost:3000/api/orders
```

## Checklist de Verificación

Antes de probar el flujo completo:

- [ ] Servidor backend corriendo en `localhost:3000`
- [ ] Frontend corriendo en `localhost:5500` (o el puerto configurado)
- [ ] Stripe configurado en `server/.env`
- [ ] CORS configurado correctamente
- [ ] Archivo `orders.json` existe y es accesible
- [ ] Consola del navegador abierta para ver errores
- [ ] Consola del servidor abierta para ver logs

## Prueba del Flujo Completo

1. **Agregar productos al carrito**
   - Verifica que se guarden en localStorage
   - Abre DevTools > Application > Local Storage > `bakeryCart`

2. **Ir a cart.html**
   - Verifica que se muestren los productos
   - Click en "Finalizar Pedido"

3. **Pago en Stripe**
   - Usa tarjeta de prueba: `4242 4242 4242 4242`
   - Completa el pago

4. **success.html**
   - Verifica en la consola que se verifique la sesión
   - Verifica que se guarde el pedido
   - Verifica que se muestre el ID del pedido

5. **mi-pedido.html**
   - Click en "Rastrear Pedido"
   - Verifica que se cargue el pedido correctamente

6. **admin/pedidos.html**
   - Verifica que se muestren todos los pedidos
   - Prueba cambiar el estado de un pedido

