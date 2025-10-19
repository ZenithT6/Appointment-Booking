import { firebaseConfig } from './firebase.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getFirestore, collection, getDocs, query, where, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// UI
const datePicker = document.getElementById('datePicker');
const styFilter  = document.getElementById('styFilter');
const statusFilter = document.getElementById('statusFilter');
const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('emptyState');
const exportBtn = document.getElementById('exportBtn');

let unsubscribe = null;
let stylists = [];
let currentData = [];

// Helpers
const toISODate = (d) => d.toISOString().slice(0, 10);

function setTodayDefault() {
  datePicker.value = toISODate(new Date());
}

function renderRows(data) {
  if (!data.length) {
    rowsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  rowsEl.innerHTML = data.map(b => `
    <tr>
      <td><span class="badge">${b.start_time || ''}</span></td>
      <td>${b.customer_name || ''}<div class="small">${b.email || ''}</div></td>
      <td>${b.service_name || ''}</td>
      <td>${b.stylist_name || 'Any'}</td>
      <td><span class="badge">${b.status || ''}</span></td>
      <td class="small">${b.id}</td>
    </tr>
  `).join('');
}

function applyFilters(raw) {
  const sty = styFilter.value;       // 'any' or stylistId
  const st  = statusFilter.value;    // 'any' or status
  let filtered = raw;

  if (sty !== 'any') {
    filtered = filtered.filter(b => (b.stylist_id || '') === sty);
  }
  if (st !== 'any') {
    filtered = filtered.filter(b => (b.status || '') === st);
  }

  // Client-side sort (avoid Firestore composite index): time ascending
  filtered.sort((a,b) => (a.start_time || '').localeCompare(b.start_time || ''));
  return filtered;
}

function subscribeDay() {
  // Clean up old listener
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const dateStr = datePicker.value;
  if (!dateStr) return;

  // Real-time stream for the chosen day; no orderBy to avoid new index.
  const qDay = query(collection(db, 'bookings'), where('date', '==', dateStr));
  unsubscribe = onSnapshot(qDay, (snap) => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    currentData = arr;
    renderRows(applyFilters(arr));
  }, (err) => {
    console.error('onSnapshot error', err);
    // Fallback: show empty with error
    rowsEl.innerHTML = `<tr><td colspan="6">Error loading bookings: ${err.message}</td></tr>`;
  });
}

function downloadCSV(rows) {
  const headers = ['Ref','Date','Start','End','Customer','Email','Phone','Service','Stylist','Status'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [
      r.id || '',
      r.date || '',
      r.start_time || '',
      r.end_time || '',
      r.customer_name || '',
      r.email || '',
      r.phone || '',
      r.service_name || '',
      r.stylist_name || 'Any',
      r.status || ''
    ].map(v => {
      const s = String(v ?? '');
      // Escape quotes and wrap if needed
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(cells.join(','));
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const day = datePicker.value || 'day';
  a.download = `schedule-${day}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadStylists() {
  const snap = await getDocs(collection(db, 'stylists'));
  stylists = [];
  snap.forEach(d => stylists.push({ id: d.id, ...d.data() }));
  const active = stylists.filter(s => s.active !== false);
  styFilter.innerHTML = '<option value="any">Any</option>' + active.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');
}

// Events
datePicker.addEventListener('change', subscribeDay);
styFilter.addEventListener('change', () => renderRows(applyFilters(currentData)));
statusFilter.addEventListener('change', () => renderRows(applyFilters(currentData)));
exportBtn.addEventListener('click', () => downloadCSV(applyFilters(currentData)));

// Init
(async function init() {
  setTodayDefault();
  await loadStylists();
  subscribeDay();
})();
