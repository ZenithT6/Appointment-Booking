// web/utils.js

/** URL helpers */
export function qp() {
  return new URLSearchParams(location.search);
}

export function buildQS(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") p.set(k, v);
  });
  return p.toString();
}

/** Guard: if a required query param is missing, bounce to a safer page */
export function ensure(param, redirect) {
  if (!qp().get(param)) location.replace(redirect);
}

/** Current selections pulled from query params (service, team, date, slot) */
export function selections() {
  const q = qp();
  return {
    serviceId: q.get("serviceId") || "",
    stylistId: q.get("stylistId") || "",
    date: q.get("date") || q.get("fromDate") || "",
    slotId: q.get("slotId") || "",
  };
}

/** Small HTML escape */
function eh(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

/**
 * Stepper renderer
 * New flow: Service → Team → Time → Account → Details
 */
export function renderStepper({ mountId, step, allowLinks = true }) {
  const m = document.getElementById(mountId);
  if (!m) return;

  const sel = selections();
  const steps = [
    { key: "service", label: "Service", href: `./services.html` },
    { key: "team",    label: "Team",    href: `./team.html?` + buildQS({ serviceId: sel.serviceId }) },
    { key: "time",    label: "Time",    href: `./time.html?` + buildQS({ serviceId: sel.serviceId, stylistId: sel.stylistId, date: sel.date }) },
    { key: "account", label: "Account", href: `./login.html?`+ buildQS({ serviceId: sel.serviceId, stylistId: sel.stylistId, fromDate: sel.date, slotId: sel.slotId }) },
    { key: "details", label: "Details", href: `./booking.html?`+ buildQS({ serviceId: sel.serviceId, stylistId: sel.stylistId, fromDate: sel.date, slotId: sel.slotId }) },
  ];

  const activeIndex = Math.max(0, steps.findIndex((s) => s.key === step));

  m.innerHTML = `
    <nav class="stepper">
      ${steps
        .map((s, i) => {
          const active = s.key === step ? 'data-active="1"' : "";
          const done = i < activeIndex ? 'data-done="1"' : "";
          const item =
            allowLinks && s.key !== step
              ? `<a href="${s.href}" class="step" ${active} ${done}><span>${i + 1}</span>${s.label}</a>`
              : `<span class="step" ${active} ${done}><span>${i + 1}</span>${s.label}</span>`;
          return item;
        })
        .join("")}
    </nav>
  `;
}

/** Compact summary pill row like: Service • Stylist • 2025-10-07 • 1:30 PM */
export function renderSummary({ mountId, serviceName, stylistName, dateLabel, timeLabel }) {
  const el = document.getElementById(mountId);
  if (!el) return;

  const pills = [];
  if (serviceName) pills.push(`<b>${eh(serviceName)}</b>`);
  if (stylistName) pills.push(`<b>${eh(stylistName)}</b>`);
  if (dateLabel)   pills.push(`${eh(dateLabel)}${timeLabel ? " • " + eh(timeLabel) : ""}`);

  el.innerHTML = `
    <div class="summarybar">
      ${pills.join(" • ")}
      ${pills.length ? '<a id="changeLink" class="change-link">Change</a>' : ""}
    </div>
  `;
}
