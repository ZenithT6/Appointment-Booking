"use strict";

import { firebaseConfig } from "./firebase.js";
import {
  ensure, renderStepper, renderSummary, selections, buildQS,
} from "./utils.js";
import { dealFor } from "./utils-deals.js";

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, where, doc, getDoc, addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ---------- Boot ---------- */
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ---------- Params/guards ---------- */
const sel        = selections();
const serviceId  = sel.serviceId || "";
const stylistId  = sel.stylistId || "";
const initialYMD = sel.date || sel.fromDate || "";

ensure("stylistId", "./team.html?" + buildQS({ serviceId }));
document.getElementById("backLink")?.setAttribute("href", "./team.html?" + buildQS({ serviceId }));

/* ---------- DOM ---------- */
const monthLabel = document.getElementById("monthLabel");
const prevMonth  = document.getElementById("prevMonth");
const nextMonth  = document.getElementById("nextMonth");
const calEl      = document.getElementById("cal");
const timesEl    = document.getElementById("times");
const emptyEl    = document.getElementById("timesEmpty");
const slotTitle  = document.getElementById("slotTitle");

/* Waitlist DOM */
const wlOpen  = document.getElementById("wlOpen");
const wlModal = document.getElementById("wlModal");
const wlClose = document.getElementById("wlClose");
const wlSubmit= document.getElementById("wlSubmit");
const wlName  = document.getElementById("wlName");
const wlEmail = document.getElementById("wlEmail");
const wlNotes = document.getElementById("wlNotes");
const wlMsg   = document.getElementById("wlMsg");

/* ---------- State ---------- */
let currentMonth = initialYMD ? new Date(initialYMD) : new Date();
let selectedYMD  = initialYMD || "";
let serviceDoc   = null;
const cache      = {}; // monthKey -> { 'YYYY-MM-DD': [slots...] }

/* ---------- Helpers ---------- */
const esc=s=>String(s ?? "").replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,"0");
const toYMD=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfMonth=d=>new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth=d=>new Date(d.getFullYear(), d.getMonth()+1, 0);
const ymKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
const addDays=(d,n)=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; };
const leftText=rem=>{ const r=Number(rem); return r>0 && r<=3 ? ` • ${r} left` : ""; };

function makeVirtualSlotId({date, start_time, stylist_id="any", service_id=""}){
  return `virtual|${date}|${start_time}|${stylist_id||"any"}|${service_id||""}`;
}
function synthSlots({ days=5, times=["10:00","11:00","12:00","14:00","16:00"], stylistId, serviceId }={}){
  const today = new Date();
  const out = [];
  for (let i=0;i<days;i++){
    const date = toYMD(addDays(today, i));
    for (const start_time of times){
      const id = makeVirtualSlotId({ date, start_time, stylist_id: stylistId||"any", service_id: serviceId||"" });
      out.push({ id, date, start_time, stylist_id: stylistId||"", service_id: serviceId||"", capacity:4, remaining:4, isOpen:true, isVirtual:true });
    }
  }
  return out;
}

/* ---------- Data ---------- */
async function loadService(){
  if (!serviceId) return null;
  try {
    const s = await getDoc(doc(db, "services", serviceId));
    serviceDoc = s.exists() ? s.data() : null;
  } catch { serviceDoc = null; }
}
async function loadMonthSlots(monthDate){
  try{
    const cons = [where("stylist_id","==", stylistId)];
    if (serviceId) cons.push(where("service_id","==", serviceId));
    const qBase = query(collection(db,"slots"), ...cons);
    const snap  = await getDocs(qBase);
    const all   = snap.docs.map(d=>({ id:d.id, ...d.data() })).filter(x => x.active !== false);
    const visible = all.filter(x => (x.isOpen !== false) && (Number(x.remaining ?? x.capacity ?? 0) > 0));

    const s = startOfMonth(monthDate), e = endOfMonth(monthDate);
    const inMonth = visible.filter(x => {
      const parts = String(x.date||"").split("-").map(Number);
      if (parts.length!==3) return false;
      const dt = new Date(parts[0], (parts[1]||1)-1, parts[2]||1);
      return dt >= s && dt <= e;
    });

    const list = inMonth.length ? inMonth : synthSlots({ stylistId, serviceId });
    const map = {};
    for (const it of list){ (map[String(it.date)] ||= []).push(it); }
    for (const k in map){ map[k].sort((a,b)=> String(a.start_time).localeCompare(String(b.start_time))); }
    return map;
  }catch{
    const vlist = synthSlots({ stylistId, serviceId }); // local fallback
    const map = {};
    for (const it of vlist){ (map[String(it.date)] ||= []).push(it); }
    for (const k in map){ map[k].sort((a,b)=> String(a.start_time).localeCompare(String(b.start_time))); }
    return map;
  }
}
async function ensureMonth(date){
  const key = ymKey(date);
  if (!cache[key]) cache[key] = await loadMonthSlots(date);
  return cache[key];
}

/* ---------- UI: calendar ---------- */
function monthTitle(d){ return d.toLocaleString(undefined, { month:"long", year:"numeric" }); }

