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
    svName: qs("svName"),
    svDuration: qs("svDuration"),
    svPrice: qs("svPrice"),
    svActive: qs("svActive"),
    addBtn: qs("addServiceBtn"),
    status: qs("svStatus"),
    tbody: qs("servicesBody")
  };

  el.addBtn.addEventListener("click", addService);
  await refresh();
});

async function refresh(){
  el.tbody.innerHTML = "";
  const s = await getDocs(query(collection(db,"services"), orderBy("name")));
  s.docs.forEach(d=>{
    const v = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>"+escapeHtml(v.name||"")+"</td>"+
      "<td>"+escapeHtml(String(v.duration_min||0))+" min</td>"+
      "<td>"+escapeHtml(String(v.price||0))+"</td>"+
      "<td><input type=\"checkbox\" data-id=\""+d.id+"\" class=\"sv-active\" "+(v.active===false?"":"checked")+" /></td>"+
      "<td>"+
        "<button class=\"btn secondary sv-edit\" data-id=\""+d.id+"\">Edit</button> "+
        "<button class=\"btn sv-del\" data-id=\""+d.id+"\" style=\"background:#ffe4e6;color:#b00020\">Delete</button>"+
      "</td>";
    el.tbody.appendChild(tr);
  });

  el.tbody.querySelectorAll(".sv-active").forEach(chk=>{
    chk.addEventListener("change", async (e)=>{
      const id = e.target.getAttribute("data-id");
      await updateDoc(doc(db,"services",id), { active: e.target.checked });
    });
  });
  el.tbody.querySelectorAll(".sv-del").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const id = e.target.getAttribute("data-id");
      if(!confirm("Delete this service?")) return;
      await deleteDoc(doc(db,"services",id));
      await refresh();
    });
  });
  el.tbody.querySelectorAll(".sv-edit").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const id = e.target.getAttribute("data-id");
      const all = await getDocs(query(collection(db,"services")));
      const row = Array.from(all.docs).find(x=>x.id===id);
      if(!row) return;
      const v = row.data();
      const name = prompt("Name:", v.name||""); if(name==null) return;
      const dur  = prompt("Duration (minutes):", String(v.duration_min||60)); if(dur==null) return;
      const price= prompt("Price:", String(v.price||0)); if(price==null) return;
      await updateDoc(doc(db,"services",id), { name:name, duration_min:Number(dur)||0, price:Number(price)||0 });
      await refresh();
    });
  });
}

async function addService(){
  const name = el.svName.value.trim();
  if(!name){ el.status.textContent = "Enter a name"; return; }
  const data = {
    name: name,
    duration_min: Math.max(0, Math.floor(Number(el.svDuration.value)||0)),
    price: Math.max(0, Number(el.svPrice.value)||0),
    active: !!el.svActive.checked
  };
  try{
    await addDoc(collection(db,"services"), data);
    el.status.textContent = "Added";
    el.svName.value=""; el.svDuration.value="60"; el.svPrice.value="0"; el.svActive.checked=true;
    await refresh();
  }catch(e){
    console.error(e);
    el.status.textContent = "Failed to add";
  }
}
