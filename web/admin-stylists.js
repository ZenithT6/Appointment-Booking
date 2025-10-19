"use strict";

import { firebaseConfig } from "./firebase.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function isAdmin(uid){ return uid ? getDoc(doc(db,"admins",uid)).then(s=>s.exists()) : Promise.resolve(false); }

let el = {};
function qs(id){ return document.getElementById(id); }
function escapeHtml(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

onAuthStateChanged(auth, async (user)=>{
  if(!(await isAdmin(user && user.uid))){ location.replace("./admin-login.html"); return; }
  qs("signOutBtn")?.addEventListener("click", ()=>signOut(auth).then(()=>location.replace("./admin-login.html")));

  el = {
    stName: qs("stName"),
    stSpecialty: qs("stSpecialty"),
    stPhoto: qs("stPhoto"),
    stActive: qs("stActive"),
    addBtn: qs("addStylistBtn"),
    status: qs("stStatus"),
    tbody: qs("stylistsBody")
  };

  el.addBtn.addEventListener("click", addStylist);
  await refresh();
});

async function refresh(){
  el.tbody.innerHTML = "";
  const s = await getDocs(query(collection(db,"stylists"), orderBy("full_name")));
  s.docs.forEach(d=>{
    const v = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>"+escapeHtml(v.full_name||"")+"</td>"+
      "<td>"+escapeHtml(v.specialty||"")+"</td>"+
      "<td>"+(v.photo?("<a href=\""+escapeHtml(v.photo)+"\" target=\"_blank\">open</a>"):"")+"</td>"+
      "<td><input type=\"checkbox\" data-id=\""+d.id+"\" class=\"st-active\" "+(v.active===false?"":"checked")+" /></td>"+
      "<td>"+
        "<button class=\"btn secondary st-edit\" data-id=\""+d.id+"\">Edit</button> "+
        "<button class=\"btn st-del\" data-id=\""+d.id+"\" style=\"background:#ffe4e6;color:#b00020\">Delete</button>"+
      "</td>";
    el.tbody.appendChild(tr);
  });

  el.tbody.querySelectorAll(".st-active").forEach(chk=>{
    chk.addEventListener("change", async (e)=>{
      const id = e.target.getAttribute("data-id");
      await updateDoc(doc(db,"stylists",id), { active: e.target.checked });
    });
  });
  el.tbody.querySelectorAll(".st-del").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const id = e.target.getAttribute("data-id");
      if(!confirm("Delete this stylist?")) return;
      await deleteDoc(doc(db,"stylists",id));
      await refresh();
    });
  });
  el.tbody.querySelectorAll(".st-edit").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const id = e.target.getAttribute("data-id");
      // simple prompts for quick edit
      const snap = await getDocs(query(collection(db,"stylists")));
      const row = Array.from(snap.docs).find(x=>x.id===id);
      if(!row) return;
      const v = row.data();
      const name = prompt("Full name:", v.full_name||""); if(name==null) return;
      const spec = prompt("Specialty:", v.specialty||""); if(spec==null) return;
      const photo = prompt("Photo URL:", v.photo||""); if(photo==null) return;
      await updateDoc(doc(db,"stylists",id), { full_name:name, specialty:spec, photo:photo });
      await refresh();
    });
  });
}

async function addStylist(){
  const name = el.stName.value.trim();
  if(!name){ el.status.textContent = "Enter a name"; return; }
  const data = {
    full_name: name,
    specialty: el.stSpecialty.value.trim() || "",
    photo: el.stPhoto.value.trim() || "",
    active: !!el.stActive.checked
  };
  try{
    await addDoc(collection(db,"stylists"), data);
    el.status.textContent = "Added";
    el.stName.value=""; el.stSpecialty.value=""; el.stPhoto.value=""; el.stActive.checked=true;
    await refresh();
  }catch(e){
    console.error(e);
    el.status.textContent = "Failed to add";
  }
}
