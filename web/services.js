// services.js — Services list with search, chips, sort, and modal (no hover popover)
/* eslint-disable no-console */
"use strict";

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

/* ---------------------------
   Firebase (reuse existing)
--------------------------- */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ---------------------------
   Helpers
--------------------------- */
const $ = (sel) => document.querySelector(sel);
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const first = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return v; return null; };
// "45", "45 mins", "$45.00" -> Number | null  (0 stays 0)
function toNumber(value) {
  if (value === 0) return 0;
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------
   Icons
--------------------------- */
function renderIcon(icon) {
  if (typeof icon === "string" && /[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]/u.test(icon)) {
    return `<span aria-hidden="true" style="font-size:28px">${icon}</span>`;
  }
  const svg = {
    scissors:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5l7 7"/><path d="M8.5 15.5l7-7"/><path d="M13 13l7 7"/></svg>`,
    wash:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18"/><path d="M5 6h14l1 4H4l1-4z"/><path d="M7 10v7a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-7"/></svg>`,
    sparkle:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M20 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></svg>`
  }[String(icon || "").toLowerCase()];
  return svg || `<span aria-hidden="true" style="font-size:28px">✨</span>`;
}

/* ---------------------------
   DOM
--------------------------- */
const grid          = $("#allServicesGrid");
const empty         = $("#svcEmpty");
const categoriesEl  = $("#svcCategories");
const searchInput   = $("#svcSearch");
const sortSelect    = $("#svcSort");

// Modal
const modal       = $("#serviceModal");
const svcIcon     = $("#svcIcon");
const svcTitle    = $("#svcTitle");
const svcMeta     = $("#svcMeta");
const svcDesc     = $("#svcDesc");
const svcBook     = $("#svcBook");
const svcClose    = $("#svcClose");
const svcBackdrop = $("#svcBackdrop");

/* ---------------------------
   State
--------------------------- */
let all = [];
let activeCat = "all";
let qText = "";
let sortKey = "popular";

/* ---------------------------
   Firestore subscription
--------------------------- */
onSnapshot(
  query(collection(db, "services"), where("active", "==", true)),
  (snap) => {
    all = [];
    snap.forEach((d) => all.push({ id: d.id, ...d.data() }));

    all.forEach((s) => {
      s.name        = s.name || "Service";
      s.description = s.description || "";
      s.category    = first(s.category, s.type, s.group) || "Other";
      s.icon        = s.icon || "sparkle";
      s.popular     = !!s.popular;

      // duration
      const durRaw = first(
        s.duration, s.Duration,
        s.durationMin, s.duration_min, s.duration_mins, s.durationMinutes, s["duration (min)"],
        s.minutes, s.mins, s.time, s.length,
        s?.meta?.duration, s?.meta?.minutes
      );
      s.duration = toNumber(durRaw);

      // price
      const priceRaw = first(
        s.price, s.Price,
        s.start_price, s.startPrice, s.price_from, s.priceFrom, s.from,
        s.cost, s.amount, s.rate, s.price_aud, s.pricing,
        s?.meta?.price, s?.meta?.amount
      );
      s.price = toNumber(priceRaw);
    });

    renderCategoryChips();
    render();
  },
  (err) => {
    console.error("Services load failed:", err);
    if (grid) grid.innerHTML = `<div class="small muted">Error loading services: ${err.message}</div>`;
  }
);

/* ---------------------------
   Rendering
--------------------------- */
function renderCategoryChips() {
  if (!categoriesEl) return;
  const cats = Array.from(new Set(all.map((s) => s.category))).sort((a, b) => a.localeCompare(b));
  const chips = [
    `<button class="chip ${activeCat === "all" ? "active" : ""}" data-cat="all" role="tab">All</button>`
  ].concat(
    cats.map((c) => `<button class="chip ${activeCat === c ? "active" : ""}" data-cat="${c}" role="tab">${c}</button>`)
  );
  categoriesEl.innerHTML = chips.join("");
}

function render() {
  if (!grid) return;

  const q = qText.trim().toLowerCase();
  let list = all.filter(
    (s) =>
      (activeCat === "all" || s.category === activeCat) &&
      (q === "" || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  );

  switch (sortKey) {
    case "priceAsc":  list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); break;
    case "priceDesc": list.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)); break;
    case "nameAsc":   list.sort((a, b) => (a.name || "").localeCompare(b.name || "")); break;
    default:
      list.sort((a, b) =>
        Number(b.popular || 0) - Number(a.popular || 0) ||
        (a.name || "").localeCompare(b.name || "")
      );
  }

  if (!list.length) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  grid.innerHTML = list.map((s) => `
    <article class="service-card" data-id="${s.id}" tabindex="0" role="button" aria-label="${s.name}">
      <div class="service-icon">${renderIcon(s.icon)}</div>
      <div class="service-name">${s.name}</div>
      ${s.description ? `<div class="service-desc">${s.description}</div>` : ``}
      <div class="service-meta-row">
        ${s.duration !== null ? `<span class="pill">⏱ ${s.duration} mins</span>` : ``}
        ${s.price    !== null ? `<span class="price-chip">$${s.price.toFixed(0)}</span>` : ``}
        <a class="select-btn" href="./team.html?serviceId=${encodeURIComponent(s.id)}" aria-label="Select ${s.name}">Select</a>
      </div>
    </article>
  `).join("");
}

/* ---------------------------
   Interactions
--------------------------- */
categoriesEl?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip[data-cat]");
  if (!btn) return;
  activeCat = btn.dataset.cat;
  renderCategoryChips();
  render();
});

searchInput?.addEventListener("input", debounce(() => {
  qText = searchInput.value || "";
  render();
}, 180));

sortSelect?.addEventListener("change", () => {
  sortKey = sortSelect.value || "popular";
  render();
});

// Keep the modal on card click (arrow replaced by "Select" goes to booking)
grid?.addEventListener("click", onOpenCard);
grid?.addEventListener("keydown", (e) => { if (e.key === "Enter") onOpenCard(e); });
function onOpenCard(e) {
  if (e.target.closest(".select-btn")) return;         // let "Select" navigate
  const card = e.target.closest(".service-card"); if (!card) return;
  const s = all.find((x) => x.id === card.dataset.id); if (!s) return;
  openServiceModal(s);
}

/* ---------------------------
   Modal
--------------------------- */
function openServiceModal(s) {
  if (!modal) return;
  svcIcon.innerHTML      = renderIcon(s.icon);
  svcTitle.textContent   = s.name;
  const parts = [];
  if (s.duration !== null) parts.push(`${s.duration} mins`);
  if (s.price    !== null) parts.push(`$${s.price.toFixed(0)}`);
  if (s.category)         parts.push(s.category);
  svcMeta.textContent     = parts.join(" • ");
  svcDesc.textContent     = s.description || "";
  svcBook.href = `./team.html?serviceId=${encodeURIComponent(s.id)}`;
  modal.classList.add("open");
}
function closeServiceModal(){ modal?.classList.remove("open"); }
svcClose?.addEventListener("click", closeServiceModal);
svcBackdrop?.addEventListener("click", closeServiceModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeServiceModal(); });

// Footer year
document.getElementById("year")?.appendChild(document.createTextNode(new Date().getFullYear()));
