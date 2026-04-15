# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Project

**Backend** (Node.js/Express, port 3000):
```bash
cd server
npm install
npm run dev       # development with auto-reload (nodemon)
npm start         # production
```

**Frontend**: Open with VS Code Live Server on port 5503. Use `http://localhost:5503` (not `127.0.0.1`) — admin sessions require the exact hostname for CORS + cookie matching.

**Create admin user:**
```bash
cd server
npm run create-admin:dev   # creates admin@thebakery.com / Admin12345!
npm run create-admin       # interactive prompt
```

**Environment** (`server/.env`):
```
PORT=3000
FRONTEND_URL=http://127.0.0.1:5503
STOCK_BYPASS=true
CARDNET_API_URL=https://ecommerce.cardnet.com.do/sessions
CARDNET_MERCHANT_NUMBER=...
CARDNET_MERCHANT_TERMINAL=...
```

## Architecture

**Stack:** Vanilla JS frontend + Express backend + flat-file JSON storage (no database, no frontend framework).

### Data Layer
All persistence is flat JSON files in `server/data/`. Key files:
- `orders.json` / `archived-orders.json` — active and completed orders
- `inventory_cakes.json` — master product catalog
- `inventory_cakes_daily.json` — daily per-cake stock
- `admin-users.json` — bcrypt-hashed admin credentials
- `cardnet-sessions.json` — in-flight payment sessions
- `promotions.json` — discount codes (percentage or fixed)
- `business_hours.json`, `holidays.json` — availability config

### Backend (`server/server.js` — ~2,700 lines)
Single-file Express server. Key areas:
- **Auth**: session-based (`express-session`, 24h expiry) via `requireAdmin` middleware; legacy JWT support exists but is inactive
- **Payment**: CardNet gateway (`lib/cardnet.js`). Stripe is disabled/commented out. Flow: `POST /api/pay/session` → redirect to CardNet → `POST /cardnet/return` or `/cardnet/cancel` callbacks
- **Stock**: `STOCK_BYPASS=true` in `.env` skips stock validation; reservations hold stock for 10 minutes

Main API groups:
- `/api/auth/*` — admin login/logout/me
- `/api/orders` — CRUD, status updates
- `/api/pay/session`, `/cardnet/*` — payment flow
- `/api/products`, `/public/inventory/cakes` — catalog
- `/api/promotions/*` — discount management
- `/api/availability`, `/api/reservations/*` — slot/stock holds
- `/api/inventory` — inventory management
- File uploads via multer → `TheBakery/assets/imagenes/`

### Frontend
- **Cart**: persisted in `localStorage['bakeryCart']`; tax rate 18% (Dominican ITBIS)
- **Products**: `pasteles-de-autor.html` loads from `TheBakery/assets/data/pasteles-autor.json` (static) and from `/public/inventory/cakes` (API)
- **Admin pages** under `/admin/`: protected by session cookie; JS in `TheBakery/assets/js/admin-*.js`
- **Payment success**: `success.html` → calls `POST /api/orders` to persist order, then clears cart from localStorage

### Checkout Flow
1. Cart items → `POST /api/pay/session` → backend calls CardNet API → returns redirect URL
2. User completes payment on CardNet
3. CardNet POSTs to `/cardnet/return` (success) or `/cardnet/cancel`
4. Backend redirects to `/success.html` or `/cancel.html`
5. `success.html` saves order via `POST /api/orders` and clears `localStorage`

## CORS Allowed Origins
`http://localhost:5503`, `http://127.0.0.1:5503`, `http://localhost:5500`, `http://127.0.0.1:5500`, `https://thebakerybyfresarte.com`, `https://www.thebakerybyfresarte.com`
