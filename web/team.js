
"use strict";
import { firebaseConfig } from "./firebase.js";
import { ensure, renderStepper, renderSummary, selections, buildQS } from "./utils.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ---- Boot
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---- DOM
const grid = document.getElementById("teamGrid");
const svcBox = document.getElementById("svcInfo");

// ---- Params + guards
const sel = selections();
const serviceId = sel.serviceId;
ensure("serviceId", "./services.html");

// ---- Helpers
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

async function loadService() {
  try {
    const snap = await getDoc(doc(db, "services", serviceId));
    if (!snap.exists()) return;

    const s = snap.data() || {};
    // Stepper + Summary
    renderStepper({ mountId: "stepper", step: "team" });
    renderSummary({ mountId: "summary", serviceName: s.name || "Service" });
    document.getElementById("changeLink")?.addEventListener("click", () => {
      location.href = "./services.html";
    });
  } catch (e) {
    console.error("[team] loadService error:", e);
  }
}

async function loadStylists() {
  try {
    const qStylists = query(collection(db, "stylists"), where("active", "==", true));
    const snap = await getDocs(qStylists);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!list.length) {
      grid.innerHTML = `<div class="card"><span class="muted">No team members found.</span></div>`;
      return;
    }

    grid.innerHTML = "";
    list.forEach((m) => {
      const div = document.createElement("div");
      div.className = "card";
      const name = m.full_name || "Team member";
      const role = m.specialty || "Stylist";
      const photo = m.photo || "./assets/hero1.jpg"; 

      const qs = buildQS({ serviceId, stylistId: m.id });
      div.innerHTML = `
        <div class="tm">
          <img src="${esc(photo)}" alt="${esc(name)}">
          <div>
            <h3 style="margin:0;">${esc(name)}</h3>
            <small>${esc(role)}</small>
            <div class="actions">
              <a class="btn" href="./time.html?${qs}">Select</a>
              <a class="btn btn-outline" href="./availability.html?${qs}">Availability</a>
            </div>
          </div>
        </div>`;
      grid.appendChild(div);
    });
  } catch (e) {
    console.error("[team] loadStylists error:", e);
    grid.innerHTML = `<div class="card"><span class="muted">Failed to load team. Please refresh.</span></div>`;
  }
}

// ---- Init
await loadService();
await loadStylists();
