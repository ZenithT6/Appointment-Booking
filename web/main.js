// web/main.js — holds-enabled booking flow (Step 3)
// Requires Cloud Functions: getAvailability (Step 2+), createHold, confirmBooking (Step 3)

import { firebaseConfig } from './firebase.js';
import { seedMinimalData } from './seed.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getFirestore, collection, getDocs, query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  getFunctions, httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-functions.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

// --- UI elements ---
const serviceSelect = document.getElementById('serviceSelect');
const stylistSelect = document.getElementById('stylistSelect');
const dateInput     = document.getElementById('dateInput');
const slotSelect    = document.getElementById('slotSelect');

const bookBtn = document.getElementById('bookBtn');
const msg     = document.getElementById('msg');
const todayList = document.getElementById('todayList');

// Hold UI
const holdBanner = document.getElementById('holdBanner');
const holdTimeLabel = document.getElementById('holdTimeLabel');
const holdDetail = document.getElementById('holdDetail');
const releaseBtn = document.getElementById('releaseBtn');

// Hours / UI slot step (server enforces real availability)
const OPEN_HOUR   = 9;
const CLOSE_HOUR  = 18;
const SLOT_MINUTES = 30;

// URL params (from Availability deep link)
const params = new URLSearchParams(location.search);
const presetServiceId = params.get('serviceId') || '';
const presetDate      = params.get('date') || '';
const presetStart     = params.get('start') || '';
const presetStylistId = params.get('stylistId') || '';    // '' = Any

// state
let currentHold = null;         // { holdId, stylistId, start, end, expiresAt }
let countdownTimer = null;

// utils
function toISODate(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function pad(n){ return String(n).padStart(2,'0'); }
function toMinutes(hhmm){ const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function toHHmm(mins){ return `${pad(Math.floor(mins/60))}:${pad(mins%60)}`; }

async function loadServices() {
  const snap = await getDocs(query(collection(db, 'services')));
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  const active = items.filter(x => x.active !== false);

  serviceSelect.innerHTML = `<option value="">Select a service…</option>` +
    active.map(s => `<option value="${s.id}" data-duration="${s.duration_min||30}" data-name="${s.name||''}">
      ${s.name} — ${s.duration_min||30} min — $${s.price_aud ?? 0}
    </option>`).join('');

  if (presetServiceId) serviceSelect.value = presetServiceId;
}

async function loadStylists() {
  const snap = await getDocs(query(collection(db, 'stylists')));
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  const active = list.filter(s => s.active !== false);

  stylistSelect.innerHTML =
    `<option value="any">Any available</option>` +
    active.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');

  if (presetStylistId) stylistSelect.value = presetStylistId;
}

function generateStepSlots() {
  const slots = [];
  for (let h = OPEN_HOUR; h <= CLOSE_HOUR - 1; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      const start = `${pad(h)}:${pad(m)}`;
      const endCandidate = toMinutes(start) + SLOT_MINUTES;
      if (endCandidate <= (CLOSE_HOUR * 60)) {
        slots.push(`${start}-${toHHmm(endCandidate)}`);
      }
    }
  }
  return slots;
}

function populateSlotSelect() {
  const slots = generateStepSlots();
  slotSelect.innerHTML = slots.map(v => `<option value="${v}">${v.replace('-', ' → ')}</option>`).join('');
  if (presetStart) {
    const idx = slots.findIndex(txt => txt.startsWith(presetStart));
    if (idx >= 0) slotSelect.selectedIndex = idx;
  }
}

// ===== Holds logic =====
function showHoldBanner(show, detail='') {
  if (!holdBanner) return;
  holdBanner.style.display = show ? 'block' : 'none';
  holdDetail && (holdDetail.textContent = detail || '');
}

function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}
function startCountdown(expiresAtISO) {
  clearCountdown();
  function tick(){
    const ms = new Date(expiresAtISO).getTime() - Date.now();
    if (ms <= 0) {
      holdTimeLabel && (holdTimeLabel.textContent = '00:00');
      msg.innerHTML = `<div class="error">⏱️ Hold expired. Please select the time again.</div>`;
      currentHold = null;
      showHoldBanner(false);
      bookBtn.disabled = true;
      clearCountdown();
      return;
    }
    const sec = Math.floor(ms/1000);
    const mm = Math.floor(sec/60);
    const ss = sec % 60;
    holdTimeLabel && (holdTimeLabel.textContent = `${pad(mm)}:${pad(ss)}`);
  }
  tick();
  countdownTimer = setInterval(tick, 250);
}

