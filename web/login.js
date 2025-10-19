
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup,
  GoogleAuthProvider, FacebookAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import {
  getFirestore, doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

/* ---------- bootstrap ---------- */
const app = getApps().length ? getApp() : initializeApp(window.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (s) => document.querySelector(s);

/* ---------- query-state helpers ---------- */
function getSel() {
  const qs = new URLSearchParams(location.search);
  return {
    serviceId: qs.get('serviceId') || qs.get('service_id') || '',
    stylistId: qs.get('stylistId') || qs.get('stylist_id') || '',
    slotId: qs.get('slotId') || qs.get('slot_id') || '',
    date: qs.get('fromDate') || qs.get('date') || ''
  };
}
function buildQS(obj) {
  const u = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v) u.set(k, v); });
  return u.toString();
}
function redirectToBooking() {
  const sel = getSel();
  const qs = buildQS({
    serviceId: sel.serviceId,
    stylistId: sel.stylistId,
    slotId: sel.slotId,
    fromDate: sel.date
  });
  // go to details page (guest continues there too)
  location.href = `./booking.html?${qs}`;
}

/* ---------- CRM upsert for ANY provider ---------- */
async function upsertCustomerFromAuth(user, providerId) {
  if (!user) return;
  const cid = user.uid; // stable id for authenticated users

  const profile = {
    uid: user.uid,
    authProvider: providerId || (user.providerData?.[0]?.providerId ?? 'password'),
    name: user.displayName || '',
    email: (user.email || '').toLowerCase(),
    phone: user.phoneNumber || '',
    photoURL: user.photoURL || '',
    last_login_at: serverTimestamp(),
  };

  // Set created_at if first time; merge to preserve admin notes/tags later
  await setDoc(doc(db, 'customers', cid), {
    ...profile,
    created_at: serverTimestamp(),
  }, { merge: true });
}

/* ---------- providers ---------- */
async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await upsertCustomerFromAuth(cred.user, provider.providerId);
  redirectToBooking();
}

async function loginWithFacebook() {
  const provider = new FacebookAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await upsertCustomerFromAuth(cred.user, provider.providerId);
  redirectToBooking();
}

// Minimal email/password using prompts (replace with a proper form later if you like)
async function loginWithEmailPassword() {
  const email = prompt('Enter your email:')?.trim();
  if (!email) return;
  const create = confirm('Do you want to create a new account? Press OK to Sign Up, Cancel to Log In.');
  const pass = prompt('Enter your password:');
  if (!pass) return;

  if (create) {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await upsertCustomerFromAuth(cred.user, 'password');
  } else {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await upsertCustomerFromAuth(cred.user, 'password');
  }
  redirectToBooking();
}

/* ---------- auth observer (defensive) ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  // Cheap merge-upsert on refresh
  await upsertCustomerFromAuth(user);
});

/* ---------- wire buttons & enable UI ---------- */
function enableButtons() {
  $('#btnGoogle')?.removeAttribute('disabled');
  $('#btnFacebook')?.removeAttribute('disabled');
  $('#btnEmail')?.removeAttribute('disabled');
  $('#createProfile')?.setAttribute('aria-disabled', 'false');
}
document.addEventListener('DOMContentLoaded', () => {
  enableButtons();
  $('#btnGoogle')?.addEventListener('click', (e) => { e.preventDefault(); loginWithGoogle().catch(console.error); });
  $('#btnFacebook')?.addEventListener('click', (e) => { e.preventDefault(); loginWithFacebook().catch(console.error); });
  $('#btnEmail')?.addEventListener('click', (e) => { e.preventDefault(); loginWithEmailPassword().catch(console.error); });

  // Optional: "Create profile" just opens the email path for now
  $('#createProfile')?.addEventListener('click', (e) => { e.preventDefault(); loginWithEmailPassword().catch(console.error); });
});
