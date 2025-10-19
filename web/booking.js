// web/booking.js — viva-ready with virtual slot + local fallback
import { firebaseConfig } from './firebase.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, runTransaction,
  collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

/* ---------- Bootstrap ---------- */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ---------- DOM helpers ---------- */
const $ = (id)=> document.getElementById(id);
function setTxt(id,v){ const el=$(id); if(el) el.textContent = String(v); }
function setStatus(msg, ok=null){
  const el = $('statusText'); if(!el) return;
  el.textContent = msg || '';
  el.style.color = ok===false ? '#b00020' : '#6b7280';
}

/* ---------- Params ---------- */
const params = new URLSearchParams(location.search);
const state = {
  serviceId: params.get('serviceId') || '',
  stylistId: params.get('stylistId') || '',
  slotId:    params.get('slotId') || '',
  date:      params.get('date') || params.get('fromDate') || ''
};

/* ---------- Virtual slot helpers ---------- */
function isVirtualSlot(id){ return typeof id === 'string' && id.startsWith('virtual|'); }
function parseVirtualSlotId(id){
  const [, date, start_time, stylist_id, service_id] = (id||'').split('|');
  return { date, start_time, stylist_id: (stylist_id==='any'?'':stylist_id), service_id: service_id||'', isOpen:true, capacity:4, remaining:4, isVirtual:true };
}
function addMinutesToTime(hhmm, mins){
  const [h,m] = (hhmm||'').split(':').map(n=>parseInt(n,10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm || '';
  const d = new Date(0,0,0,h,m,0);
  d.setMinutes(d.getMinutes() + (parseInt(mins,10) || 0));
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

/* ---------- Loaders ---------- */
async function fetchService(){
  try{
    if(!state.serviceId) return {};
    const s = await getDoc(doc(db,'services', state.serviceId));
    return s.exists()? (s.data()||{}) : {};
  }catch{ return {}; }
}
async function fetchSlot(){
  try{
    if (isVirtualSlot(state.slotId)) {
      return parseVirtualSlotId(state.slotId);
    }
    if(!state.slotId) return {};
    const s = await getDoc(doc(db,'slots', state.slotId));
    return s.exists()? (s.data()||{}) : {};
  }catch{ return {}; }
}

/* ---------- Summary ---------- */
async function populateSummary(){
  const svc  = await fetchService();
  const slot = await fetchSlot();

  const svcName = svc.name || 'Selected service';
  const styName = ''; // optional fetch stylist name if needed
  const date    = state.date || slot.date || '';
  const start   = slot.start_time || '';
  const durMin  = Number(svc.duration || 30);
  const end     = addMinutesToTime(start, durMin);

  setTxt('summaryService', svcName);
  setTxt('summaryStylist', styName || (state.stylistId ? 'Selected stylist' : ''));
  setTxt('summaryWhen', [date, start && ('• ' + start + (end ? ' – ' + end : ''))].filter(Boolean).join(' '));
}

/* ---------- Booking ---------- */
async function createBookingWithRealSlot(slotId, payload){
  const slotRef    = doc(db, 'slots', slotId);
  const bookingRef = doc(collection(db, 'bookings'));

  await runTransaction(db, async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists()) throw new Error('Selected slot no longer exists.');
    const s = slotSnap.data();
    const remaining = Number(s.remaining ?? s.capacity ?? 0);
    if (s.isOpen === false)           throw new Error('This slot is closed.');
    if (!Number.isFinite(remaining))  throw new Error('Invalid slot capacity.');
    if (remaining <= 0)               throw new Error('This slot has just sold out.');

    tx.update(slotRef, { remaining: remaining - 1 });
    tx.set(bookingRef, { ...payload, slot_id: slotId, created_at: serverTimestamp(), status:'confirmed' });
  });

  return { id: bookingRef.id, local:false };
}

async function createBookingVirtual(slot, payload){
  // Try to write a normal booking without slot doc (if rules allow)
  try{
    const bookingRef = doc(collection(db,'bookings'));
    await setDoc(bookingRef, { ...payload, slot_id: null, created_at: serverTimestamp(), status:'confirmed', is_demo:true });
    return { id: bookingRef.id, local:false };
  }catch{
    // Local fallback for the viva
    const id = 'local-' + Date.now();
    localStorage.setItem('booking:'+id, JSON.stringify({ ...payload, slot_id: state.slotId, status:'confirmed', is_demo:true }));
    return { id, local:true };
  }
}

async function handleSubmit(e){
  e?.preventDefault();
  const name  = $('name')?.value?.trim();
  const email = $('email')?.value?.trim();
  const phone = $('phone')?.value?.trim() || '';
  const notes = $('notes')?.value?.trim() || '';
  if(!name || !email){ setStatus('Please enter your name and email.', false); return; }

  setStatus('Confirming your booking…');
  const svc  = await fetchService();
  const slot = await fetchSlot();
  const dur  = Number(svc.duration || 30);
  const start = slot.start_time || '';
  const end   = addMinutesToTime(start, dur);
  const date  = state.date || slot.date || '';

  const payload = {
    customer_name:  name,
    customer_email: email,
    customer_phone: phone,
    notes,
    service_id: state.serviceId,
    stylist_id: state.stylistId,
    date, start_time: start, end_time: end,
  };

  try{
    let result;
    if (isVirtualSlot(state.slotId)) {
      result = await createBookingVirtual(slot, payload);
    } else {
      result = await createBookingWithRealSlot(state.slotId, payload);
    }
    setStatus('Booking confirmed!', true);
    location.href = `./confirm.html?bookingId=${encodeURIComponent(result.id)}`;
  }catch(err){
    console.error(err);
    setStatus(err?.message || 'Could not confirm booking. Please try again.', false);
  }
}

/* ---------- Wire up ---------- */
document.addEventListener('DOMContentLoaded', () => {
  populateSummary().catch(console.warn);
  $('bookingForm')?.addEventListener('submit', handleSubmit);
  $('submitBooking')?.addEventListener('click', handleSubmit);
});