async function renderCalendar(){
  const monthMap = await ensureMonth(currentMonth);
  monthLabel.textContent = monthTitle(currentMonth);

  // choose default date if none selected
  if (!selectedYMD){
    const days = Object.keys(monthMap).sort();
    if (days.length) selectedYMD = days[0];
  }
  slotTitle.textContent = selectedYMD ? `Times for ${selectedYMD}` : "Times";

  const first = startOfMonth(currentMonth);
  const start = new Date(first);
  const shift = (first.getDay()+6)%7; // Monday first
  start.setDate(first.getDate()-shift);

  let html = "";
  for (let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const ymd = toYMD(d);
    const has = !!monthMap[ymd];
    const isOther = d.getMonth() !== currentMonth.getMonth();
    const isSel = selectedYMD === ymd;
    html += `<button class="day ${has?'has':''} ${isOther?'other':''} ${isSel?'sel':''}" data-ymd="${ymd}" ${has?'':'disabled'}>` +
            `${d.getDate()}${has?'<span class="dot"></span>':''}</button>`;
  }
  calEl.innerHTML = html;

  calEl.querySelectorAll("button.day").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const ymd = btn.getAttribute("data-ymd");
      if (!ymd) return;
      selectedYMD = ymd;
      renderCalendar();
      renderTimes();
    });
  });
}
prevMonth?.addEventListener("click", ()=>{
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1);
  renderCalendar().then(renderTimes);
});
nextMonth?.addEventListener("click", ()=>{
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1);
  renderCalendar().then(renderTimes);
});

/* ---------- UI: times ---------- */
function buildLoginHref(slot){
  const p = new URLSearchParams();
  if (slot.id)         p.set("slotId", slot.id);
  if (slot.stylist_id) p.set("stylistId", slot.stylist_id);
  if (slot.service_id || serviceId) p.set("serviceId", slot.service_id || serviceId);
  const ymd = selectedYMD || slot.date || "";
  p.set("date", ymd);
  p.set("fromDate", ymd);
  return `./login.html?${p.toString()}`;
}

async function renderTimes(){
  await loadService();
  const month = await ensureMonth(currentMonth);

  timesEl.innerHTML = "";
  const list = month[selectedYMD] || [];
  emptyEl.style.display = list.length ? "none" : "block";

  for (const slot of list){
    const a = document.createElement("a");
    a.className = "chip";
    a.href = buildLoginHref(slot);
    a.setAttribute("role", "option");

    const deal = dealFor({ date: selectedYMD, start_time: slot.start_time }, serviceDoc);
    const base = Number(serviceDoc?.price_aud ?? serviceDoc?.price);
    const hasPrice = Number.isFinite(base);
    const priceHtml = hasPrice
      ? (deal.isDeal
         ? `<span class="price"><s>$${base}</s> <b>$${deal.priceFinal}</b></span>`
         : `<span class="price">$${base}</span>`)
      : "";
    const dealPill = deal.isDeal ? `<span class="deal">Deal −${deal.pct}%</span>` : "";

    a.innerHTML = `
      <span class="left">${esc(slot.start_time||"")}</span>
      <span class="right">${dealPill}${priceHtml}${leftText(slot.remaining)}</span>`;
    timesEl.appendChild(a);
  }
}

/* ---------- Waitlist ---------- */
function wlShow(v){ if(wlModal) wlModal.style.display = v ? 'grid' : 'none'; }
wlOpen?.addEventListener('click', ()=> wlShow(true));
wlClose?.addEventListener('click', ()=> wlShow(false));
wlSubmit?.addEventListener('click', async ()=>{
  const name  = wlName?.value?.trim();
  const email = wlEmail?.value?.trim();
  const notes = wlNotes?.value?.trim() || '';
  if (!name || !email){ if(wlMsg) wlMsg.textContent="Enter name & email"; return; }
  if (wlMsg) wlMsg.textContent="Saving…";
  const item = { name, email, notes, service_id: serviceId, date: selectedYMD || null, status:'waiting', created_at: new Date().toISOString() };
  try { await addDoc(collection(db,'waitlist'), item); }
  catch {
    const key='a1:waitlist';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.push({ ...item, id:'local-'+Date.now() });
    localStorage.setItem(key, JSON.stringify(arr));
  }
  if (wlMsg) wlMsg.textContent="Added!";
  setTimeout(()=> wlShow(false), 600);
});

/* ---------- Stepper + summary ---------- */
renderStepper({ mountId: "stepper", step: "time" });
(async () => {
  let _serviceName = "", _stylistName = "";
  async function getName(col, id){
    try{
      const d = await getDoc(doc(getFirestore(), col, id));
      return d.exists() ? (d.data().name || d.data().full_name || "") : "";
    }catch{ return ""; }
  }
  _serviceName = serviceId ? (await getName("services", serviceId)) : "";
  _stylistName = stylistId ? (await getName("stylists", stylistId)) : "";

  const dateLabel = selectedYMD || "";
  renderSummary({
    mountId: "summary",
    serviceName: _serviceName,
    stylistName: _stylistName,
    dateLabel,
    timeLabel: ""
  });
})();

/* ---------- First paint ---------- */
renderCalendar().then(renderTimes);
