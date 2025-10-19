// script.js — Homepage interactions + Firestore (icons for services, full-width team)
/* eslint-disable no-console */

/* =========================
   Nav / Mobile Drawer
========================= */
const navBurger = document.getElementById('navBurger');
const mobileDrawer = document.getElementById('mobileDrawer');
const drawerClose = document.getElementById('drawerClose');

navBurger?.addEventListener('click', () => mobileDrawer.classList.add('open'));
drawerClose?.addEventListener('click', () => mobileDrawer.classList.remove('open'));
mobileDrawer?.addEventListener('click', (e) => {
  if (e.target === mobileDrawer) mobileDrawer.classList.remove('open');
});

// Footer year
document.getElementById('year')?.appendChild(document.createTextNode(new Date().getFullYear()));

/* =========================
   Hero Carousel
========================= */
const heroImages = ['./assets/hero1.jpg', './assets/hero2.jpg', './assets/hero3.jpg', './assets/hero4.jpg' ];
let heroIndex = 0;
const heroImgEl = document.querySelector('.hero-img');
const heroPrev = document.getElementById('heroPrev');
const heroNext = document.getElementById('heroNext');
const heroDots = document.getElementById('heroDots');

function renderDots(){
  if (!heroDots) return;
  heroDots.innerHTML = heroImages
    .map((_, i) => `<button aria-label="Go to slide ${i + 1}" data-i="${i}" class="${i === heroIndex ? 'active' : ''}"></button>`)
    .join('');
}
function showHero(i){
  if (!heroImgEl) return;
  heroIndex = (i + heroImages.length) % heroImages.length;
  heroImgEl.src = heroImages[heroIndex];
  renderDots();
}
renderDots();
heroDots?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-i]');
  if (!btn) return;
  showHero(+btn.dataset.i);
});
heroPrev?.addEventListener('click', ()=> showHero(heroIndex - 1));
heroNext?.addEventListener('click', ()=> showHero(heroIndex + 1));
setInterval(()=> showHero(heroIndex + 1), 6000);

/* =========================
   Video Modal
========================= */
const videoModal = document.getElementById('videoModal');
const videoClose = document.getElementById('videoClose');
const modalBackdrop = document.getElementById('modalBackdrop');
const videoEmbed = document.getElementById('videoEmbed');
const watchVideoBtn = document.getElementById('watchVideoBtn');

function openVideo(){
  if (!videoModal) return;
  videoModal.classList.add('open');
  const src = videoEmbed?.getAttribute('data-src');
  if (src && !videoEmbed.querySelector('iframe')){
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    videoEmbed.appendChild(iframe);
  }
}
function closeVideo(){
  videoModal?.classList.remove('open');
  const ifr = videoEmbed?.querySelector('iframe');
  if (ifr) ifr.remove();
}
watchVideoBtn?.addEventListener('click', openVideo);
videoClose?.addEventListener('click', closeVideo);
modalBackdrop?.addEventListener('click', closeVideo);
document.addEventListener('keydown', (e)=> { if (e.key === 'Escape') closeVideo(); });

/* =========================
   Scroll Reveal
========================= */
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      io.unobserve(e.target);
    }
  });
},{ threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* =========================
   Firebase / Firestore
========================= */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
getFirestore,
collection,
getDocs,
addDoc,
serverTimestamp,
onSnapshot,
query,
where,
orderBy,
limit
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { firebaseConfig } from './firebase.js'; // must export firebaseConfig in firebase.js

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* =========================
   Services (icon cards, no photos)
   Firestore collection: services
   Fields per doc:
   - name (string)
   - description (string)
   - icon (string)  // emoji like "💇‍♀️" or named: "scissors" | "wash" | "sparkle"
   - price (number, optional)
   - active (boolean)
========================= */
function renderIcon(icon) {
  // Use emoji directly if provided
  if (typeof icon === 'string' && /[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]/u.test(icon)) {
    return `<span aria-hidden="true">${icon}</span>`;
  }
  // Minimal named SVG set (extend as needed)
  const svg = {
    scissors: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5l7 7"/><path d="M8.5 15.5l7-7"/><path d="M13 13l7 7"/></svg>`,
    wash: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18"/><path d="M5 6h14l1 4H4l1-4z"/><path d="M7 10v7a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-7"/></svg>`,
    sparkle: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M20 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></svg>`
  }[String(icon || '').toLowerCase()];
  return svg || `<span aria-hidden="true">✨</span>`;
}

(async function mountServices(){
  const grid = document.getElementById('servicesGrid');
  if (!grid) return;

  try {
    // Fetch only active services from Firestore
    const snap = await getDocs(
      query(collection(db, 'services'), where('active', '==', true))
    );

    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data(), idDoc: d.id }));

    // Keep only active (defensive) then popular
    const active  = items.filter(s => s.active !== false);
    const popular = active.filter(s => s.popular === true);

    // If you want manual ordering, add an optional numeric "order" field in Admin
    const sortByOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);

    // show up to 3 popular; fallback to first 3 active
    const list = (popular.length ? popular.sort(sortByOrder) : active).slice(0, 3);

    const card = (s) => `
      <article class="service-card"
               tabindex="0"
               onclick="location.href='./services.html#${s.idDoc}'"
               aria-label="${s.name || 'Service'}">
        <div class="service-icon">${renderIcon(s.icon)}</div>
        <div class="service-name">${s.name || 'Service'}</div>
        <div class="service-desc">${s.description || ''}</div>
        <div class="service-meta-row">
          ${s.price ? `<div class="price-chip">$${Number(s.price).toFixed(0)}</div>` : ''}
          <a class="service-cta" href="./team.html" aria-label="Book ${s.name || 'service'}">→</a>
        </div>
      </article>
    `;

    grid.innerHTML = list.length
      ? list.map(card).join('')
      : `<div class="small muted">No popular services yet. Mark a few as <strong>popular</strong> in Admin.</div>`;

  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="small muted">Error loading services: ${err.message}</div>`;
  }
})();

