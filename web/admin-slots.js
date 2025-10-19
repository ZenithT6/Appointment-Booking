/* admin.js — FULL FILE (Admin gate + Generate Week + Single Slot + Recent controls + CSV) */
'use strict';

/* =========================
   Imports (Firebase v10 modular)
   ========================= */
import { firebaseConfig } from './firebase.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getFirestore,
  collection, doc,
  addDoc, getDocs, deleteDoc,
  query, where, orderBy, limit,
  writeBatch, updateDoc, getDoc, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

/* =========================
   Firebase init
   ========================= */
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

/* =========================
   Admin gate (only users with /admins/{uid})
   ========================= */
async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'admins', uid));
  return snap.exists();
}
function onDomReady(cb) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  } else {
    cb();
  }
}

onAuthStateChanged(auth, async function(user) {
  const ok = await isAdmin(user && user.uid);
  if (!ok) {
    // not signed in or not an admin → go to login
    location.replace('./admin-login.html');
    return;
  }
  onDomReady(initAdminUI);
});

// Sign out (button with id="signOutBtn" in admin.html)
document.addEventListener('click', function(e) {
  const btn = e.target.closest('#signOutBtn');
  if (!btn) return;
  signOut(auth).then(function() {
    location.replace('./admin-login.html');
  });
});

/* =========================
   Collections
   ========================= */
const COL = {
  STYLISTS: 'stylists',
  SERVICES: 'services',
  SLOTS:    'slots'
};

/* =========================
   State + element refs
   ========================= */
let el = {};
const state = {
  stylists: [],
  services: []
};

/* =========================
   Utilities (dates, UI, CSV)
   ========================= */
function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function fromYMDLocal(s) {
  const parts = s.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}
