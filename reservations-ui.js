/**
 * Reservations UI: modal "Reserva tu fecha y hora", calendario grid, hold, invitado/registrado.
 * Horas y fechas siempre en America/Santo_Domingo, locale es-DO (Intl.DateTimeFormat).
 * ISO original no se modifica; se envía tal cual al backend.
 */
(function () {
  const API_BASE = 'http://localhost:3000';
  const TZ_RD = 'America/Santo_Domingo';
  const LOCALE_RD = 'es-DO';

  const fmtTime = new Intl.DateTimeFormat(LOCALE_RD, {
    timeZone: TZ_RD,
    hour12: true,
    hour: '2-digit',
    minute: '2-digit'
  });
  const fmtDateHeader = new Intl.DateTimeFormat(LOCALE_RD, {
    timeZone: TZ_RD,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

  window.customerDraft = window.customerDraft || null;

  function getCartItems() {
    try {
      const raw = JSON.parse(localStorage.getItem('bakeryCart') || '[]');
      if (!raw.length) return [{ productId: 'cake_choco_8', qty: 1 }];
      const items = raw
        .map(function (item) {
          return {
            productId: String(item.productId || item.id || '').trim(),
            qty: Math.max(1, parseInt(item.quantity, 10) || 1)
          };
        })
        .filter(function (it) { return it.productId; });
      return items.length ? items : [{ productId: 'cake_choco_8', qty: 1 }];
    } catch (e) {}
    return [{ productId: 'cake_choco_8', qty: 1 }];
  }

  function formatHourRD(iso) {
    try {
      return fmtTime.format(new Date(iso));
    } catch (e) {
      return iso;
    }
  }

  function formatDateHeaderRD(dateKey) {
    try {
      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
      return fmtDateHeader.format(new Date(dateKey + 'T12:00:00.000Z'));
    } catch (e) {
      return dateKey;
    }
  }

  let selectedSlotStartAt = null;

  const modal = document.getElementById('reservationModal');
  const backdrop = document.getElementById('reservationModalBackdrop');
  const closeBtn = document.getElementById('closeReservationModal');
  const openBtn = document.getElementById('openReservationModalBtn');
  const tabInvitado = document.getElementById('tabInvitado');
  const tabRegistrarme = document.getElementById('tabRegistrarme');
  const panelInvitado = document.getElementById('panelInvitado');
  const panelRegistrarme = document.getElementById('panelRegistrarme');
  const invitadoName = document.getElementById('invitadoName');
  const invitadoEmail = document.getElementById('invitadoEmail');
  const invitadoPhone = document.getElementById('invitadoPhone');
  const registerName = document.getElementById('registerName');
  const registerEmail = document.getElementById('registerEmail');
  const registerPhone = document.getElementById('registerPhone');
  const registerCedula = document.getElementById('registerCedula');
  const btnCrearPerfil = document.getElementById('btnCrearPerfil');
  const registrarmeForm = document.getElementById('registrarmeForm');
  const registradoBadge = document.getElementById('registradoBadge');
  const registradoName = document.getElementById('registradoName');
  const availabilityError = document.getElementById('availabilityError');
  const availabilityLoading = document.getElementById('availabilityLoading');
  const availabilityGrid = document.getElementById('availabilityGrid');
  const holdError = document.getElementById('holdError');
  const holdSuccess = document.getElementById('holdSuccess');
  const btnReservarHorario = document.getElementById('btnReservarHorario');
  const checkoutBtn = document.getElementById('checkoutBtn');

  fetch(API_BASE + '/api/reservations/expire', { method: 'POST' })
  .then(function (r) { return r.json().catch(function () { return {}; }); })
  .then(function (data) {
    if (data && data.expiredCount > 0) {
      try { localStorage.removeItem('thebakery_reservationId'); } catch (e) {}
      applyReservationButtonsState();
    }
  })
  .catch(function () {})
  .finally(function () {
    refreshAvailability();
  });


  function hideModal() {
    if (!modal) return;
    modal.classList.add('hidden');
  }

  function setActiveTab(tab) {
    [tabInvitado, tabRegistrarme].forEach(function (t) {
      if (!t) return;
      if ((t.dataset.tab || '') === tab) {
        t.classList.add('bg-white', 'shadow', 'text-gray-900');
        t.classList.remove('text-gray-600');
      } else {
        t.classList.remove('bg-white', 'shadow', 'text-gray-900');
        t.classList.add('text-gray-600');
      }
    });
    if (tab === 'invitado') {
      if (panelInvitado) panelInvitado.classList.remove('hidden');
      if (panelRegistrarme) panelRegistrarme.classList.add('hidden');
    } else {
      if (panelInvitado) panelInvitado.classList.add('hidden');
      if (panelRegistrarme) panelRegistrarme.classList.remove('hidden');
    }
  }

  function saveInvitadoDraft() {
    window.customerDraft = {
      name: (invitadoName && invitadoName.value || '').trim(),
      email: (invitadoEmail && invitadoEmail.value || '').trim(),
      phone: (invitadoPhone && invitadoPhone.value || '').trim()
    };
  }

  function restoreInvitadoDraft() {
    var d = window.customerDraft;
    if (!d) return;
    if (invitadoName) invitadoName.value = d.name || '';
    if (invitadoEmail) invitadoEmail.value = d.email || '';
    if (invitadoPhone) invitadoPhone.value = d.phone || '';
  }

  function doRegister() {
    var name = (registerName && registerName.value || '').trim();
    var email = (registerEmail && registerEmail.value || '').trim();
    var phone = (registerPhone && registerPhone.value || '').trim();
    var cedula = (registerCedula && registerCedula.value || '').trim();
    if (!name || !email || !phone) {
      alert('Nombre, email y teléfono son requeridos.');
      return;
    }
    if (!/^\d{4}$/.test(cedula)) {
      alert('Los últimos 4 dígitos de cédula deben ser exactamente 4 números.');
      return;
    }
    if (btnCrearPerfil) {
      btnCrearPerfil.disabled = true;
      btnCrearPerfil.textContent = 'Enviando…';
    }
    fetch(API_BASE + '/api/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, phone: phone, cedulaLast4: cedula })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.userId != null) {
          try {
            localStorage.setItem('thebakery_userId', String(data.userId));
            localStorage.setItem('thebakery_userName', name);
          } catch (e) {}
          if (registradoName) registradoName.textContent = name;
          if (registrarmeForm) registrarmeForm.classList.add('hidden');
          if (registradoBadge) registradoBadge.classList.remove('hidden');
          var cedulaWrap = registerCedula && registerCedula.closest('div');
          if (cedulaWrap) cedulaWrap.classList.add('hidden');
          if (registerCedula) registerCedula.value = '';
        } else {
          alert(data.error || 'Error al registrar');
        }
      })
      .catch(function (err) {
        alert('Error de conexión: ' + (err.message || ''));
      })
      .finally(function () {
        if (btnCrearPerfil) {
          btnCrearPerfil.disabled = false;
          btnCrearPerfil.textContent = 'Crear perfil';
        }
      });
  }

  function expireThenRefresh() {
    fetch(API_BASE + '/api/reservations/expire', { method: 'POST' })
      .catch(function () {})
      .finally(function () { refreshAvailability(); });
  }

  function refreshAvailability() {
    var items = getCartItems();
    if (availabilityError) availabilityError.classList.add('hidden');
    if (availabilityLoading) availabilityLoading.classList.remove('hidden');
    if (availabilityGrid) {
      availabilityGrid.classList.add('hidden');
      availabilityGrid.innerHTML = '';
    }
    selectedSlotStartAt = null;
    if (btnReservarHorario) btnReservarHorario.disabled = true;

    fetch(API_BASE + '/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 14, items: items })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || data.message || r.statusText);
          return data;
        });
      })
      .then(function (data) {
        if (availabilityLoading) availabilityLoading.classList.add('hidden');
        renderGrid(data);
        if (availabilityGrid) availabilityGrid.classList.remove('hidden');
      })
      .catch(function (err) {
        if (availabilityLoading) availabilityLoading.classList.add('hidden');
        var msg = (err && err.message) ? String(err.message) : 'Error desconocido';
        if (availabilityError) {
          availabilityError.textContent = 'Error al cargar disponibilidad. ' + msg + ' Revisa la conexión o intenta más tarde.';
          availabilityError.classList.remove('hidden');
        }
      });
  }

  function renderGrid(data) {
  var html = '';
  var days = normalizeToDays(data);
  
  days.forEach(function (day) {
    var dk = day.dateKey || '';
    var isClosed = !!day.isClosed;
    var headerLabel = formatDateHeaderRD(dk) || dk;
    var dayId = 'day-' + dk.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Contenedor del día
    html += '<div class="day-container rounded-xl border border-gray-200 bg-gray-50/50 p-4" data-date-key="' + dk + '">';
    
    // Header del día (clickeable para expandir/colapsar)
    html += '<div class="day-header mb-3 flex items-center justify-between cursor-pointer" data-date-key="' + dk + '">';
    html += '<span class="font-medium text-gray-900">' + headerLabel.replace(/</g, '&lt;') + '</span>';
    
    if (isClosed) {
      html += '<span class="rounded-full bg-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600">Cerrado</span>';
    } else {
      // Indicador visual de expandir/colapsar
      html += '<svg class="w-5 h-5 text-gray-400 transition-transform" data-icon="chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
    }
    html += '</div>';
    
    // Contenedor de slots (colapsable)
    html += '<div class="slots-container" id="' + dayId + '">';
    
    if (isClosed) {
      html += '<div class="text-sm text-gray-500">Sin slots disponibles</div>';
    } else {
      html += '<div class="flex flex-wrap gap-2">';
      var slots = day.slots || [];
      
      slots.forEach(function (s) {
        var available = !!s.isAvailable;
        var startAt = s.startAt || '';
        var hourLabel = formatHourRD(startAt);
        var id = 'slot-' + startAt.replace(/[^a-zA-Z0-9]/g, '_');
        
        var btnClass = 'rounded-lg px-3 py-2 text-sm font-medium transition ';
        if (available) {
          btnClass += 'bg-white border border-gray-300 text-gray-800 hover:border-pink-400 hover:bg-pink-50 slot-btn';
        } else {
          btnClass += 'bg-gray-200 text-gray-400 cursor-not-allowed border border-transparent';
        }
        
        html += '<button type="button" ' +
                'class="' + btnClass + '" ' +
                'data-start-at="' + startAt.replace(/"/g, '&quot;') + '" ' +
                'data-available="' + (available ? '1' : '0') + '" ' +
                'id="' + id + '" ' +
                (available ? '' : 'disabled') + '>' +
                hourLabel +
                '</button>';
      });
      
      html += '</div>';
    }
    
    html += '</div>'; // cierra slots-container
    html += '</div>'; // cierra day-container
  });
  
  availabilityGrid.innerHTML = html || '<p class="text-gray-500 text-sm">No hay slots en este rango.</p>';
  
  // ⚠️ IMPORTANTE: Remover listeners antiguos antes de agregar nuevos
  attachGridEventListeners();
}

// Variable global para trackear si ya se agregaron los listeners
var gridListenersAttached = false;

function attachGridEventListeners() {
  // Prevenir listeners duplicados
  if (gridListenersAttached) {
    return;
  }
  
  // Event delegation para expandir/colapsar días
  availabilityGrid.addEventListener('click', function (e) {
    var header = e.target.closest('.day-header');
    if (header) {
      var dateKey = header.dataset.dateKey;
      var container = availabilityGrid.querySelector('.day-container[data-date-key="' + dateKey + '"] .slots-container');
      var icon = header.querySelector('[data-icon="chevron"]');
      
      if (container) {
        container.classList.toggle('hidden');
        if (icon) {
          icon.classList.toggle('rotate-180');
        }
      }
    }
  });
  
  // Event delegation para seleccionar slots
  availabilityGrid.addEventListener('click', function (e) {
    if (e.target.classList.contains('slot-btn')) {
      var startAt = e.target.dataset.startAt;
      
      // Remover selección previa
      var btns = availabilityGrid.querySelectorAll('.slot-btn');
      btns.forEach(function (btn) {
        btn.classList.remove('ring-2', 'ring-pink-500', 'ring-offset-2');
      });
      
      // Aplicar selección actual
      e.target.classList.add('ring-2', 'ring-pink-500', 'ring-offset-2');
      
      // Actualizar estado global
      selectedSlotStartAt = startAt;
      
      // Habilitar botón de reserva
      if (btnReservarHorario) {
        btnReservarHorario.disabled = false;
      }
    }
  });
  
  gridListenersAttached = true;
}

  function getCustomerPayload() {
    var userId = null;
    try { userId = localStorage.getItem('thebakery_userId'); } catch (e) {}
    if (userId) return { userId: userId, customer: null };
    if (window.customerDraft) {
      var d = window.customerDraft;
      if (d.name && d.email && d.phone) return { userId: null, customer: { name: d.name, email: d.email, phone: d.phone } };
    }
    if (invitadoName && invitadoEmail && invitadoPhone) {
      var n = (invitadoName.value || '').trim();
      var e = (invitadoEmail.value || '').trim();
      var p = (invitadoPhone.value || '').trim();
      if (n && e && p) return { userId: null, customer: { name: n, email: e, phone: p } };
    }
    return null;
  }

  function doHold() {
    if (!selectedSlotStartAt) return;
    saveInvitadoDraft();
    var items = getCartItems();
    var cust = getCustomerPayload();
    if (!cust) {
      if (holdError) {
        holdError.textContent = 'Completa tus datos (Invitado) o regístrate antes de reservar.';
        holdError.classList.remove('hidden');
      }
      if (holdSuccess) holdSuccess.classList.add('hidden');
      return;
    }
    var body = {
      slotStartAt: selectedSlotStartAt,
      items: items
    };
    if (cust.userId) body.userId = cust.userId;
    else body.customer = cust.customer;

    if (holdError) holdError.classList.add('hidden');
    if (holdSuccess) holdSuccess.classList.add('hidden');
    if (btnReservarHorario) {
      btnReservarHorario.disabled = true;
      btnReservarHorario.textContent = 'Reservando…';
    }

    fetch(API_BASE + '/api/reservations/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || data.message || r.statusText);
          return data;
        });
      })
      .then(function (data) {
        try { localStorage.setItem('thebakery_reservationId', String(data.reservationId || '')); } catch (e) {}
        var exp = '';
        if (data.holdExpiresAt) {
          try {
            exp = ' Vence: ' + fmtTime.format(new Date(data.holdExpiresAt));
          } catch (e) {}
        }
        if (holdSuccess) {
          holdSuccess.textContent = '¡Reserva apartada!' + exp;
          holdSuccess.classList.remove('hidden');
        }
        if (holdError) holdError.classList.add('hidden');
        applyReservationButtonsState();
      })
      .catch(function (err) {
        if (holdError) {
          holdError.textContent = (err && err.message) ? err.message : 'Error al apartar. Intenta de nuevo.';
          holdError.classList.remove('hidden');
        }
        if (holdSuccess) holdSuccess.classList.add('hidden');
        refreshAvailability();
      })
      .finally(function () {
        if (btnReservarHorario) {
          btnReservarHorario.disabled = false;
          btnReservarHorario.textContent = 'Reservar horario';
        }
      });
  }

  function applyReservationButtonsState() {
  var btn = document.getElementById('checkoutBtn');
  var open = document.getElementById('openReservationModalBtn');
  if (!btn || !open) return;

  var cart = [];
  try { cart = JSON.parse(localStorage.getItem('bakeryCart') || '[]'); } catch (e) {}
  var rid = null;
  try { rid = localStorage.getItem('thebakery_reservationId'); } catch (e) {}

  var hasCart = Array.isArray(cart) && cart.length > 0;
  var hasReservation = !!rid;

  // Caso 1: carrito vacío -> NO se puede reservar ni pagar
  if (!hasCart) {
    btn.style.display = 'none';
    btn.disabled = true;

    open.style.display = '';
    open.disabled = true;
    return;
  }

  // Caso 2: hay carrito pero NO hay reserva -> debe reservar
  if (!hasReservation) {
    btn.style.display = 'none';
    btn.disabled = true;

    open.style.display = '';
    open.disabled = false;
    return;
  }

  // Caso 3: hay carrito y hay reserva -> puede pagar
  open.style.display = 'none';
  open.disabled = true;

  btn.style.display = '';
  btn.disabled = false;
}


  function init() {
    setActiveTab('invitado');
    restoreInvitadoDraft();

    if (tabInvitado) tabInvitado.addEventListener('click', function () {
      setActiveTab('invitado');
      saveInvitadoDraft();
    });
    if (tabRegistrarme) tabRegistrarme.addEventListener('click', function () {
      setActiveTab('registrarme');
      saveInvitadoDraft();
    });

    [invitadoName, invitadoEmail, invitadoPhone].forEach(function (el) {
      if (el) el.addEventListener('change', saveInvitadoDraft);
    });

    if (btnCrearPerfil) btnCrearPerfil.addEventListener('click', doRegister);
    if (btnReservarHorario) btnReservarHorario.addEventListener('click', doHold);

    if (openBtn) openBtn.addEventListener('click', showModal);
    if (closeBtn) closeBtn.addEventListener('click', hideModal);
    if (backdrop) backdrop.addEventListener('click', hideModal);

    var uid = null;
    try { uid = localStorage.getItem('thebakery_userId'); } catch (e) {}
    if (uid && registradoBadge) {
      if (registrarmeForm) registrarmeForm.classList.add('hidden');
      registradoBadge.classList.remove('hidden');
      var storedName = null;
      try { storedName = localStorage.getItem('thebakery_userName'); } catch (e) {}
      if (registradoName) registradoName.textContent = storedName || 'Usuario';
    }

    applyReservationButtonsState();
  }

  window.refreshReservationAvailability = refreshAvailability;
  window.applyReservationButtonsState = applyReservationButtonsState;

  window.addEventListener('cart-updated', function () {
    applyReservationButtonsState();
    if (modal && !modal.classList.contains('hidden')) refreshAvailability();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