async function createHoldFromSelection() {
  msg.innerHTML = '';
  const serviceId = serviceSelect.value;
  const stylistId = (stylistSelect.value || 'any');
  const dateStr = dateInput.value;
  const slot = slotSelect.value;
  if (!serviceId || !dateStr || !slot) { bookBtn.disabled = true; return; }

  const start = slot.split('-')[0];
  bookBtn.disabled = true;

  try {
    const callable = httpsCallable(functions, 'createHold');
    const resp = await callable({ serviceId, stylistId, date: dateStr, start });
    currentHold = {
      holdId: resp.data.holdId,
      stylistId: resp.data.stylistId,
      start: resp.data.start,
      end: resp.data.end,
      expiresAt: resp.data.expiresAt
    };

    // If "any" was chosen and server assigned a stylist, reflect that
    if (stylistSelect.value === 'any' && currentHold.stylistId) {
      stylistSelect.value = currentHold.stylistId;
    }

    showHoldBanner(true, ` — ${dateStr} ${currentHold.start} → ${currentHold.end}`);
    startCountdown(currentHold.expiresAt);
    bookBtn.disabled = false;
  } catch (err) {
    console.error(err);
    msg.innerHTML = `<div class="error">❌ ${err.message || 'Failed to hold the time.'}</div>`;
    showHoldBanner(false);
    currentHold = null;
    bookBtn.disabled = true;
  }
}

async function confirmBookingFromHold() {
  if (!currentHold) {
    msg.innerHTML = `<div class="error">Please hold a time first.</div>`;
    return;
  }
  const name = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const svcName = serviceSelect.selectedOptions[0]?.dataset.name || '';
  const styName = stylistSelect.selectedOptions[0]?.textContent || '';

  if (!name || !email) {
    msg.innerHTML = `<div class="error">Please enter your name and email.</div>`;
    return;
  }

  bookBtn.disabled = true;
  try {
    const callable = httpsCallable(functions, 'confirmBooking');
    const resp = await callable({
      holdId: currentHold.holdId,
      customer: {
        name, email, phone,
        service_name: svcName,
        stylist_name: styName
      }
    });
    const bookingId = resp.data.bookingId;
    window.location.href = `confirm.html?bookingId=${encodeURIComponent(bookingId)}`;
  } catch (err) {
    console.error(err);
    msg.innerHTML = `<div class="error">❌ ${err.message || 'Could not confirm booking.'}</div>`;
    bookBtn.disabled = false;
  }
}

// manual release (we rely on TTL if user navigates away)
releaseBtn?.addEventListener('click', () => {
  currentHold = null;
  showHoldBanner(false);
  clearCountdown();
  bookBtn.disabled = true;
  msg.innerHTML = `<div class="small muted">Hold released. Pick a time again.</div>`;
});

// ===== Today list (unchanged)
async function listToday() {
  const today = toISODate(new Date());
  const qToday = query(collection(db, 'bookings'), where('date', '==', today), orderBy('start_time', 'asc'));
  const snap = await getDocs(qToday);
  const rows = [];
  snap.forEach(d => {
    const b = d.data();
    rows.push(`<div class="row">
      <span class="badge">${b.start_time}</span> ${b.customer_name} — ${b.service_name || ''} (${b.stylist_name || 'Any'})
    </div>`);
  });
  todayList.innerHTML = rows.join('') || '<p class="small">No bookings yet today.</p>';
}

// ===== Init =====
async function init() {
  try { await seedMinimalData(db); } catch (_) {}

  await loadServices();
  await loadStylists();
  dateInput.value = presetDate || toISODate(new Date());
  populateSlotSelect();

  // If coming from Availability with a preselected time, hold it immediately
  if (presetServiceId && dateInput.value && presetStart) {
    await createHoldFromSelection();
  } else {
    bookBtn.disabled = true; // disabled until a hold exists
  }

  // If user changes any selection, create a new hold
  [serviceSelect, stylistSelect, dateInput, slotSelect].forEach(el => {
    el.addEventListener('change', async () => {
      await createHoldFromSelection();
    });
  });

  bookBtn.addEventListener('click', (e) => {
    e.preventDefault();
    confirmBookingFromHold();
  });

  await listToday();
}

init().catch(err => {
  console.error(err);
  msg.innerHTML = `<div class="error">❌ Failed to initialize booking page.</div>`;
});
