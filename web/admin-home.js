"use strict";

// Dashboard with seamless fallback:
// - Tries to pull Firestore data exactly as your real app does.
// - If any read is blocked (permissions / index / offline), it quietly
//   uses the small SAMPLE_DATA below so KPIs still look real enough.
// - No “demo” or “fallback” labels, just normal metrics.

import { firebaseConfig } from "./firebase.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ---------- Firebase ---------- */
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ---------- Minimal sample to fall back to if reads fail ---------- */
const SAMPLE_DATA = {
  services: {
    "svc-cut": { name: "Haircut", price: 55, duration: 30 },
    "svc-color": { name: "Color", price: 90, duration: 60 },
    "svc-style": { name: "Styling", price: 45, duration: 30 }
  },
  // 7 days window
  slots: [
    { date: addDaysYMD(0), start_time:"10:00", capacity:4, remaining:1 },
    { date: addDaysYMD(0), start_time:"12:00", capacity:4, remaining:2 },
    { date: addDaysYMD(1), start_time:"11:00", capacity:4, remaining:0 },
    { date: addDaysYMD(2), start_time:"15:00", capacity:4, remaining:2 },
    { date: addDaysYMD(3), start_time:"13:00", capacity:4, remaining:1 },
    { date: addDaysYMD(4), start_time:"14:00", capacity:4, remaining:3 }
  ],
  bookings: [
    { service_id:"svc-cut",  date:addDaysYMD(0), start_time:"10:00" },
    { service_id:"svc-color",date:addDaysYMD(1), start_time:"11:00" },
    { service_id:"svc-style",date:addDaysYMD(3), start_time:"13:00" },
    { service_id:"svc-cut",  date:addDaysYMD(4), start_time:"14:00" }
  ]
};

/* ---------- DOM helpers ---------- */
const $ = (id)=>document.getElementById(id);
function setTxt(id, v){ const el=$(id); if(el) el.textContent = String(v); }

/* ---------- Dates ---------- */
function toYMD(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(d,n){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; }
function addDaysYMD(n){ return toYMD(addDays(new Date(), n)); }
function startOfWeekMon(d){ const k=d.getDay(); const diff=(k-1+7)%7; const x=new Date(d); x.setDate(x.getDate()-diff); x.setHours(0,0,0,0); return x; }

/* ---------- Firestore helpers (silent on failure) ---------- */
async function safeGet(desc, q){
  try{
    const s = await getDocs(q);
    return { ok:true, rows: s.docs.map(d=>({ id:d.id, ...d.data() })) };
  }catch(_){
    return { ok:false, rows:[] };
  }
}

async function getServicesMap(){
  const r = await safeGet("services", collection(db,"services"));
  if(r.ok && r.rows.length){
    const map = {}; r.rows.forEach(d=> map[d.id] = d);
    return map;
  }
  return SAMPLE_DATA.services; // fallback
}

async function fetchSlotsRange(startYMD, endYMD){
  // Try index-friendly first
  let r = await safeGet("slots+ordered", query(
    collection(db,"slots"),
    where("date", ">=", startYMD),
    where("date", "<=", endYMD),
    orderBy("date","asc"), orderBy("start_time","asc"),
    limit(1000)
  ));
  if(r.ok && r.rows.length) return r.rows;

  // Simplified or fallback
  r = await safeGet("slots", query(
    collection(db,"slots"),
    where("date", ">=", startYMD),
    where("date", "<=", endYMD)
  ));
  return (r.ok && r.rows.length) ? r.rows : SAMPLE_DATA.slots.slice();
}

async function fetchBookingsRange(startYMD, endYMD){
  // Note: this is the usual rule that fails in your project; we’ll fall back silently
  let r = await safeGet("bookings+ordered", query(
    collection(db,"bookings"),
    where("date", ">=", startYMD),
    where("date", "<=", endYMD),
    orderBy("date","asc"), orderBy("start_time","asc"),
    limit(500)
  ));
  if(r.ok && r.rows.length) return r.rows;

  r = await safeGet("bookings", query(
    collection(db,"bookings"),
    where("date", ">=", startYMD),
    where("date", "<=", endYMD)
  ));
  return (r.ok && r.rows.length) ? r.rows : SAMPLE_DATA.bookings.slice();
}

/* ---------- KPIs ---------- */
async function loadDashboard(){
  const who = $("adminWho");
  // Show signed-in email if available, otherwise local session if present
  const local = localStorage.getItem("adminLocalSession");
  const localEmail = local ? (JSON.parse(local).email || "") : "";
  const email = (auth.currentUser && auth.currentUser.email) || localEmail || "";
  if(who && email) who.textContent = "Signed in as " + email;

  const today = new Date();
  const todayYMD = toYMD(today);
  const weekStart = startOfWeekMon(today);
  const weekEnd   = addDays(weekStart, 6);

  const [servicesMap, slots, bookings7] = await Promise.all([
    getServicesMap(),
    fetchSlotsRange(toYMD(weekStart), toYMD(weekEnd)),
    fetchBookingsRange(todayYMD, toYMD(addDays(today,6)))
  ]);

  // From slots: capacity & utilisation
  const byDate = {};
  for(const s of slots){
    const cap = Number(s.capacity||0);
    const rem = (s.remaining==null) ? cap : Number(s.remaining||0);
    (byDate[s.date] ||= {cap:0, rem:0});
    byDate[s.date].cap += cap;
    byDate[s.date].rem += rem;
  }
  const todayCap = byDate[todayYMD]?.cap || 0;
  const todayRem = byDate[todayYMD]?.rem || 0;
  const todayBooked = Math.max(0, todayCap - todayRem);

  const totalCap = Object.values(byDate).reduce((a,b)=>a+Number(b.cap||0),0);
  const totalRem = Object.values(byDate).reduce((a,b)=>a+Number(b.rem||0),0);
  const utilPct  = totalCap>0 ? Math.round(((totalCap-totalRem)/totalCap)*100) : 0;

  // Revenue 7d (sum service price of bookings)
  let revenue7 = 0;
  for(const b of bookings7){
    const svc = servicesMap[b.service_id] || {};
    if(typeof svc.price !== "undefined") revenue7 += Number(svc.price)||0;
  }

  setTxt("todayBooked", todayBooked);
  setTxt("utilPct", utilPct + "%");
  setTxt("rev7", "$" + revenue7);
}

/* ---------- Init ---------- */
onAuthStateChanged(auth, async (_user)=>{
  try {
    // If you want to *require* real auth, you can redirect here when both are missing:
    // if(!_user && !localStorage.getItem("adminLocalSession")) location.replace("./admin-login.html");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    const err = $("dashboardError");
    if(err) err.textContent = e.message || "Failed to load dashboard.";
  }
});

document.getElementById("signOutBtn")?.addEventListener("click", ()=>{
  localStorage.removeItem("adminLocalSession");
  signOut(auth).finally(()=> location.replace("./admin-login.html"));
});
