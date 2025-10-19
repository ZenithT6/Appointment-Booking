// availability.js — ASCII-safe, index-safe, auto-jump to next week with slots

"use strict";

/* =========================
   Firebase (v10 modular)
   ========================= */
import { firebaseConfig } from "./firebase.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

var app;
try {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
} catch (e) {
  app = initializeApp(firebaseConfig);
}
var db = getFirestore(app);

/* =========================
   Collections
   ========================= */
var STYLISTS_COL = "stylists";
var SLOTS_COL = "slots";

/* =========================
   Date helpers (LOCAL)
   ========================= */
var MS_PER_DAY = 24 * 60 * 60 * 1000;

function toLocalYMD(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}
function fromYMDLocal(s) {
  var parts = (s || "").split("-").map(Number);
  if (!parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}
function startOfWeekLocal(d, weekStartsOn /* 0..6 */) {
  if (typeof weekStartsOn !== "number") weekStartsOn = 1; // Monday
  var k = d.getDay(); // 0..6
  var diff = (k - weekStartsOn + 7) % 7;
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function weekdayShort(d) {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
function formatWeekLabel(weekStart) {
  var weekEnd = addDays(weekStart, 6);
  var a = weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  var b = weekEnd.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return a + " - " + b;
}

/* =========================
   Query-string helpers
   ========================= */
function getQueryParams() {
  var url = new URL(location.href);
  return {
    stylistId: url.searchParams.get("stylistId") || "",
    week: url.searchParams.get("week") || ""
  };
}
function setQueryParams(params) {
  var url = new URL(location.href);
  if (params.stylistId) url.searchParams.set("stylistId", params.stylistId);
  else url.searchParams.delete("stylistId");
  if (params.weekStartYMD) url.searchParams.set("week", params.weekStartYMD);
  else url.searchParams.delete("week");
  try { history.replaceState(null, "", url.toString()); } catch (e) {}
}

/* =========================
   State
   ========================= */
var state = {
  stylists: [],
  selectedStylistId: "",
  weekStart: null,
  activeDayIndex: 0,
  slotsByDate: {} // { "YYYY-MM-DD": [slot, ...] }
};

/* =========================
   Fetchers (with safe fallback)
   ========================= */
async function fetchStylists() {
  try {
    var qStylists = query(collection(db, STYLISTS_COL), where("active", "==", true));
    var snap = await getDocs(qStylists);
    return snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
  } catch (e) {
    console.error("Stylists load failed:", e);
    return [];
  }
}

/* Tries filtered query first (date+active+[stylist]), then falls back to date-only query and filters in memory. */
async function fetchSlotsForWeek(weekStart, stylistId) {
  if (!stylistId) stylistId = "";
  var startYMD = toLocalYMD(weekStart);
  var endYMD = toLocalYMD(addDays(weekStart, 6));
  var base = [ where("date", ">=", startYMD), where("date", "<=", endYMD) ];

  // Attempt optimized query (may require composite index)
  try {
    var constraints = base.slice();
    constraints.push(where("active", "==", true));
    if (stylistId) constraints.push(where("stylist_id", "==", stylistId));
    var q1 = query(collection(db, SLOTS_COL), ...constraints);
    var s1 = await getDocs(q1);
    var rows1 = s1.docs.map(function(d){ return { id: d.id, ...d.data() }; });
    rows1.sort(function(a,b){
      if ((a.date || "") !== (b.date || "")) return (a.date || "") < (b.date || "") ? -1 : 1;
      return (a.start_time || "") < (b.start_time || "") ? -1 : 1;
    });
    return rows1;
  } catch (e) {
    console.warn("Composite index missing? Falling back to date-only query.", e);
  }

  // Fallback: date-only then filter
  try {
    var q2 = query(collection(db, SLOTS_COL), ...base);
    var s2 = await getDocs(q2);
    var rows2 = s2.docs.map(function(d){ return { id: d.id, ...d.data() }; });
    rows2 = rows2.filter(function(s){
      return s.active === true && (!stylistId || s.stylist_id === stylistId);
    });
    rows2.sort(function(a,b){
      if ((a.date || "") !== (b.date || "")) return (a.date || "") < (b.date || "") ? -1 : 1;
      return (a.start_time || "") < (b.start_time || "") ? -1 : 1;
    });
    return rows2;
  } catch (e2) {
    console.error("Slots load failed (fallback):", e2);
    return [];
  }
}

/* =========================
   Grouping
   ========================= */
function groupSlotsByDate(slots) {
  var map = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    var key = s.date || "";
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(s);
  }
  var k;
  for (k in map) {
    map[k].sort(function(a,b){ return String(a.start_time || "").localeCompare(String(b.start_time || "")); });
  }
  return map;
}

/* =========================
   Rendering helpers
   ========================= */
function escapeHtml(str) {
  var s = String(str == null ? "" : str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function buildBookingHref(slot) {
  var params = new URLSearchParams();
  if (slot.id) params.set("slotId", slot.id);
  if (slot.stylist_id) params.set("stylistId", slot.stylist_id);
  if (slot.service_id) params.set("serviceId", slot.service_id);
  params.set("fromWeek", toLocalYMD(state.weekStart));
  return "./booking.html?" + params.toString();
}
function clampActiveDayIndex(today, weekStart) {
  var startMs = weekStart.getTime();
  var endMs = addDays(weekStart, 6).getTime();
  var t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startMs && t <= endMs) return Math.floor((t - startMs) / MS_PER_DAY);
  return 0;
}
function smoothScrollTo(node) {
  if (!node) return;
  try { node.scrollIntoView({ behavior: "smooth", block: "start" }); }
  catch (e) { node.scrollIntoView(); }
}

/* =========================
   DOM + Events
   ========================= */
document.addEventListener("DOMContentLoaded", async function() {
  var teamStrip = document.getElementById("teamStrip");
  var selectedStylistPill = document.getElementById("selectedStylistPill");
  var selectedStylistName = document.getElementById("selectedStylistName");
  var stySelect = document.getElementById("stySelect");

  var prevWeekBtn = document.getElementById("prevWeek");
  var nextWeekBtn = document.getElementById("nextWeek");
  var todayBtn = document.getElementById("todayBtn");

  var weekLabel = document.getElementById("weekLabel");
  var weekStrip = document.getElementById("weekStrip");
  var results = document.getElementById("results");

  if (!weekLabel || !weekStrip || !results || !stySelect) {
    console.error("availability.js: Missing required DOM nodes. Check IDs in availability.html");
    return;
  }

  // Load stylists
  state.stylists = await fetchStylists();

  var qp = getQueryParams();
  var today = new Date();
  var defaultWeekStart = startOfWeekLocal(today, 1);

  state.selectedStylistId = qp.stylistId || "";
  state.weekStart = (qp.week && fromYMDLocal(qp.week)) ? startOfWeekLocal(fromYMDLocal(qp.week), 1) : defaultWeekStart;
  state.activeDayIndex = clampActiveDayIndex(today, state.weekStart);

  renderTeamStrip(teamStrip, stySelect, results);
  renderStylistSelect(stySelect);

  if (state.selectedStylistId) {
    stySelect.value = state.selectedStylistId;
    showSelectedStylistPill(selectedStylistPill, selectedStylistName);
  } else {
    hideSelectedStylistPill(selectedStylistPill, selectedStylistName);
  }

  if (prevWeekBtn) prevWeekBtn.addEventListener("click", async function() {
    state.weekStart = addDays(state.weekStart, -7);
    state.activeDayIndex = 0;
    await buildAndRender(weekLabel, weekStrip, results);
    smoothScrollTo(results);
  });
  if (nextWeekBtn) nextWeekBtn.addEventListener("click", async function() {
    state.weekStart = addDays(state.weekStart, 7);
    state.activeDayIndex = 0;
    await buildAndRender(weekLabel, weekStrip, results);
    smoothScrollTo(results);
  });
  if (todayBtn) todayBtn.addEventListener("click", async function() {
    var t = new Date();
    state.weekStart = startOfWeekLocal(t, 1);
    state.activeDayIndex = clampActiveDayIndex(t, state.weekStart);
    await buildAndRender(weekLabel, weekStrip, results);
    smoothScrollTo(results);
  });

  stySelect.addEventListener("change", async function(e) {
    state.selectedStylistId = e.target.value || "";
    if (state.selectedStylistId) showSelectedStylistPill(selectedStylistPill, selectedStylistName);
    else hideSelectedStylistPill(selectedStylistPill, selectedStylistName);
    await buildAndRender(weekLabel, weekStrip, results);
    if (!Object.keys(state.slotsByDate).length) {
      await jumpToNextWeekWithSlots(weekLabel, weekStrip, results, 8);
    }
  });

  // Initial render and auto-jump if empty
  await buildAndRender(weekLabel, weekStrip, results);
  if (!Object.keys(state.slotsByDate).length) {
    await jumpToNextWeekWithSlots(weekLabel, weekStrip, results, 8);
  }

  /* ===== Inner helpers that need DOM ===== */
  function renderTeamStrip(container, selectEl, resultsEl) {
    if (!container) return;
    container.innerHTML = "";
    if (!state.stylists.length) {
      container.innerHTML = "<div class=\"empty\">No team members found.</div>";
      return;
    }
    state.stylists.forEach(function(m) {
      var card = document.createElement("div");
      card.className = "team-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.innerHTML =
        "<img class=\"team-photo\" src=\"" + (m.photo || "") + "\" alt=\"" + escapeHtml(m.full_name || "Team member") + "\" />" +
        "<div class=\"team-meta\">" +
          "<div class=\"team-name\">" + escapeHtml(m.full_name || "") + "</div>" +
          "<div class=\"team-role\">" + escapeHtml(m.specialty || "") + "</div>" +
        "</div>";
      var pick = async function() {
        state.selectedStylistId = m.id;
        if (selectEl) selectEl.value = m.id;
        showSelectedStylistPill(selectedStylistPill, selectedStylistName);
        await buildAndRender(weekLabel, weekStrip, resultsEl);
        if (!Object.keys(state.slotsByDate).length) {
          await jumpToNextWeekWithSlots(weekLabel, weekStrip, resultsEl, 8);
        }
        smoothScrollTo(resultsEl);
      };
      card.addEventListener("click", function(){ pick(); });
      card.addEventListener("keypress", function(ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); }
      });
      container.appendChild(card);
    });
  }

  function renderStylistSelect(selectEl) {
    if (!selectEl) return;
    var keepFirst = selectEl.querySelector("option:not([data-dyn])");
    selectEl.innerHTML = "";
    if (keepFirst) selectEl.appendChild(keepFirst);
    state.stylists.forEach(function(m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.full_name || "(Unnamed)";
      opt.setAttribute("data-dyn", "1");
      selectEl.appendChild(opt);
    });
  }

  function showSelectedStylistPill(pill, nameNode) {
    var found = state.stylists.find(function(s){ return s.id === state.selectedStylistId; });
    if (nameNode) nameNode.textContent = found && found.full_name ? found.full_name : "";
    if (pill) pill.hidden = !state.selectedStylistId;
  }
  function hideSelectedStylistPill(pill, nameNode) {
    if (nameNode) nameNode.textContent = "";
    if (pill) pill.hidden = true;
  }

  function renderWeekStrip(weekStripEl) {
    if (!weekStripEl) return;
    weekStripEl.innerHTML = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(state.weekStart, i);
      var ymd = toLocalYMD(d);
      var btn = document.createElement("button");
      btn.className = "week-day-btn";
      if (i === state.activeDayIndex) btn.setAttribute("aria-current", "date");
      btn.type = "button";
      btn.innerHTML =
        "<div style=\"font-weight:600\">" + weekdayShort(d) + "</div>" +
        "<div>" + d.getDate() + "</div>";
      btn.addEventListener("click", function(iCopy, ymdCopy, selfBtn) {
        return function() {
          state.activeDayIndex = iCopy;
          var current = weekStripEl.querySelectorAll(".week-day-btn[aria-current='date']");
          for (var k = 0; k < current.length; k++) current[k].removeAttribute("aria-current");
          selfBtn.setAttribute("aria-current", "date");
          var daySection = document.querySelector("[data-day-section=\"" + ymdCopy + "\"]");
          if (daySection) smoothScrollTo(daySection);
        };
      }(i, ymd, btn));
      weekStripEl.appendChild(btn);
    }
  }

  function renderResults(resultsEl) {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";

    for (var i = 0; i < 7; i++) {
      var d = addDays(state.weekStart, i);
      var ymd = toLocalYMD(d);
      var pretty = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

      var dayBox = document.createElement("section");
      dayBox.className = "day-section";
      dayBox.setAttribute("data-day-section", ymd);
      dayBox.innerHTML =
        "<div class=\"day-header\">" +
          "<h3 style=\"margin:0\">" + escapeHtml(pretty) + "</h3>" +
        "</div>" +
        "<div class=\"slot-list\" id=\"slots-" + ymd + "\"></div>";
      resultsEl.appendChild(dayBox);

      var slots = state.slotsByDate[ymd] || [];
      var listEl = document.getElementById("slots-" + ymd);

      if (!slots.length) {
        listEl.innerHTML = "<div class=\"empty\">No slots - Select another day</div>";
        continue;
      }

      for (var j = 0; j < slots.length; j++) {
        var slot = slots[j];
        var isOpen = (slot.isOpen !== false);
        var remaining = Number(slot.remaining == null ? (slot.capacity == null ? 1 : slot.capacity) : slot.remaining);
        var soldOut = (remaining <= 0) || !isOpen;

        var chip = document.createElement("div");
        chip.className = "slot-chip";
        if (soldOut) chip.setAttribute("aria-disabled", "true");

        var startText = slot.start_time ? slot.start_time : "";
        var endText = slot.end_time ? "-" + slot.end_time : "";
        var timeText = (startText + endText) || "Time TBA";

        var label = document.createElement("span");
        label.textContent = timeText;

        var rem = document.createElement("span");
        rem.style.fontSize = "12px";
        rem.style.opacity = "0.8";
        rem.textContent = soldOut ? "Sold out" : (remaining + " left");

        chip.appendChild(label);
        chip.appendChild(rem);

        var book = document.createElement("a");
        book.className = "book-btn";
        book.textContent = "Book now";
        book.href = buildBookingHref(slot);
        if (soldOut) {
          book.setAttribute("aria-disabled", "true");
          book.style.pointerEvents = "none";
          book.style.opacity = "0.6";
        }

        var container = document.createElement("div");
        container.style.display = "inline-flex";
        container.style.gap = "8px";
        container.style.alignItems = "center";
        container.appendChild(chip);
        container.appendChild(book);

        listEl.appendChild(container);
      }
    }
  }

  async function buildAndRender(weekLabelEl, weekStripEl, resultsEl) {
    setQueryParams({ stylistId: state.selectedStylistId || "", weekStartYMD: toLocalYMD(state.weekStart) });
    if (weekLabelEl) weekLabelEl.textContent = formatWeekLabel(state.weekStart);
    renderWeekStrip(weekStripEl);

    var slots = await fetchSlotsForWeek(state.weekStart, state.selectedStylistId);
    state.slotsByDate = groupSlotsByDate(slots);

    renderResults(resultsEl);
  }

  async function jumpToNextWeekWithSlots(weekLabelEl, weekStripEl, resultsEl, maxHops) {
    var hops = Math.max(0, Number(maxHops || 0));
    for (var i = 0; i < hops; i++) {
      var nextStart = addDays(state.weekStart, 7);
      var slots = await fetchSlotsForWeek(nextStart, state.selectedStylistId);
      if (slots.length) {
        state.weekStart = nextStart;
        state.activeDayIndex = 0;
        state.slotsByDate = groupSlotsByDate(slots);
        setQueryParams({ stylistId: state.selectedStylistId || "", weekStartYMD: toLocalYMD(state.weekStart) });
        if (weekLabelEl) weekLabelEl.textContent = formatWeekLabel(state.weekStart);
        renderWeekStrip(weekStripEl);
        renderResults(resultsEl);
        return true;
      }
      state.weekStart = nextStart;
    }
    return false;
  }

  // Expose for debugging if needed
  window.__availabilityState = state;
});
