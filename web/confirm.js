import { firebaseConfig } from './firebase.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getFirestore(app);

const qp = new URLSearchParams(location.search);
const bookingId = qp.get('bookingId');

const el = (id)=> document.getElementById(id);
const setTxt = (id,v)=>{ const e=el(id); if(e) e.textContent = String(v ?? ''); };

async function loadBooking(){
  if (!bookingId) throw new Error('Missing bookingId.');
  if (bookingId.startsWith('local-')){
    const raw = localStorage.getItem('booking:'+bookingId);
    if (!raw) throw new Error('Local booking not found.');
    const b = JSON.parse(raw);
    return { id: bookingId, ...b };
  }
  const snap = await getDoc(doc(db,'bookings', bookingId));
  if (!snap.exists()) throw new Error('Booking not found.');
  return { id: bookingId, ...snap.data() };
}
async function fetchOptional(col, id){
  try{
    if(!id) return {};
    const s = await getDoc(doc(db,col,id));
    return s.exists()? (s.data()||{}) : {};
  }catch{ return {}; }
}
function pad(n){ return String(n).padStart(2,'0'); }
function icsDateTime(date, time){
  const [y,m,d] = (date||'').split('-').map(Number);
  const [hh,mm] = (time||'').split(':').map(Number);
  const dt = new Date(y,(m||1)-1,d||1,hh||0,mm||0);
  return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}
function downloadICS(b, svcName='Appointment'){
  const dtstart = icsDateTime(b.date, b.start_time);
  const dtend   = icsDateTime(b.date, b.end_time||b.start_time);
  const lines = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//A1 Booking//EN','BEGIN:VEVENT',
    `UID:a1-${Date.now()}@a1-booking`,`DTSTAMP:${dtstart}`,`DTSTART:${dtstart}`,`DTEND:${dtend}`,
    `SUMMARY:${svcName}`,`DESCRIPTION:Service ${b.service_id||''} with ${b.stylist_id||''}`,'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([lines], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href=url; a.download=`booking-${b.date}-${b.start_time}.ics`; a.click();
  URL.revokeObjectURL(url);
}

async function main(){
  try{
    const b   = await loadBooking();
    const svc = await fetchOptional('services', b.service_id);
    const sty = await fetchOptional('stylists', b.stylist_id);

    const svcName  = svc.name || 'Selected service';
    const duration = Number(svc.duration || 30);

    el('statusCard')?.classList.add('ok');
    el('statusTitle').textContent = 'Confirmed';
    el('statusSubtitle').textContent = 'Your appointment is booked.';

    const final = (b.price_final != null)
      ? Number(b.price_final)
      : Number(svc.price_aud ?? svc.price);
    const priceText  = Number.isFinite(final) ? ('$' + final) : '—';

    setTxt('svc', svcName);
    setTxt('sty', sty.full_name || sty.name || '—');
    setTxt('date', b.date || '');
    setTxt('time', [b.start_time||'', b.end_time ? ('– '+b.end_time) : ''].filter(Boolean).join(' '));
    setTxt('duration', duration ? `${duration} min` : '—');
    setTxt('price', priceText);
    setTxt('cust', b.customer_name ? `${b.customer_name} (${b.customer_email})` : '');
    setTxt('status', b.status || 'confirmed');

    el('icsBtn')?.addEventListener('click', ()=> downloadICS(b, svcName));
    el('printBtn')?.addEventListener('click', ()=> window.print());
  }catch(err){
    console.error(err);
    el('statusTitle').textContent = 'Something went wrong';
    el('statusSubtitle').textContent = err.message || '';
  }
}
main();
