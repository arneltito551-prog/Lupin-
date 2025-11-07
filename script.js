// script.js (ES module)
// Firestore v10+ modular SDK, Cloudinary client uploads, offline persistence, toasts
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-analytics.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

/* =========================
   CONFIG - FIREBASE + CLOUDINARY
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyBdAgts2Imnzdqljgg1G6OrH5f3WVpdrj4",
  authDomain: "crrd-895af.firebaseapp.com",
  projectId: "crrd-895af",
  storageBucket: "crrd-895af.firebasestorage.app",
  messagingSenderId: "997673721711",
  appId: "1:997673721711:web:b4081f22acedf6bf74529a",
  measurementId: "G-1KLVVMPT3X"
};

const cloudName = "dtmm8frik";
const uploadPreset = "Crrd2025";

/* Initialize Firebase */
const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch(e){ /* optional */ }
const db = getFirestore(app);

/* Enable offline persistence (IndexedDB) */
(async function enablePersistence() {
  try {
    await enableIndexedDbPersistence(db);
    console.info("Firestore persistence enabled.");
  } catch (err) {
    console.warn("Persistence not enabled:", err && err.message ? err.message : err);
  }
})();

/* =========================
   Helpers & State
   ========================= */
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const nowISO = () => new Date().toISOString();

const state = {
  items: [],
  currentFilter: 'all',
  filteredId: null
};

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Toasts */
const toastContainer = qs('#toastContainer');
function showToast(message, {type='info', duration=3000} = {}) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div>${escapeHtml(message)}</div>`;
  toastContainer.appendChild(t);
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=> {
    t.classList.remove('show');
    setTimeout(()=> t.remove(), 260);
  }, duration);
}

/* Online status */
function updateOnlineStatus() {
  const el = qs('#onlineStatus');
  if(!el) return;
  if(navigator.onLine) {
    el.textContent = 'Online — changes sync to Firestore automatically.';
    el.style.color = 'var(--success)';
    showToast('Back online — syncing', {type:'info', duration:1200});
  } else {
    el.textContent = 'Offline — changes queued and will sync when online.';
    el.style.color = 'var(--danger)';
    showToast('Offline — changes will sync later', {type:'info', duration:1200});
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

/* Cloudinary upload helper */
async function uploadToCloudinary(file) {
  if(!file) return '';
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", uploadPreset);
  const res = await fetch(url, { method: "POST", body: fd });
  if(!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudinary upload failed: ${text}`);
  }
  const data = await res.json();
  return data.secure_url || '';
}

/* =========================
   Firestore real-time listener
   ========================= */
const requestsCol = collection(db, "materialsRequests");
const requestsQuery = query(requestsCol, orderBy('date','desc'));
onSnapshot(requestsQuery, snapshot => {
  state.items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAll();
}, err => {
  console.error('onSnapshot requests error', err);
  showToast('Failed to sync requests', {type:'error'});
});

/* =========================
   UI wiring & Navigation
   ========================= */
const drawer = qs('#drawer');
qs('#hamburger').addEventListener('click', ()=> drawer.classList.add('open'));
qs('#closeDrawer').addEventListener('click', ()=> drawer.classList.remove('open'));
qsa('.drawer-item').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); drawer.classList.remove('open'); showSection(a.dataset.section); });
});
qsa('.nav-item').forEach(b => b.addEventListener('click', ()=> showSection(b.dataset.section)));
qs('#fab').addEventListener('click', ()=> showSection('submit'));

function showSection(id) {
  state.filteredId = null;
  qsa('.screen').forEach(s => s.classList.remove('active'));
  const el = qs('#' + id); if(el) el.classList.add('active');
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === id));
  if(id === 'view') renderRequests(state.currentFilter);
  if(id === 'delivered') renderDelivered();
  if(id === 'remaining') renderRemaining();
  if(id === 'usage') renderUsage();
  if(id === 'home') updateHomeStats();
  document.querySelector('.content').scrollTop = 0;
}
showSection('home');

