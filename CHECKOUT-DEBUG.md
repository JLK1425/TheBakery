# Guía: Por qué falla el checkout ("Failed to fetch")

## Cómo está armado el sistema (arquitectura)

En desarrollo tienes **dos servidores** distintos:

| Servidor        | Puerto | Qué hace |
|-----------------|--------|----------|
| **Live Server** (VS Code/Cursor) | 5502 (o 5501, 5503) | Sirve los archivos estáticos: HTML, JS, CSS. Ahí abres `cart.html`. |
| **Node (backend)**              | **3000**            | Sirve la API: `/api/pay/session`, `/health`, etc. Lo levantas con `node server.js`. |

- La **página** del carrito se carga desde: `http://127.0.0.1:5502/...`
- Las **peticiones de pago** deben ir a: `http://127.0.0.1:3000/api/pay/session`

Si el `fetch` va al puerto **5502**, está llamando al servidor de archivos, que no tiene esa ruta → **"Failed to fetch"**.

---

## Checklist (sigue en orden)

### 1. ¿El backend está corriendo?

En una terminal, en la carpeta del proyecto:

```bash
cd server
node server.js
```

Debe aparecer algo como: `Server running on port 3000` (o el puerto que uses).

- Si no lo tienes levantado, el navegador no puede conectar con la API → "Failed to fetch".

### 2. ¿Qué URL está usando el checkout?

En la consola del navegador (F12 → Consola), al hacer clic en "Continuar a pago" deberías ver:

```
[CHECKOUT] URL completa: http://127.0.0.1:3000/api/pay/session (debe ser http://127.0.0.1:3000 o http://localhost:3000)
```

- Si ahí sale **:5502** en lugar de **:3000**, el problema es que el front está llamando al servidor equivocado. Avísame qué URL te sale.

### 3. ¿La petición llega al servidor?

En la **terminal donde corre `node server.js`**, al hacer clic en "Continuar a pago" deberían salir líneas como:

```
[REQ] OPTIONS /api/pay/session origin= http://127.0.0.1:5502
[REQ] OPTIONS /api/pay/session status= 204
[REQ] POST /api/pay/session origin= http://127.0.0.1:5502
[REQ] POST /api/pay/session status= 200
```

- Si **no aparece nada** en esa terminal al hacer clic, la petición no está llegando (URL mal, firewall, o backend parado).
- Si **sí aparecen** esos logs pero el navegador sigue mostrando error, puede ser CORS o algo en el navegador (extensión, etc.).

### 4. Pestaña Red (Network)

En F12 → pestaña **Red** / **Network**:

1. Recarga la página del carrito.
2. Haz clic en "Continuar a pago".
3. Busca una petición a `pay/session` o `api/pay/session`.
4. Mira:
   - **URL**: debe ser `http://127.0.0.1:3000/api/pay/session` (puerto **3000**).
   - **Estado**: 200 = bien; (canceled) = se canceló; failed = no llegó al servidor.

---

## Si en Network la petición sale "(canceled)"

Cuando el **OPTIONS** sale 204 pero el **POST** sale **(canceled)**, el navegador está cancelando la petición (no es que el servidor falle). Suele pasar por:

1. **Otro script que redirige** (p. ej. un listener que hace `location.href = ...`). En este proyecto, en la página del carrito el único handler del botón lo pone `cart.js`; `script.js` no enlaza en cart.html.
2. **Extensiones del navegador** (bloqueadores, privacidad, etc.). **Prueba en una ventana de incógnito** (Ctrl+Shift+N) con las extensiones desactivadas.
3. **Navegación o recarga** justo después del clic. Se ha añadido una pausa de 100 ms antes del `fetch` para que el clic termine y se reduzca este efecto.

**Qué hacer:** Abre cart.html en **modo incógnito**, vuelve a hacer "Continuar a pago" y mira en Network si el POST sigue "(canceled)" o pasa a 200.

---

## Resumen

- **Backend en 3000** = API de pago.
- **Front en 5502** = solo archivos; no tiene `/api/pay/session`.
- El código ya usa `getApiBase()` para apuntar al **3000**; el log `[CHECKOUT] URL completa:` te deja verificar que sea así.
- Si la URL es correcta y el backend está en marcha y aun así falla, con lo que veas en la terminal y en la pestaña Red podemos afinar el siguiente paso.
- Si el POST sale **(canceled)**, prueba en incógnito y con la pausa de 100 ms antes del fetch ya aplicada en el código.
