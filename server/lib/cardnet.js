/**
 * CardNet Payment Integration
 * Basado en: API CONSULTA WEB Y 3DS (Postman collection)
 * URLs Lab:
 *   - Crear sesión: https://labservicios.cardnet.com.do/sessions
 *   - Verificar: https://lab.cardnet.com.do/sessions/{SESSION}?sk={key}
 *   - Gateway: https://lab.cardnet.com.do/authorize
 */

const path = require('path');
const fs = require('fs');

const CARDNET_API_URL = process.env.CARDNET_API_URL;
const CARDNET_VERIFY_URL = process.env.CARDNET_VERIFY_URL;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5503';
const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:3000';

// Almacén temporal de session-keys (en producción usar Redis o DB)
const sessionStore = new Map();
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'cardnet-sessions.json');

function loadSessionsFromFile() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        Object.entries(data).forEach(([k, v]) => sessionStore.set(k, v));
        console.log('[CARDNET] Cargadas', sessionStore.size, 'sesiones desde', SESSIONS_FILE);
      }
    }
  } catch (e) {
    console.error('[CARDNET] Error cargando sesiones:', e.message);
  }
}

function saveSessionsToFile() {
  try {
    const obj = {};
    sessionStore.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('[CARDNET] Error guardando sesiones:', e.message);
  }
}

/**
 * Genera un TransactionId de exactamente 6 caracteres
 */
function generateTransactionId() {
  return String(Date.now()).slice(-6);
}

/**
 * Genera un OrdenId (máximo 20 caracteres)
 */
function generateOrdenId() {
  return 'ORD-' + Date.now();
}

/**
 * Formatea el monto para CardNet
 * CardNet espera el monto como string sin decimales
 * Ejemplo: RD$2,650.00 → "265000"
 * Ejemplo: RD$100.00 → "10000"
 */
function formatAmount(amount) {
  const numAmount = typeof amount === 'string'
    ? parseFloat(amount.replace(/[^0-9.]/g, ''))
    : amount;
  return String(Math.round(numAmount * 100));
}

/**
 * Crea una sesión de pago en CardNet
 * @param {Object} params - { subtotal, tax, total, ordenId, clientIp, items }
 * @returns {Object} - { SESSION, authorizeUrl, ordenId }
 */
async function createSession({ subtotal, tax, total, ordenId, clientIp, items }) {
  const transactionId = generateTransactionId();
  const finalOrdenId = ordenId || generateOrdenId();

  // Body basado en la colección Postman real (NO el PDF)
  const body = {
    TransactionType: process.env.CARDNET_TRANSACTION_TYPE || '200',
    CurrencyCode: process.env.CARDNET_CURRENCY_CODE || '214',
    AcquiringInstitutionCode: process.env.CARDNET_ACQUIRING_INSTITUTION_CODE || '349',
    MerchantType: process.env.CARDNET_MERCHANT_TYPE || '7997',
    MerchantNumber: process.env.CARDNET_MERCHANT_NUMBER,
    MerchantTerminal: process.env.CARDNET_MERCHANT_TERMINAL,
    MerchantTerminal_amex: process.env.CARDNET_MERCHANT_TERMINAL_AMEX || '00000001',
    ReturnUrl: SERVER_URL + '/cardnet/return',
    CancelUrl: SERVER_URL + '/cardnet/cancel',
    PageLanguaje: process.env.CARDNET_PAGE_LANGUAGE || 'ESP',
    OrdenId: finalOrdenId,
    TransactionId: transactionId,
    Tax: String(Math.round((tax || 0) * 100)),
    MerchantName: process.env.CARDNET_MERCHANT_NAME || 'THE BAKERY BY FRESARTE  SANTO DOMINGO   DN DO',
    Amount: formatAmount(total),
    Ipclient: clientIp || '127.0.0.1'
  };

  console.log('[CARDNET] FRONTEND_URL:', FRONTEND_URL);
  console.log('[CARDNET] ReturnUrl enviada a CardNet:', body.ReturnUrl);
  console.log('[CARDNET] CancelUrl enviada a CardNet:', body.CancelUrl);
  console.log('[CARDNET] Creando sesión en:', CARDNET_API_URL);
  console.log('[CARDNET] Datos:', {
    OrdenId: finalOrdenId,
    TransactionId: transactionId,
    Amount: body.Amount,
    Tax: body.Tax,
    ReturnUrl: body.ReturnUrl,
    CancelUrl: body.CancelUrl
  });

  const response = await fetch(CARDNET_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('[CARDNET] Error creando sesión:', response.status, responseText);
    throw new Error('CardNet error: ' + response.status + ' - ' + responseText);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('[CARDNET] JSON inválido. responseText completo:', responseText);
    throw new Error('CardNet: respuesta no es JSON válido');
  }

  console.log('[CARDNET] Respuesta completa al crear sesión:', JSON.stringify(data, null, 2));
  console.log('[CARDNET] data.SESSION:', data.SESSION, '| formato UUID:', /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(data.SESSION || '')));
  console.log('[CARDNET] data["session-key"]:', data['session-key'] ? '(presente)' : '(AUSENTE)');

  if (!data.SESSION || typeof data.SESSION !== 'string' || data.SESSION.length < 10) {
    console.error('[CARDNET] SESSION vacío o inválido. responseText completo:', responseText);
  }
  if (!data['session-key']) {
    console.error('[CARDNET] session-key ausente. responseText completo:', responseText);
  }

  // Guardar session-key para verificación posterior (NUNCA enviar al frontend)
  const storedData = {
    sessionKey: data['session-key'],
    ordenId: finalOrdenId,
    transactionId,
    subtotal,
    total,
    tax,
    items,
    createdAt: new Date().toISOString()
  };
  sessionStore.set(data.SESSION, storedData);
  saveSessionsToFile();
  console.log('[CARDNET] sessionStore después de crear: size=', sessionStore.size, 'SESSION=', data.SESSION, 'keys=', Array.from(sessionStore.keys()));

  const authorizeUrl = process.env.CARDNET_AUTHORIZE_URL || 'https://labservicios.cardnet.com.do/authorize';
  console.log('[CARDNET] authorizeUrl (gateway para form.action):', authorizeUrl);

  return {
    SESSION: data.SESSION,
    authorizeUrl: authorizeUrl,
    ordenId: finalOrdenId
  };
}