/* =========================
   Submit new request
   ========================= */
qs('#requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = qs('#title').value.trim();
  const qty = Number(qs('#quantity').value);
  const unit = qs('#unit').value.trim();
  const requester = qs('#requester').value;
  const description = qs('#description').value.trim();
  const fileInput = qs('#materialImage');

  if(!title || !qty || !unit || !requester) {
    showToast('Please fill required fields', {type:'error'});
    return;
  }

  let imageUrl = '';
  try {
    if(fileInput && fileInput.files && fileInput.files[0]) {
      showToast('Uploading image...', {type:'info', duration:2000});
      imageUrl = await uploadToCloudinary(fileInput.files[0]);
    }
  } catch(err) {
    console.error('Cloudinary error', err);
    showToast('Image upload failed — try again or submit without image', {type:'error'});
    return;
  }

  const item = {
    title,
    unit,
    requestedQty: qty,
    deliveredQty: 0,
    remainingQty: 0,
    usedQty: 0,
    requester,
    description,
    imageUrl: imageUrl || '',
    date: nowISO(),
    status: 'Pending',
    usageHistory: []
  };

  try {
    await addDoc(requestsCol, item);
    qs('#requestForm').reset();
    showToast('Request submitted (saved to Firestore).', {type:'success'});
    showSection('view');
  } catch(err) {
    console.error('addDoc error', err);
    showToast('Failed to submit request', {type:'error'});
  }
});

/* =========================
   Status rules
   ========================= */
function computeStatus(i) {
  const req = i.requestedQty || 0;
  const del = i.deliveredQty || 0;
  if(req === 0) return { text: 'No Request', class:'pending' };
  if(i.status === 'Rejected') return { text:'Rejected', class:'rejected' };
  if(del >= req && req > 0) return { text:'Completed', class:'completed' };
  if(del > 0 && del < req) return { text:'Pending', class:'pending' };
  return { text:'Pending', class:'pending' };
}

/* =========================
   Render Requests
   ========================= */
