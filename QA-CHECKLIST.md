# QA Checklist - TheBakery

## Pruebas manuales tras cambios

### 1) Botón "Reservar fecha y hora"
- [ ] **Carrito con items y sin reserva**: Se ve "Reservar fecha y hora" y NO deja ir a pago
- [ ] **Al reservar**: Se oculta "Reservar...", se habilita "Continuar a pago", se muestra label con fecha/hora reservada
- [ ] **Cambiar reserva**: Botón "Cambiar reserva" abre el modal y permite elegir otra hora
- [ ] **reservationId inválido**: Si localStorage tiene ID expirado o inexistente, el sistema lo detecta, limpia y vuelve a pedir reserva (muestra "Reservar fecha y hora")

### 2) Admin pedidos
- [ ] **Cards alineadas**: Grid 3 columnas en desktop (Info | Items | Total+Status), sin superposición
- [ ] **Responsive**: En móvil se apilan las secciones

### 3) TAKEOUT - Sin "En camino"
- [ ] **Admin status**: No existe opción "En camino" en el dropdown
- [ ] **Órdenes legacy**: Si una orden tiene status "En camino", se muestra como "Listo"

### 4) Admin Stock de Pasteles
- [ ] **Editar cantidades**: Inputs funcionan, botón Guardar cambios actualiza
- [ ] **Refrescar**: Tras guardar, los valores se mantienen
- [ ] **Última actualización**: Se muestra la fecha/hora de la última modificación

### 5) Stock insuficiente
- [ ] **Reservar sin stock**: Al intentar reservar con stock 0, se bloquea y muestra error claro
- [ ] **Pagar sin stock**: No se puede completar pago si no hay stock (validado en hold/availability)

---

## Archivos donde está la lógica

| Funcionalidad | Archivos |
|---------------|----------|
| Botón Reservar + validación | `TheBakery/assets/js/cart.js` (applyReservationButtonsState, clearReservationStorage, Cambiar reserva) |
| Validación reserva API | `server/server.js` (GET /api/reservations/validate/:id) |
| Guardado detalles reserva | `TheBakery/assets/js/reservations-ui.js` (localStorage thebakery_reservationDetails) |
| Admin pedidos render | `TheBakery/assets/js/admin-pedidos.js` (renderOrders), `admin/pedidos.html` (CSS grid) |
| TAKEOUT - sin En camino | `TheBakery/assets/js/admin-pedidos.js`, `TheBakery/assets/js/tracking.js`, `server/server.js` |
| Stock API | `server/server.js` (GET/PUT /api/stock), `server/data/stock.json` |
| Stock admin UI | `admin/stock-pasteles.html`, `TheBakery/assets/js/admin-stock-pasteles.js` |
| Integración stock en reservas | `server/lib/reservations.js` (getStockMap, checkStockForItems) |