function startOfWeekMonday(d0) {
  const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  const dow = d.getDay(); // 0..6 (Sun..Sat)
  const diff = (dow - 1 + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function hmToMinutes(hm) {
  const parts = hm.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}
function minutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function setStatus(node, msg, type) {
  if (!node) return;
  node.textContent = msg;
  node.className = 'pill';
  node.style.color = type === 'error' ? '#b00020' : (type === 'success' ? 'green' : 'inherit');
}
function clearChildren(n) {
  while (n && n.firstChild) n.removeChild(n.firstChild);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
function csvEscape(v) {
  var s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function downloadFile(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/* =========================
   Fetchers
   ========================= */
async function loadStylists() {
  const qx = query(collection(db, COL.STYLISTS), where('active', '==', true));
  const s = await getDocs(qx);
  return s.docs.map(function(d){ return { id: d.id, ...d.data() }; });
}
async function loadServices() {
  const s = await getDocs(collection(db, COL.SERVICES));
  return s.docs.map(function(d){ return { id: d.id, ...d.data() }; });
}

/* =========================
   UI helpers
   ========================= */
function fillSelect(sel, items, valueKey, labelKey, placeholder) {
  if (!sel) return;
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder || 'Choose…';
  sel.appendChild(ph);
  for (var i = 0; i < items.length; i++) {
    const it = items[i];
    const o = document.createElement('option');
    o.value = it[valueKey];
    o.textContent = it[labelKey] || '(Unnamed)';
    sel.appendChild(o);
  }
}

/* =========================
   Slot builders
   ========================= */
function buildDailySlotsForRange(dateYMD, startHM, endHM, intervalMin, opts) {
  const a = hmToMinutes(startHM);
  const b = hmToMinutes(endHM);
  if (b <= a) return [];
  const out = [];
  for (var t = a; t < b; t += intervalMin) {
    const st = minutesToHM(t);
    const en = minutesToHM(Math.min(t + intervalMin, b));
    out.push({
      date: dateYMD,
      start_time: st,
      end_time: en,
      stylist_id: opts.stylistId,
      service_id: opts.serviceId,
      capacity: Number(opts.capacity),
      remaining: Number(opts.capacity),
      active: opts.activeMode === 'open',
      isOpen: opts.activeMode === 'open'
    });
  }
  return out;
}
function buildWeekPlan(inp) {
  const ws = startOfWeekMonday(fromYMDLocal(inp.weekStartYMD));
  const want = {};
  for (var i = 0; i < inp.weekdays.length; i++) want[inp.weekdays[i]] = true;
  const all = [];
  for (var k = 0; k < 7; k++) {
    const d = addDays(ws, k);
    const dow = d.getDay();
    if (!want[dow]) continue;
    const ymd = toLocalYMD(d);
    const daySlots = buildDailySlotsForRange(ymd, inp.startHM, inp.endHM, inp.intervalMin, inp);
    for (var j = 0; j < daySlots.length; j++) all.push(daySlots[j]);
  }
  return all;
}

/* =========================
   Writes
   ========================= */
async function createSlotsBulk(slots) {
  const batch = writeBatch(db);
  const col = collection(db, COL.SLOTS);
  for (var i = 0; i < slots.length; i++) {
    batch.set(doc(col), slots[i]);
  }
  await batch.commit();
}

/* =========================
   Recent
   ========================= */
async function fetchRecentSlots(n) {
  const qx = query(collection(db, COL.SLOTS), orderBy('date', 'desc'), limit(n || 200));
  const s = await getDocs(qx);
  const rows = s.docs.map(function(d){ return { id: d.id, ...d.data() }; });
  rows.sort(function(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.start_time || '') < (b.start_time || '') ? 1 : -1;
  });
  return rows.slice(0, 50);
}

function renderRecentSlots(rows, stylists, services) {
  clearChildren(el.recentSlotsBody);
  const sm = new Map(stylists.map(function(x){ return [x.id, x.full_name || '(Stylist)']; }));
  const pm = new Map(services.map(function(x){ return [x.id, x.name || '(Service)']; }));

  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isOpen = r.isOpen !== false;
    const remaining = Number(r.remaining == null ? (r.capacity == null ? 0 : r.capacity) : r.remaining);
    const capacity = Number(r.capacity == null ? 0 : r.capacity);

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(r.date || '—') + '</td>' +
      '<td>' + escapeHtml((r.start_time || '') + (r.end_time ? '–' + r.end_time : '')) + '</td>' +
      '<td>' + escapeHtml(sm.get(r.stylist_id) || '—') + '</td>' +
      '<td>' + escapeHtml(pm.get(r.service_id) || '—') + '</td>' +
      '<td><button class="toggle-open btn secondary" data-id="' + r.id + '" data-open="' + (isOpen ? '1' : '0') + '">' + (isOpen ? 'Open' : 'Closed') + '</button></td>' +
      '<td>' +
        '<div style="display:inline-flex; gap:6px; align-items:center;">' +
          '<button class="rem-dec btn secondary" data-id="' + r.id + '">–</button>' +
          '<strong data-rem="' + r.id + '">' + remaining + '</strong>' +
          '<button class="rem-inc btn secondary" data-id="' + r.id + '">+</button>' +
        '</div>' +
        '<span class="muted" style="margin-left:6px;">/</span>' +
        '<input type="number" min="0" class="cap-input" data-id="' + r.id + '" value="' + (isFinite(capacity) ? capacity : 0) + '" style="width:70px; padding:6px 8px; border:1px solid #e6e9ef; border-radius:8px;"/>' +
      '</td>' +
      '<td><button class="slot-del btn" style="background:#ffe4e6; color:#b00020;" data-id="' + r.id + '">Delete</button></td>';

    el.recentSlotsBody.appendChild(tr);
  }
}

/* =========================
   Actions
   ========================= */
async function toggleSlotOpen(id, isOpen) {
  await updateDoc(doc(db, COL.SLOTS, id), { isOpen: !isOpen, active: !isOpen });
}
async function adjustRemaining(id, delta) {
  const ref = doc(db, COL.SLOTS, id);
  await runTransaction(db, async function(tx) {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Slot not found');
    const d = snap.data();
    const cap = Number(d.capacity == null ? 0 : d.capacity);
    const curr = Number(d.remaining == null ? (cap > 0 ? cap : 0) : d.remaining);
    var next = curr + delta;
    if (next < 0) next = 0;
    if (cap > 0 && next > cap) next = cap;
    tx.update(ref, { remaining: next });
  });
}
async function setCapacity(id, newCapRaw) {
  const ref = doc(db, COL.SLOTS, id);
  const newCap = Math.max(0, Math.floor(Number(newCapRaw) || 0));
  await runTransaction(db, async function(tx) {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Slot not found');
    const d = snap.data();
    var nextRem = Number(d.remaining == null ? 0 : d.remaining);
    if (newCap === 0) nextRem = 0;
    else if (nextRem > newCap) nextRem = newCap;
    tx.update(ref, { capacity: newCap, remaining: nextRem });
  });
}
async function deleteSlot(id) {
  await deleteDoc(doc(db, COL.SLOTS, id));
}

/* =========================
   CSV export
   ========================= */
async function exportRecentCSV() {
  const rows = await fetchRecentSlots(500);
  const sm = new Map(state.stylists.map(function(x){ return [x.id, x.full_name || '(Stylist)']; }));
  const pm = new Map(state.services.map(function(x){ return [x.id, x.name || '(Service)']; }));

  const header = ['slot_id','date','start_time','end_time','stylist_id','stylist_name','service_id','service_name','isOpen','active','capacity','remaining'];
  const lines = [header.map(csvEscape).join(',')];

  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push([
      r.id,
      r.date || '',
      r.start_time || '',
      r.end_time || '',
      r.stylist_id || '',
      sm.get(r.stylist_id) || '',
      r.service_id || '',
      pm.get(r.service_id) || '',
      (r.isOpen !== false) ? 'true' : 'false',
      (r.active !== false) ? 'true' : 'false',
      Number(r.capacity == null ? 0 : r.capacity),
      Number(r.remaining == null ? 0 : r.remaining)
    ].map(csvEscape).join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  downloadFile('recent-slots-' + stamp + '.csv', blob);
}

/* =========================
   Init (after admin gate)
   ========================= */
async function initAdminUI() {
  // Element refs
  el = {
    // Generate Week
    gwStylist:    document.getElementById('gwStylist'),
    gwService:    document.getElementById('gwService'),
    gwWeekStart:  document.getElementById('gwWeekStart'),
    gwStartTime:  document.getElementById('gwStartTime'),
    gwEndTime:    document.getElementById('gwEndTime'),
    gwInterval:   document.getElementById('gwInterval'),
    gwCapacity:   document.getElementById('gwCapacity'),
    gwActive:     document.getElementById('gwActive'),
    gwDayChecks:  Array.prototype.slice.call(document.querySelectorAll('.gwDay')),
    gwGenerateBtn:document.getElementById('gwGenerateBtn'),
    gwPreviewBtn: document.getElementById('gwPreviewBtn'),
    gwStatus:     document.getElementById('gwStatus'),
    gwPreview:    document.getElementById('gwPreview'),
    gwPreviewBody:document.getElementById('gwPreviewBody'),

    // Single slot
    qsStylist: document.getElementById('qsStylist'),
    qsService: document.getElementById('qsService'),
    qsDate:    document.getElementById('qsDate'),
    qsStart:   document.getElementById('qsStart'),
    qsEnd:     document.getElementById('qsEnd'),
    qsCapacity:document.getElementById('qsCapacity'),
    qsOpen:    document.getElementById('qsOpen'),
    qsCreateBtn:document.getElementById('qsCreateBtn'),
    qsStatus:  document.getElementById('qsStatus'),

    // Recent
    recentSlotsBody: document.getElementById('recentSlotsBody'),
    csvBtn:          document.getElementById('csvBtn')
  };

  try {
    // Load lists
    const lists = await Promise.all([loadStylists(), loadServices()]);
    state.stylists = lists[0];
    state.services = lists[1];

    // Fill selects
    fillSelect(el.gwStylist, state.stylists, 'id', 'full_name', 'Choose stylist');
    fillSelect(el.gwService, state.services, 'id', 'name', 'Choose service');
    fillSelect(el.qsStylist, state.stylists, 'id', 'full_name', 'Choose stylist');
    fillSelect(el.qsService, state.services, 'id', 'name', 'Choose service');

    // Default Monday
    const nextMonday = startOfWeekMonday(new Date());
    if (el.gwWeekStart) el.gwWeekStart.value = toLocalYMD(nextMonday);

    // Preview
    if (el.gwPreviewBtn) {
      el.gwPreviewBtn.addEventListener('click', function() {
        const plan = readGenerateWeekInputs();
        if (!plan.ok) { setStatus(el.gwStatus, plan.msg, 'error'); return; }
        const slots = buildWeekPlan(plan.inputs);
        renderPreview(slots);
        setStatus(el.gwStatus, 'Previewing ' + slots.length + ' slots');
      });
    }

    // Generate
    if (el.gwGenerateBtn) {
      el.gwGenerateBtn.addEventListener('click', async function() {
        const plan = readGenerateWeekInputs();
        if (!plan.ok) { setStatus(el.gwStatus, plan.msg, 'error'); return; }
        const slots = buildWeekPlan(plan.inputs);
        if (!slots.length) { setStatus(el.gwStatus, 'No slots with current settings.', 'error'); return; }
        setStatus(el.gwStatus, 'Creating slots…');
        try {
          const CHUNK = 400;
          for (var i = 0; i < slots.length; i += CHUNK) {
            await createSlotsBulk(slots.slice(i, i + CHUNK));
          }
          setStatus(el.gwStatus, 'Created ' + slots.length + ' slots.', 'success');
          if (el.gwPreview) el.gwPreview.style.display = 'none';
          await refreshRecent();
        } catch (e) {
          console.error(e);
          setStatus(el.gwStatus, 'Failed to create slots.', 'error');
        }
      });
    }

    // Single slot create
    if (el.qsCreateBtn) {
      el.qsCreateBtn.addEventListener('click', async function() {
        const sStylist = el.qsStylist && el.qsStylist.value || '';
        const sService = el.qsService && el.qsService.value || '';
        const sDate    = el.qsDate && el.qsDate.value || '';
        const sStart   = el.qsStart && el.qsStart.value || '';
        const sEnd     = el.qsEnd && el.qsEnd.value || '';
        const sCap     = Number(el.qsCapacity && el.qsCapacity.value || 1);
        const sOpen    = !!(el.qsOpen && el.qsOpen.checked);

        if (!sStylist || !sService || !sDate || !sStart || !sEnd) {
          setStatus(el.qsStatus, 'Please complete all fields.', 'error'); return;
        }
        if (hmToMinutes(sEnd) <= hmToMinutes(sStart)) {
          setStatus(el.qsStatus, 'End must be after start.', 'error'); return;
        }

        setStatus(el.qsStatus, 'Saving…');
        try {
          await addDoc(collection(db, COL.SLOTS), {
            date: sDate,
            start_time: sStart,
            end_time: sEnd,
            stylist_id: sStylist,
            service_id: sService,
            capacity: sCap,
            remaining: sCap,
            active: sOpen,
            isOpen: sOpen
          });
          setStatus(el.qsStatus, 'Slot created.', 'success');
          await refreshRecent();
        } catch (e) {
          console.error(e);
          setStatus(el.qsStatus, 'Failed to create slot.', 'error');
        }
      });
    }

    // Recent table actions
    if (el.recentSlotsBody) {
      el.recentSlotsBody.addEventListener('click', async function(ev) {
        const t = ev.target;
        const toggleBtn = t.closest('.toggle-open');
        const decBtn = t.closest('.rem-dec');
        const incBtn = t.closest('.rem-inc');
        const delBtn = t.closest('.slot-del');

        if (toggleBtn) {
          const id = toggleBtn.getAttribute('data-id');
          const isOpen = toggleBtn.getAttribute('data-open') === '1';
          toggleBtn.disabled = true;
          toggleBtn.textContent = '…';
          try {
            await toggleSlotOpen(id, isOpen);
            await refreshRecent();
          } catch (e) {
            console.error(e);
            alert('Failed to toggle');
            toggleBtn.disabled = false;
          }
          return;
        }

        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          if (!confirm('Delete this slot?')) return;
          delBtn.disabled = true;
          delBtn.textContent = '…';
          try {
            await deleteSlot(id);
            await refreshRecent();
          } catch (e) {
            console.error(e);
            alert('Failed to delete');
            delBtn.disabled = false;
            delBtn.textContent = 'Delete';
          }
          return;
        }

        const btn = decBtn || incBtn;
        if (btn) {
          const id = btn.getAttribute('data-id');
          const delta = decBtn ? -1 : 1;
          btn.disabled = true;
          try {
            await adjustRemaining(id, delta);
            await refreshRecent();
          } catch (e) {
            console.error(e);
            alert('Failed to update remaining');
            btn.disabled = false;
          }
        }
      });

      // Capacity editor
      el.recentSlotsBody.addEventListener('keydown', async function(ev) {
        const input = ev.target.closest('.cap-input');
        if (!input) return;
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        await saveCapacityInput(input);
      });
      el.recentSlotsBody.addEventListener('change', async function(ev) {
        const input = ev.target.closest('.cap-input');
        if (!input) return;
        await saveCapacityInput(input);
      });
      el.recentSlotsBody.addEventListener('blur', async function(ev) {
        const input = ev.target.closest('.cap-input');
        if (!input) return;
        await saveCapacityInput(input);
      }, true);
    }

    // CSV
    if (el.csvBtn) {
      el.csvBtn.addEventListener('click', exportRecentCSV);
    }

    await refreshRecent();
  } catch (e) {
    console.error('Admin init failed:', e);
    setStatus(el.gwStatus, 'Failed to load admin data.', 'error');
  }
}

/* =========================
   Helpers (Generate Week)
   ========================= */
function readGenerateWeekInputs() {
  const stylistId = el.gwStylist && el.gwStylist.value || '';
  const serviceId = el.gwService && el.gwService.value || '';
  const weekStartRaw = el.gwWeekStart && el.gwWeekStart.value || '';
  const startHM = el.gwStartTime && el.gwStartTime.value || '';
  const endHM   = el.gwEndTime && el.gwEndTime.value || '';
  const intervalMin = Number(el.gwInterval && el.gwInterval.value || 0);
  const capacity = Number(el.gwCapacity && el.gwCapacity.value || 1);
  const activeMode = el.gwActive && el.gwActive.value || 'open';
  const dayChecks = el.gwDayChecks || [];
  const weekdays = [];
  for (var i = 0; i < dayChecks.length; i++) {
    if (dayChecks[i].checked) weekdays.push(Number(dayChecks[i].value));
  }

  if (!stylistId || !serviceId || !weekStartRaw || !startHM || !endHM || !intervalMin) {
    return { ok: false, msg: 'Please complete all Generate Week fields.' };
  }
  if (intervalMin <= 0) return { ok: false, msg: 'Interval must be greater than 0.' };
  if (hmToMinutes(endHM) <= hmToMinutes(startHM)) return { ok: false, msg: 'End time must be after start time.' };
  if (weekdays.length === 0) return { ok: false, msg: 'Pick at least one weekday.' };

  const monday = toLocalYMD(startOfWeekMonday(fromYMDLocal(weekStartRaw)));

  return {
    ok: true,
    inputs: {
      stylistId: stylistId,
      serviceId: serviceId,
      weekStartYMD: monday,
      startHM: startHM,
      endHM: endHM,
      intervalMin: intervalMin,
      capacity: capacity,
      activeMode: activeMode,
      weekdays: weekdays
    }
  };
}

function renderPreview(slots) {
  if (!el.gwPreview || !el.gwPreviewBody) return;
  el.gwPreview.style.display = slots.length ? 'block' : 'none';
  clearChildren(el.gwPreviewBody);
  const MAX = 150;
  const shown = slots.slice(0, MAX);
  for (var i = 0; i < shown.length; i++) {
    const s = shown[i];
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(s.date) + '</td>' +
      '<td>' + escapeHtml(s.start_time) + '</td>' +
      '<td>' + escapeHtml(s.end_time) + '</td>' +
      '<td>' + escapeHtml(String(s.capacity)) + '</td>';
    el.gwPreviewBody.appendChild(tr);
  }
  if (slots.length > MAX) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">… and ' + (slots.length - MAX) + ' more</td>';
    el.gwPreviewBody.appendChild(tr);
  }
}

async function refreshRecent() {
  const rows = await fetchRecentSlots(200);
  renderRecentSlots(rows, state.stylists, state.services);
}

async function saveCapacityInput(input) {
  const id = input.getAttribute('data-id');
  var value = Number(input.value);
  if (!isFinite(value) || value < 0) value = 0;
  input.disabled = true;
  try {
    await setCapacity(id, value);
    await refreshRecent();
  } catch (e) {
    console.error(e);
    alert('Failed to update capacity');
  } finally {
    input.disabled = false;
  }
}
