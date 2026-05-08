# The Bakery by Fresarte — Instrucciones Clave del Proyecto

## Qué es
E-commerce de repostería artesanal en Santo Domingo, RD.
Pasteles de autor por encargo, pago en línea con tarjeta (CardNet).

---

## Tono de marca
- **Artesanal y premium** — cada pastel es "una obra maestra"
- **Cálido y cercano** — tuteo, emojis discretos, español dominicano
- **Confianza** — mostrar reseñas verificadas, número de pedido visible, tracking en tiempo real
- Nunca usar jerga técnica con el cliente final

---

## Productos
| ID | Nombre | Categoría |
|----|--------|-----------|
| 1 | Pastel de Coco | pastel |
| 2 | Matcha Strawberry | pastel |
| 4 | Pastel de Fresas | pastel |
| 5 | Pastel de Arándanos | pastel |
| 6 | Pastel Lemon Pie | pastel |
| 7 | Pastel de Chinola | pastel |
| 8 | Mini Cake Fresas | mini-cake |
| 9 | Fresas con Crema | postre |

Variantes por tamaño (pulgadas). Stock gestionado en Railway volume (`inventory_cakes.json`).

---

## Reglas de formato (código)

### Version bumps — SIEMPRE al modificar un JS o CSS
```html
<!-- Antes -->
<script src="TheBakery/assets/js/tracking.js?v=6"></script>
<!-- Después de cualquier cambio en tracking.js -->
<script src="TheBakery/assets/js/tracking.js?v=7"></script>
```
DreamHost cachea. Sin bump el navegador sirve la versión vieja.

### Rutas de datos en server.js — usar DATA_DIR
```js
// CORRECTO
const file = path.join(DATA_DIR, 'orders.json');
// MAL — no funciona en Railway
const file = path.join(__dirname, 'data', 'orders.json');
```

### Submodule workflow
```bash
# 1. Commitear dentro del submodule
cd TheBakery && git add ... && git commit
# 2. Commitear en el repo padre
cd .. && git add TheBakery && git commit && git push
```

### FormData para reseñas (foto opcional)
```js
const fd = new FormData();
fd.append('name', name);
fd.append('rating', rating);
fd.append('comment', comment);
fd.append('title', title);          // opcional
if (photoFile) fd.append('photo', photoFile);  // opcional
fetch('/public/reviews', { method: 'POST', body: fd });
```

---

## Endpoints públicos clave
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/public/inventory/cakes` | Catálogo de productos con variantes y stock |
| GET | `/api/orders/:id` | Estado de un pedido |
| POST | `/api/pay/session` | Iniciar pago CardNet |
| POST | `/public/reviews` | Enviar reseña (multipart/form-data) |
| GET | `/public/reviews` | Reseñas aprobadas |

---

## Flujos críticos

### Pago con descuento al 100%
`cart.js` detecta `{ freeOrder: true, orderId }` en la respuesta → limpia carrito → redirige a `mi-pedido.html?id=ORD-XXX`.

### Auto-refresh en tracking
`mi-pedido.html` auto-refresca cada 10 s llamando `loadOrder()` de nuevo. El modal de reseña vive FUERA de `trackingContent` para no perderse en cada refresh.

### Deploy
- **Backend**: push a `main` → Railway auto-deploys
- **Frontend**: subir archivos modificados a DreamHost vía FTP/SFTP

---

## Archivos más sensibles
- `server/server.js` — toda la lógica del backend (~2,700 líneas)
- `server/data/` — datos en producción (Railway volume, no commitear)
- `server/seeds/` — datos iniciales (sí commitear)
- `TheBakery/assets/js/cart.js` — flujo de checkout
- `TheBakery/assets/js/tracking.js` — página de pedido del cliente