const TEAM_PLACEHOLDER = './assets/avatar-placeholder.jpg';

(function mountTeamFull(){
  const grid = document.getElementById('teamGrid'); if (!grid) return;
  const ctaWrap = document.querySelector('.team-cta-wrap');

  // No orderBy -> no composite index required
  const qStylists = query(
    collection(db, 'stylists'),
    where('active', '==', true),
    limit(12)
  );

  onSnapshot(qStylists, (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));

    // Sort by name on the client so we don't need an index
    list.sort((a,b) => (a.full_name || '').localeCompare(b.full_name || ''));

    if (!list.length) {
      ctaWrap?.classList.add('hidden');
      grid.innerHTML = `<div class="small muted">Add stylists in the <strong>stylists</strong> collection to showcase them here.</div>`;
      return;
    }
    ctaWrap?.classList.remove('hidden');

    grid.innerHTML = list.map(m => {
      const photo = (typeof m.photo === 'string' && m.photo.trim()) ? m.photo : TEAM_PLACEHOLDER;
      return `
        <article class="team-card" aria-label="${m.full_name || 'Stylist'}">
          <div class="team-avatar">
            <img src="${photo}" alt="${m.full_name || 'Stylist'}"
                 onerror="this.onerror=null;this.src='${TEAM_PLACEHOLDER}'" />
          </div>
          <div class="team-name">${m.full_name || 'Team member'}</div>
          <div class="team-role">${m.specialty || 'Stylist'}</div>
          ${m.tag ? `<div class="team-tag">${m.tag}</div>` : ``}
        </article>
      `;
    }).join('');
  }, (err) => {
    console.error(err);
    ctaWrap?.classList.add('hidden');
    grid.innerHTML = `<div class="small muted">Error loading team: ${err.message}</div>`;
  });
})();


/* =========================
   Contact Form → Firestore
   Collection: contacts (write-only by rules)
========================= */
document.getElementById('contactForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const form = e.currentTarget;
  const msgEl = document.getElementById('contactMsg');
  const { name, email, message } = Object.fromEntries(new FormData(form).entries());

  try {
    await addDoc(collection(db, 'contacts'), {
      name: String(name || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      message: String(message || '').trim(),
      status: 'new',
      source: 'website',
      createdAt: serverTimestamp()
    });
    msgEl.textContent = 'Thanks! We’ll get back to you shortly.';
    form.reset();
  } catch (err) {
    console.error('Contact submit failed:', err);
    msgEl.textContent = 'Sorry, something went wrong. Please email us directly.';
  }
});
// ===== Footer helpers =====
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const backToTop = document.getElementById('backToTop');
const toggleBackToTop = () => {
  if (!backToTop) return;
  const threshold = 400;
  if (window.scrollY > threshold) backToTop.classList.add('show');
  else backToTop.classList.remove('show');
};
window.addEventListener('scroll', toggleBackToTop, { passive: true });
toggleBackToTop();

backToTop?.addEventListener('click', (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.querySelectorAll('.mini-action.copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const text = btn.dataset.copy || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = prev), 1200);
    });
  });
});
