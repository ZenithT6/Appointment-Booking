// admin-customers.js — Admin-only CRM (Firebase v10.12.4)
import { firebaseConfig } from './firebase.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore, collection, getDocs, query, orderBy, where, limit, doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Expose for console debugging
if (typeof window !== 'undefined') { window.app = app; window.auth = auth; window.db = db; }

const $ = (s) => document.querySelector(s);
const rowsEl = $('#rows');
const metaEl = $('#meta');
const searchEl = $('#searchInput');
const filtProviderEl = $('#filterProvider');
const sortEl = $('#sortSelect');
const exportEl = $('#exportCsv');
const kpiTotalEl = $('#kpiTotal');
const kpiReturningEl = $('#kpiReturning');
const kpiNewWeekEl = $('#kpiNewWeek');
const drawer = $('#drawer');
const drawerTitle = $('#drawerTitle');
const drawerBody = $('#drawerBody');
const drawerClose = $('#drawerClose');

let customers = [], view = [], sortKey = 'last_booking_at', sortDir = 'desc';

const esc = (s) => (s === 0 ? '0' : (s ? String(s) : '')).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const isTs = (v) => v && typeof v === 'object' && ('seconds' in v || typeof v.toDate === 'function');
const tsToDate = (ts) => !ts ? null : (typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000));
const fmtTs = (ts) => { const d = tsToDate(ts); return d ? d.toLocaleString() : ''; };

function sortBy(list, key, dir){
  const sign = dir === 'desc' ? -1 : 1;
  return list.slice().sort((a,b)=>{
    const va=a[key], vb=b[key];
    if (isTs(va) || isTs(vb)) {
      const sa=tsToDate(va)?.getTime() ?? -Infinity;
      const sb=tsToDate(vb)?.getTime() ?? -Infinity;
      return sign*(sa-sb);
    }
    if (typeof va==='string' && typeof vb==='string') return sign*va.localeCompare(vb);
    const na=(va==null)?-Infinity:Number(va);
    const nb=(vb==null)?-Infinity:Number(vb);
    return sign*(na-nb);
  });
}

function applyFilters(){
  const term=(searchEl?.value||'').trim().toLowerCase();
  const prov=(filtProviderEl?.value||'').trim();
  let list=customers;
  if (prov) list=list.filter(c => (c.authProvider||'')===prov || (prov==='guest' && c.authProvider==='guest'));
  if (term) list=list.filter(c =>
    (c.name||'').toLowerCase().includes(term) ||
    (c.email||'').toLowerCase().includes(term) ||
    (c.phone||'').toLowerCase().includes(term)
  );
  const [k,d]=(sortEl?.value||`${sortKey}:${sortDir}`).split(':');
  sortKey=k; sortDir=d;
  view=sortBy(list, sortKey, sortDir);
}

function computeKpis(){
  kpiTotalEl.textContent = customers.length.toString();
  kpiReturningEl.textContent = customers.filter(c => (c.total_bookings||0) >= 3).length.toString();
  const now=new Date(); const weekAgo=new Date(now.getTime()-7*24*60*60*1000);
  kpiNewWeekEl.textContent = customers.filter(c => { const d=tsToDate(c.created_at); return d && d>=weekAgo; }).length.toString();
}

function render(){
  applyFilters(); computeKpis();
  metaEl.textContent = `${view.length} customers`;
  rowsEl.innerHTML = view.map(c=>{
    const returning=(c.total_bookings||0) >= 3;
    return `
      <tr data-id="${esc(c.id)}" style="cursor:pointer">
        <td>${esc(c.name||'')}${returning?' <span class="badge regular">Returning</span>':''}</td>
        <td>${esc(c.email||'')}</td>
        <td>${esc(c.phone||'')}</td>
        <td>${esc(c.authProvider||'')}</td>
        <td>${Number(c.total_bookings||0)}</td>
        <td>${esc(fmtTs(c.last_booking_at))}</td>
        <td>${esc(fmtTs(c.last_login_at))}</td>
      </tr>`;
  }).join('');
  rowsEl.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click',()=>openDrawer(tr.getAttribute('data-id')));
  });
}

