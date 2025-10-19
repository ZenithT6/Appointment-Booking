import { firebaseConfig } from './firebase.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const grid = document.getElementById('svcPreview');

function card(s){
  const price = (s.price_aud ?? 0).toString();
  const duration = s.duration_min ?? 30;
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">${s.name}</h3>
        <span class="badge">$${price}</span>
      </div>
      <p class="small" style="margin:8px 0 12px">${duration} minutes</p>
      <div class="row" style="justify-content:flex-end">
        <a href="./booking.html?serviceId=${s.id}">
          <button>Book now</button>
        </a>
      </div>
    </div>
  `;
}

(async function loadPreview(){
  try{
    const snap = await getDocs(collection(db,'services'));
    const items = [];
    snap.forEach(d => items.push({ id:d.id, ...d.data() }));
    const active = items.filter(x => x.active !== false);
    // Pick top 3 (or fewer if not enough added yet)
    const top = active.slice(0,3);
    grid.innerHTML = top.length
      ? top.map(card).join('')
      : `<div class="small" style="color:var(--muted)">No services yet. Add some in the Admin page.</div>`;
  }catch(err){
    grid.innerHTML = `<div class="small" style="color:var(--muted)">Error loading services: ${err.message}</div>`;
    console.error(err);
  }
})();