/**
 * Verifica el resultado de una transacción con CardNet
 * IMPORTANTE: La URL de verificación es DIFERENTE a la de creación
 * Crear: https://labservicios.cardnet.com.do/sessions
 * Verificar: https://labservicios.cardnet.com.do/sessions/{SESSION}?sk={key}
 */
async function verifyTransaction(sessionId) {
  console.log('[CARDNET] verifyTransaction: sessionId=', sessionId, 'sessionStore.size=', sessionStore.size, 'keys=', Array.from(sessionStore.keys()));
  let stored = sessionStore.get(sessionId);
  if (!stored) {
    loadSessionsFromFile();
    stored = sessionStore.get(sessionId);
    console.log('[CARDNET] Tras cargar archivo (si Map vacío): stored=', !!stored, 'sessionStore.size=', sessionStore.size);
  }
  if (!stored) {
    console.log('[CARDNET] ERROR: Sesión', sessionId, 'no encontrada en sessionStore');
    throw new Error('Sesión no encontrada en el almacén local (Map vacío o SESSION no existe)');
  }

  const url = CARDNET_VERIFY_URL + '/' + sessionId + '?sk=' + stored.sessionKey;
  console.log('[CARDNET] Verificando transacción en:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  const responseText = await response.text();
  const contentType = response.headers.get('content-type') || '(none)';
  const preview = responseText.substring(0, 200);
  console.log('[CARDNET] Verify response: status=', response.status, 'content-type=', contentType, 'preview=', preview);

  if (!response.ok) {
    console.error('[CARDNET] Error verificando:', response.status, responseText);
    throw new Error('CardNet verify error: ' + response.status);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    console.error('[CARDNET] Verify: respuesta no es JSON. content-type=', contentType, 'texto=', responseText);
    throw new Error('CardNet verify devolvió HTML u otro formato, no JSON');
  }

  console.log('[CARDNET] Resultado:', {
    ResponseCode: result.ResponseCode,
    AuthorizationCode: result.AuthorizationCode,
    OrdenID: result.OrdenID
  });

  // Guardar datos completos antes de limpiar
  const sessionData = { ...stored, ...result };
  sessionStore.delete(sessionId);
  saveSessionsToFile();

  return {
    approved: result.ResponseCode === '00',
    responseCode: result.ResponseCode,
    authorizationCode: result.AuthorizationCode,
    creditCardNumber: result.CreditCardNumber || result.CreditcardNumber,
    referenceNumber: result.RetrivalReferenceNumber,
    ordenId: result.OrdenID || stored.ordenId,
    transactionId: result.TransactionID,
    txToken: result.TxToken,
    originalData: sessionData
  };
}

/**
 * Obtiene datos almacenados de una sesión (sin verificar en CardNet)
 */
function getSessionData(sessionId) {
  return sessionStore.get(sessionId) || null;
}

module.exports = {
  createSession,
  verifyTransaction,
  getSessionData,
  formatAmount,
  generateTransactionId,
  generateOrdenId
};