async function loadCustomers(){
  const snap = await getDocs(query(collection(db,'customers'), orderBy('last_booking_at','desc')));
  const raw = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  const withLB = raw.filter(c=>!!c.last_booking_at);
  const withoutLB = raw.filter(c=>!c.last_booking_at)
    .sort((a,b)=>(tsToDate(b.last_login_at)?.getTime()??0)-(tsToDate(a.last_login_at)?.getTime()??0));
  customers = withLB.concat(withoutLB);
  render();
}

async function openDrawer(customerId){
  if(!customerId) return;
  drawerTitle.textContent='Customer';
  drawerBody.textContent='Loading…';
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');

  const cref = doc(db,'customers',customerId);
  const csnap = await getDoc(cref);
  if (!csnap.exists()) { drawerBody.textContent='Customer not found.'; return; }
  const c = { id:csnap.id, ...csnap.data() };

  const bkSnap = await getDocs(
    query(collection(db,'bookings'),
      where('customer_id','==', customerId),
      orderBy('created_at','desc'),
      limit(10)
    )
  );
  const bookings = bkSnap.docs.map(d=>({ id:d.id, ...d.data() }));

  drawerTitle.textContent = c.name || c.email || 'Customer';
  drawerBody.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div>
        <div style="font-weight:600;font-size:16px">${esc(c.name||'')}</div>
        <div class="muted">${esc(c.email||'')}${c.phone?' · '+esc(c.phone):''}</div>
        <div class="muted">Provider: ${esc(c.authProvider||'')}</div>
      </div>
      <div><span class="badge">Bookings: ${Number(c.total_bookings||0)}</span></div>
    </div>
    <div style="margin-top:12px">
      <div class="muted">Last booking: ${esc(fmtTs(c.last_booking_at))}</div>
      <div class="muted">Last login: ${esc(fmtTs(c.last_login_at))}</div>
    </div>
    <h3 style="margin:16px 0 8px">Recent bookings</h3>
    ${bookings.length===0?'<div class="muted">No recent bookings.</div>':`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Date</th><th>Time</th><th>Service</th><th>Stylist</th><th>Status</th></tr></thead>
          <tbody>
            ${bookings.map(b=>`
              <tr>
                <td>${esc(b.date||'')}</td>
                <td>${esc(b.start_time||'')}</td>
                <td>${esc(b.service_id||'')}</td>
                <td>${esc(b.stylist_id||'')}</td>
                <td>${esc(b.status||'')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}
function closeDrawer(){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); }

function toCsv(rows){
  const header=['Name','Email','Phone','Provider','Total Bookings','Last Booking','Last Login'];
  const lines=rows.map(c=>[
    c.name||'', c.email||'', c.phone||'', c.authProvider||'',
    Number(c.total_bookings||0), fmtTs(c.last_booking_at), fmtTs(c.last_login_at)
  ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
  return [header.join(','), ...lines].join('\n');
}
function downloadCsv(name,text){
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function requireAdmin(){
  return new Promise((resolve,reject)=>{
    onAuthStateChanged(auth, async (user)=>{
      if(!user){ metaEl.textContent='Not signed in.'; return reject(new Error('not_signed_in')); }
      try{
        const s = await getDoc(doc(db,'admins',user.uid));
        if (!s.exists()) { metaEl.textContent='Not an admin for this project.'; return reject(new Error('not_admin')); }
        resolve(user);
      }catch(e){ metaEl.textContent='Failed to verify admin (rules?).'; reject(e); }
    });
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  searchEl?.addEventListener('input', render);
  filtProviderEl?.addEventListener('change', render);
  sortEl?.addEventListener('change', render);
  exportEl?.addEventListener('click',()=>{ applyFilters(); downloadCsv(`customers_${new Date().toISOString().slice(0,10)}.csv`, toCsv(view)); });
  drawerClose?.addEventListener('click', closeDrawer);

  try { await requireAdmin(); await loadCustomers(); }
  catch (e) { console.error(e); }
});
