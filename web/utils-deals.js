// Marks a slot as a "deal" if it starts within windowHours (default 3h) and a service price exists
export function dealFor(slot, svc, now = new Date(), pct = 20, windowHours = 3) {
  const base = Number(svc?.price_aud ?? svc?.price);
  const priceKnown = Number.isFinite(base);
  if (!slot?.date || !slot?.start_time) {
    return { isDeal:false, priceFinal:priceKnown? base : undefined, pct:0 };
  }
  const dt = new Date(`${slot.date}T${slot.start_time}:00`);
  const ms = dt - now;
  const within = ms > 0 && ms <= windowHours * 3600 * 1000;
  if (!within || !priceKnown) return { isDeal:false, priceFinal:priceKnown? base : undefined, pct:0 };
  const priceFinal = Math.round(base * (100 - pct)) / 100;
  return { isDeal:true, priceFinal, pct };
}
