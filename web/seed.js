
export async function seedMinimalData(db){
  const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js');
  // Basic services
  const services = [
    { name:'Cut & Style', duration_min:30, price_aud:49, active:true },
    { name:'Color + Style', duration_min:60, price_aud:99, active:true },
    { name:'Kids Cut', duration_min:20, price_aud:29, active:true }
  ];
  for(const s of services){ await addDoc(collection(db,'services'), {...s, created_at:new Date().toISOString()}); }
  // Stylists
  const stylists = [
    { full_name:'Alex Morgan', specialty:'Cuts', active:true },
    { full_name:'Priya Sharma', specialty:'Color', active:true },
    { full_name:'Jason Lee', specialty:'Styling', active:true }
  ];
  for(const s of stylists){ await addDoc(collection(db,'stylists'), {...s, created_at:new Date().toISOString()}); }
  console.log('Seeded minimal services & stylists.');
}