function renderRequests(filter='all') {
  state.currentFilter = filter;
  const list = qs('#requestsList'); list.innerHTML = '';
  let arr = state.items.slice();

  if(state.filteredId) {
    arr = arr.filter(i => i.id === state.filteredId);
  } else {
    if(filter !== 'all') {
      arr = arr.filter(i => {
        if(filter === 'delivered') return (i.deliveredQty || 0) > 0;
        if(filter === 'completed') return (i.deliveredQty || 0) >= (i.requestedQty || 0) && (i.requestedQty || 0) > 0;
        return (i.status || '').toLowerCase() === filter.toLowerCase();
      });
    }
  }

  if(arr.length === 0) { list.innerHTML = '<p class="muted">No requests found.</p>'; return; }

  arr.forEach(i => {
    const st = computeStatus(i);
    const div = document.createElement('div'); div.className = 'req';
    div.innerHTML = `
      <div class="row">
        <div>
          <h3>${escapeHtml(i.title)} <small style="font-size:12px;color:var(--muted)">(${escapeHtml(i.unit||'')})</small></h3>
          <small>${escapeHtml(i.requester)} • ${new Date(i.date).toLocaleString()}</small>
        </div>
        <div><div class="badge ${st.class}">${st.text}</div></div>
      </div>

      <div><small>Requested: ${i.requestedQty || 0} • Delivered: ${i.deliveredQty || 0} • Remaining: ${i.remainingQty || 0} • Used: ${i.usedQty || 0}</small></div>

      ${i.description ? `<p>${escapeHtml(i.description)}</p>` : ''}
      ${i.imageUrl ? `<div><img src="${escapeHtml(i.imageUrl)}" alt="img" style="max-width:140px;border-radius:8px;margin-top:6px" /></div>` : ''}

      <div class="actions">
        <button class="btn" data-act="open" data-id="${i.id}">Open</button>
        <button class="btn" data-act="deliver" data-id="${i.id}">Deliver</button>
        <button class="btn" data-act="record" data-id="${i.id}">Record Usage</button>
        <button class="btn" data-act="approve" data-id="${i.id}">Approve</button>
        <button class="btn" data-act="reject" data-id="${i.id}">Reject</button>
        <button class="btn" data-act="delete" data-id="${i.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  });
}

/* Actions (requestsList) */
qs('#requestsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const it = state.items.find(x => x.id === id);
  if(!it) return;

  if(act === 'delete') {
    if(!confirm('Delete this request?')) return;
    try { await deleteDoc(doc(db, 'materialsRequests', id)); showToast('Request deleted', {type:'info'}); }
    catch(err){ console.error(err); showToast('Failed to delete', {type:'error'}); }
    return;
  }

  if(act === 'approve') {
    try { await updateDoc(doc(db, 'materialsRequests', id), { status: 'Approved' }); showToast('Approved', {type:'success'}); }
    catch(err){ console.error(err); showToast('Failed', {type:'error'}); }
    return;
  }

  if(act === 'reject') {
    try { await updateDoc(doc(db, 'materialsRequests', id), { status: 'Rejected' }); showToast('Rejected', {type:'info'}); }
    catch(err){ console.error(err); showToast('Failed', {type:'error'}); }
    return;
  }

  if(act === 'open') {
    openEditModal(it);
    return;
  }

  if(act === 'record') {
    const avail = it.remainingQty || 0;
    if(avail <= 0) { showToast('No remaining stock. Use Deliver to add stock.', {type:'info'}); return; }
    const input = prompt(`Record usage for "${it.title}" (available: ${avail})`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const deduct = Math.min(n, avail);
    const newRemaining = Math.max(0, (it.remainingQty || 0) - deduct);
    const newUsed = (it.usedQty || 0) + deduct;
    const newUsageHistory = (it.usageHistory || []).slice();
    newUsageHistory.push({ date: nowISO(), qty: deduct, note: 'Usage recorded' });
    // Keep remaining record even if 0; update status if delivered >= requested or remaining <= 0
    const newStatus = ( (it.deliveredQty || 0) >= (it.requestedQty || 0) && (it.requestedQty || 0) > 0 ) || newRemaining <= 0 ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', id), {
        remainingQty: newRemaining,
        usedQty: newUsed,
        usageHistory: newUsageHistory,
        status: newStatus
      });
      showToast(`Deducted ${deduct} from ${it.title}`, {type:'success'});
    } catch(err) {
      console.error(err); showToast('Failed to record usage', {type:'error'});
    }
    return;
  }

  if(act === 'deliver') {
    const input = prompt(`Enter delivered quantity for "${it.title}" (add only):`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const deliveredNow = n;
    const newDelivered = (it.deliveredQty || 0) + deliveredNow;
    const newRemaining = (it.remainingQty || 0) + deliveredNow;
    const newStatus = (newDelivered >= (it.requestedQty || 0) && (it.requestedQty || 0) > 0) ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', id), {
        deliveredQty: newDelivered,
        remainingQty: newRemaining,
        status: newStatus
      });
      showToast(`Delivered ${deliveredNow} pcs for "${it.title}".`, {type:'success'});
    } catch(err) {
      console.error(err); showToast('Failed to update delivery', {type:'error'});
    }
    return;
  }
});

/* Delivered view */
function renderDelivered() {
  const out = qs('#deliveredList'); out.innerHTML = '';
  const arr = state.items.filter(i => (i.deliveredQty || 0) > 0).sort((a,b) => b.date.localeCompare(a.date));
  if(arr.length === 0) { out.innerHTML = '<p class="muted">No delivered items yet.</p>'; return; }
  arr.forEach(i => {
    const div = document.createElement('div'); div.className = 'req';
    div.innerHTML = `
      <div class="row">
        <div><h3>${escapeHtml(i.title)}</h3><small>${escapeHtml(i.requester)}</small></div>
        <div><div class="badge delivered">Delivered: ${i.deliveredQty || 0}</div></div>
      </div>
      <div><small>Requested: ${i.requestedQty || 0} • Remaining: ${i.remainingQty || 0} • Used: ${i.usedQty || 0} • Unit: ${escapeHtml(i.unit||'')}</small></div>
      ${i.description ? `<p>${escapeHtml(i.description)}</p>` : ''}
      ${i.imageUrl ? `<div><img src="${escapeHtml(i.imageUrl)}" style="max-width:140px;border-radius:8px;margin-top:6px" alt="image" /></div>` : ''}
    `;
    out.appendChild(div);
  });
}

/* Remaining view */
function renderRemaining() {
  const out = qs('#remainingList'); out.innerHTML = '';
  const arr = state.items.filter(i => (i.remainingQty || 0) > 0).sort((a,b) => a.title.localeCompare(b.title));
  if(arr.length === 0) { out.innerHTML = '<p class="muted">No remaining items.</p>'; return; }
  arr.forEach(i => {
    const div = document.createElement('div'); div.className = 'req';
    const st = computeStatus(i);
    div.innerHTML = `
      <div class="row">
        <div><h3>${escapeHtml(i.title)}</h3><small>${escapeHtml(i.requester)}</small></div>
        <div><div class="badge ${st.class}">${st.text}</div></div>
      </div>
      <div><small>Remaining: ${i.remainingQty || 0} • Requested: ${i.requestedQty || 0} • Delivered: ${i.deliveredQty || 0} • Used: ${i.usedQty || 0}</small></div>
      ${i.imageUrl ? `<div><img src="${escapeHtml(i.imageUrl)}" style="max-width:140px;border-radius:8px;margin-top:6px" alt="image" /></div>` : ''}
      <div class="actions">
        <button class="btn" data-act="use" data-id="${i.id}">Record Usage</button>
        <button class="btn" data-act="deliver" data-id="${i.id}">Deliver More</button>
        <button class="btn" data-act="delete" data-id="${i.id}">Delete</button>
      </div>
    `;
    out.appendChild(div);
  });
}

/* Actions inside remaining list */
qs('#remainingList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if(!b) return;
  const act = b.dataset.act; const id = b.dataset.id;
  const it = state.items.find(x => x.id === id);
  if(!it) return;

  if(act === 'delete') {
    if(!confirm('Delete this request?')) return;
    try { await deleteDoc(doc(db, 'materialsRequests', id)); showToast('Deleted', {type:'info'}); } catch(e){ console.error(e); showToast('Failed', {type:'error'}); }
    return;
  }

  if(act === 'deliver') {
    const input = prompt(`Deliver additional quantity for "${it.title}"`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const newDelivered = (it.deliveredQty || 0) + n;
    const newRemaining = (it.remainingQty || 0) + n;
    const newStatus = (newDelivered >= (it.requestedQty || 0) && (it.requestedQty||0)>0) ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', id), { deliveredQty: newDelivered, remainingQty: newRemaining, status: newStatus });
      showToast(`Delivered ${n} pcs`, {type:'success'});
    } catch(e){ console.error(e); showToast('Failed', {type:'error'}); }
    return;
  }

  if(act === 'use') {
    const avail = it.remainingQty || 0;
    if(avail <= 0) { showToast('No remaining stock', {type:'info'}); return; }
    const input = prompt(`Record usage for "${it.title}" (available: ${avail})`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const deduct = Math.min(n, avail);
    const newRemaining = Math.max(0, (it.remainingQty || 0) - deduct);
    const newUsed = (it.usedQty || 0) + deduct;
    const hist = (it.usageHistory || []).slice(); hist.push({ date: nowISO(), qty: deduct, note: 'Usage recorded via remaining list' });
    const newStatus = (it.deliveredQty || 0) >= (it.requestedQty || 0) || newRemaining <= 0 ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', id), { remainingQty: newRemaining, usedQty: newUsed, usageHistory: hist, status: newStatus });
      showToast(`Deducted ${deduct}`, {type:'success'});
    } catch(e){ console.error(e); showToast('Failed', {type:'error'}); }
    return;
  }
});

/* Usage / Reports */
function renderUsage() {
  const el = qs('#usageSummary'); el.innerHTML = '';
  if(state.items.length === 0) { el.innerHTML = '<p class="muted">No data to summarize.</p>'; return; }

  const totalRequested = state.items.reduce((s,i)=> s + (i.requestedQty||0), 0);
  const totalDelivered = state.items.reduce((s,i)=> s + (i.deliveredQty||0), 0);
  const totalRemaining = state.items.reduce((s,i)=> s + (i.remainingQty||0), 0);
  const totalUsed = state.items.reduce((s,i)=> s + (i.usedQty||0), 0);

  el.innerHTML = `<p><strong>Total requested:</strong> ${totalRequested}</p>
                  <p><strong>Total delivered:</strong> ${totalDelivered}</p>
                  <p><strong>Remaining:</strong> ${totalRemaining}</p>
                  <p><strong>Used (total):</strong> ${totalUsed}</p>`;

  const byMaterial = state.items.reduce((acc,i)=> {
    const k = i.title || 'Unknown';
    if(!acc[k]) acc[k] = { req:0, del:0, rem:0, used:0 };
    acc[k].req += i.requestedQty || 0;
    acc[k].del += i.deliveredQty || 0;
    acc[k].rem += i.remainingQty || 0;
    acc[k].used += i.usedQty || 0;
    return acc;
  }, {});

  const list = document.createElement('div'); list.style.marginTop = '12px';
  Object.entries(byMaterial).forEach(([k,v]) => {
    const p = document.createElement('div');
    p.style.display = 'flex'; p.style.justifyContent = 'space-between'; p.style.alignItems = 'center'; p.style.marginBottom = '8px';
    p.innerHTML = `<div><strong>${escapeHtml(k)}</strong><div style="font-size:13px;color:var(--muted)">Requested: ${v.req} • Delivered: ${v.del} • Remaining: ${v.rem} • Used: ${v.used}</div></div>
                   <div><button class="btn" data-material="${escapeHtml(k)}">Deduct</button></div>`;
    list.appendChild(p);
  });
  el.appendChild(list);
}

/* Bulk deduct FIFO across docs */
qs('#usageSummary').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-material]');
  if(!btn) return;
  const mat = btn.dataset.material;
  const matching = state.items.filter(i => i.title === mat && (i.remainingQty || 0) > 0).sort((a,b) => a.date.localeCompare(b.date));
  const totalRem = matching.reduce((s,i)=> s + (i.remainingQty||0), 0);
  if(totalRem <= 0) { showToast('No remaining quantity for this material', {type:'info'}); return; }
  const input = prompt(`Deduct from "${mat}" (available: ${totalRem}). Enter qty used:`, 1);
  if(input === null) return;
  const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
  let remainingToDeduct = Math.min(n, totalRem);
  for(const it of matching) {
    if(remainingToDeduct <= 0) break;
    const take = Math.min(it.remainingQty || 0, remainingToDeduct);
    const newRemaining = Math.max(0, (it.remainingQty || 0) - take);
    const newUsedQty = (it.usedQty || 0) + take;
    const newUsageHistory = (it.usageHistory || []).slice();
    newUsageHistory.push({ date: nowISO(), qty: take, note: `Bulk deduct for ${mat}` });
    const newStatus = (it.deliveredQty || 0) >= (it.requestedQty || 0) || newRemaining <= 0 ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', it.id), { remainingQty: newRemaining, usedQty: newUsedQty, usageHistory: newUsageHistory, status: newStatus });
    } catch(e) {
      console.error(e);
      showToast('Partial failure while deducting', {type:'error'});
    }
    remainingToDeduct -= take;
  }
  showToast(`Deducted ${n - Math.max(0, remainingToDeduct)} from "${mat}"`, {type:'success'});
});

/* Export CSV & Print A→Z */
qs('#exportCsv').addEventListener('click', () => {
  if(state.items.length === 0) { showToast('No data to export', {type:'info'}); return; }
  const rows = [['Title','Unit','RequestedQty','DeliveredQty','RemainingQty','UsedQty','Requester','Description','Date','Status']];
  state.items.forEach(i => rows.push([i.title,i.unit,i.requestedQty,i.deliveredQty,i.remainingQty,i.usedQty,i.requester,(i.description||''),i.date,i.status||'']));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'materials.csv'; a.click(); URL.revokeObjectURL(url);
  showToast('CSV exported', {type:'success'});
});

qs('#printAll').addEventListener('click', () => {
  if(state.items.length === 0) { showToast('No items to print', {type:'info'}); return; }
  const sorted = state.items.slice().sort((a,b) => (a.title||'').toLowerCase().localeCompare((b.title||'').toLowerCase()));
  let html = `<div id="printTable"><h2 style="text-align:center;">Materials Request Report (A→Z)</h2><table><thead>
    <tr><th>#</th><th>Material</th><th>Unit</th><th>Requested</th><th>Delivered</th><th>Remaining</th><th>Used</th><th>Requester</th><th>Status</th><th>Date</th></tr>
    </thead><tbody>`;
  sorted.forEach((i, idx) => {
    html += `<tr><td>${idx+1}</td><td>${escapeHtml(i.title)}</td><td>${escapeHtml(i.unit||'')}</td><td>${i.requestedQty||0}</td><td>${i.deliveredQty||0}</td><td>${i.remainingQty||0}</td><td>${i.usedQty||0}</td><td>${escapeHtml(i.requester)}</td><td>${escapeHtml(i.status || computeStatus(i).text)}</td><td>${new Date(i.date).toLocaleString()}</td></tr>`;
  });
  html += `</tbody></table></div>`;
  const printWin = window.open('', '', 'width=1000,height=700');
  printWin.document.write(`<html><head><title>Print Materials Report</title>
    <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:6px;font-size:13px}th{background:#eee}h2{text-align:center;margin-bottom:10px}</style>
    </head><body>${html}</body></html>`);
  printWin.document.close(); printWin.focus(); printWin.print();
  showToast('Print dialog opened', {type:'info'});
});

/* Search overlay logic */
const searchOverlay = qs('#searchOverlay');
const searchInput = qs('#searchInput');
const closeSearch = qs('#closeSearch');
const searchBtn = qs('#searchBtn');
const searchResults = qs('#searchResults');

function openSearch(){ searchOverlay.classList.remove('hidden'); searchInput.value=''; searchResults.innerHTML = '<p class="muted">Type to search by material or requester...</p>'; setTimeout(()=> searchInput.focus(), 60); }
function closeSearchOverlay(){ searchOverlay.classList.add('hidden'); }

searchBtn.addEventListener('click', openSearch);
closeSearch.addEventListener('click', closeSearchOverlay);
searchOverlay.addEventListener('click', (e)=> { if(e.target === searchOverlay) closeSearchOverlay(); });

searchInput.addEventListener('input', ()=> {
  const q = searchInput.value.trim().toLowerCase();
  if(q === '') { searchResults.innerHTML = '<p class="muted">Type to search by material or requester...</p>'; return; }
  const matches = state.items.filter(i => (i.title||'').toLowerCase().includes(q) || (i.requester||'').toLowerCase().includes(q));
  if(matches.length === 0) { searchResults.innerHTML = '<p class="muted">No matches</p>'; return; }
  searchResults.innerHTML = '';
  matches.forEach(i => {
    const d = document.createElement('div'); d.className = 'req';
    const st = computeStatus(i);
    d.innerHTML = `<div class="row"><div><strong>${escapeHtml(i.title)}</strong><div style="font-size:13px;color:var(--muted)">${escapeHtml(i.requester)} • ${st.text}</div></div><div><div class="badge ${st.class}">${st.text}</div></div></div>
                   <div style="margin-top:6px"><small>Requested: ${i.requestedQty||0} • Delivered: ${i.deliveredQty||0} • Remaining: ${i.remainingQty||0}</small></div>`;
    d.style.cursor = 'pointer';
    d.addEventListener('click', () => {
      state.filteredId = i.id;
      renderRequests(state.currentFilter);
      closeSearchOverlay();
      openEditModal(i);
    });
    searchResults.appendChild(d);
  });
});

/* Edit modal (openEditModal) */
const editModal = qs('#editModal');
const editBody = qs('#editBody');
const closeEdit = qs('#closeEdit');
const saveEdit = qs('#saveEdit');
const cancelEdit = qs('#cancelEdit');

let currentEditItem = null;

function openEditModal(item) {
  currentEditItem = item;
  editModal.classList.remove('hidden');
  renderEditBody(item);
}

function closeEditModal() {
  currentEditItem = null;
  editModal.classList.add('hidden');
}

closeEdit.addEventListener('click', closeEditModal);
cancelEdit.addEventListener('click', closeEditModal);

function renderEditBody(i) {
  if(!i) { editBody.innerHTML = '<p>Not found</p>'; return; }
  editBody.innerHTML = `
    <label>Material Name
      <input id="e_title" value="${escapeHtml(i.title)}" />
    </label>
    <label>Requested Quantity
      <input id="e_requestedQty" type="number" value="${i.requestedQty || 0}" />
    </label>
    <label>Unit
      <input id="e_unit" value="${escapeHtml(i.unit || '')}" />
    </label>
    <label>Description
      <textarea id="e_description" rows="3">${escapeHtml(i.description || '')}</textarea>
    </label>
    <div style="margin-top:8px"><strong>Stats:</strong>
      <div style="font-size:13px;color:var(--muted)">Delivered: ${i.deliveredQty || 0} • Remaining: ${i.remainingQty || 0} • Used: ${i.usedQty || 0}</div>
    </div>
    ${i.imageUrl ? `<div style="margin-top:8px"><img src="${escapeHtml(i.imageUrl)}" style="max-width:200px;border-radius:8px" alt="img" /></div>` : ''}
    <div style="margin-top:8px"><strong>Usage history</strong>
      <div id="usageHistory" style="font-size:13px;color:var(--muted);margin-top:6px">${(i.usageHistory||[]).map(h => `<div>${new Date(h.date).toLocaleString()} — ${h.qty}</div>`).join('') || '<div class="muted">No usage yet.</div>'}</div>
    </div>

    <div class="form-row" style="margin-top:10px;">
      <button id="editDeliverBtn" class="btn">Deliver</button>
      <button id="editRecordBtn" class="btn">Record Usage</button>
    </div>
  `;

  const deliverBtn = qs('#editDeliverBtn');
  const recordBtn = qs('#editRecordBtn');

  deliverBtn.onclick = async () => {
    const input = prompt(`Enter delivered quantity for "${i.title}"`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const newDelivered = (i.deliveredQty || 0) + n;
    const newRemaining = (i.remainingQty || 0) + n;
    const newStatus = (newDelivered >= (i.requestedQty || 0) && (i.requestedQty || 0) > 0) ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', i.id), { deliveredQty: newDelivered, remainingQty: newRemaining, status: newStatus });
      showToast(`Delivered ${n}`, {type:'success'});
    } catch(err) { console.error(err); showToast('Failed', {type:'error'}); }
  };

  recordBtn.onclick = async () => {
    const avail = i.remainingQty || 0;
    if(avail <= 0) { showToast('No remaining stock to deduct', {type:'info'}); return; }
    const input = prompt(`Record usage for "${i.title}" (available: ${avail})`, 1);
    if(input === null) return;
    const n = Number(input); if(isNaN(n) || n <= 0) { showToast('Invalid', {type:'error'}); return; }
    const deduct = Math.min(n, avail);
    const newRemaining = Math.max(0, (i.remainingQty || 0) - deduct);
    const newUsed = (i.usedQty || 0) + deduct;
    const hist = (i.usageHistory || []).slice(); hist.push({ date: nowISO(), qty: deduct, note: 'Usage recorded (modal)' });
    const newStatus = (i.deliveredQty || 0) >= (i.requestedQty || 0) || newRemaining <= 0 ? 'Completed' : 'Pending';
    try {
      await updateDoc(doc(db, 'materialsRequests', i.id), { remainingQty: newRemaining, usedQty: newUsed, usageHistory: hist, status: newStatus });
      showToast(`Deducted ${deduct}`, {type:'success'});
      renderEditBody({ ...i, remainingQty: newRemaining, usedQty: newUsed, usageHistory: hist });
    } catch(err) { console.error(err); showToast('Failed', {type:'error'}); }
  };
}

/* Save edits from modal */
saveEdit.addEventListener('click', async () => {
  if(!currentEditItem) return;
  const newTitle = qs('#e_title').value.trim();
  const newRequestedQty = Number(qs('#e_requestedQty').value);
  const newUnit = qs('#e_unit').value.trim();
  const newDesc = qs('#e_description').value.trim();
  try {
    await updateDoc(doc(db, 'materialsRequests', currentEditItem.id), {
      title: newTitle,
      requestedQty: newRequestedQty,
      unit: newUnit,
      description: newDesc
    });
    showToast('Request updated', {type:'success'});
    closeEditModal();
  } catch(err) {
    console.error(err); showToast('Failed to update', {type:'error'});
  }
});

/* Clear all requests (danger) */
qs('#clearAll').addEventListener('click', async () => {
  if(!confirm('Clear ALL requests in cloud? This cannot be undone.')) return;
  showToast('Clearing all requests (cloud)...', {type:'info', duration:3000});
  for(const it of state.items) {
    try { await deleteDoc(doc(db, 'materialsRequests', it.id)); } catch(e) { console.error(e); }
  }
  showToast('All requests cleared (cloud).', {type:'info'});
});

/* Home stats */
function updateHomeStats() {
  const el = qs('#homeStats');
  const total = state.items.length;
  const pending = state.items.filter(i => (i.status || '') === 'Pending').length;
  const partial = state.items.filter(i => (i.deliveredQty || 0) > 0 && (i.deliveredQty || 0) < (i.requestedQty || 0)).length;
  const deliveredCount = state.items.filter(i => (i.deliveredQty || 0) > 0).length;
  const completed = state.items.filter(i => (i.status || '') === 'Completed').length;
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
    <div class="card" style="padding:8px"><strong>Total</strong><div>${total}</div></div>
    <div class="card" style="padding:8px;background:#fff6db"><strong>Pending</strong><div>${pending}</div></div>
    <div class="card" style="padding:8px;background:#e8f5e9"><strong>Delivered Items</strong><div>${deliveredCount}</div></div>
    <div class="card" style="padding:8px;background:#e7f0ff"><strong>Partial</strong><div>${partial}</div></div>
    <div class="card" style="padding:8px;background:#dcd6f7"><strong>Completed</strong><div>${completed}</div></div>
  </div>`;
}

/* Render all */
function renderAll() {
  renderRequests(state.currentFilter);
  renderDelivered();
  renderRemaining();
  renderUsage();
  updateHomeStats();
}
renderAll();