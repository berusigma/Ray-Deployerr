/* ── Ray App Global JS ── */
'use strict';

// ── Storage helpers ─────────────────────────────
const Store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k),
  token: () => localStorage.getItem('ra_token'),
  user:  () => Store.get('ra_user'),
  setAuth: (token, user) => { localStorage.setItem('ra_token', token); Store.set('ra_user', user); },
  clearAuth: () => { localStorage.removeItem('ra_token'); localStorage.removeItem('ra_user'); }
};

// ── API fetch wrapper ───────────────────────────
async function api(path, opts = {}) {
  const headers = {};
  const token = Store.token();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch('/api' + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { Store.clearAuth(); location.href = '/login'; return null; }
    return data;
  } catch (e) {
    return { ok: false, msg: 'Koneksi gagal. Periksa internet kamu.' };
  }
}

// ── Guards ──────────────────────────────────────
function requireLogin() {
  if (!Store.token()) { location.href = '/login'; return false; }
  return true;
}
function requireAdmin() {
  const u = Store.user();
  if (!u || u.role !== 'admin') { location.href = '/dashboard'; return false; }
  return true;
}

// ── XSS escape ──────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Format helpers ──────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB'], i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtAgo(d) {
  if (!d) return '-';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s/60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s/3600) + ' jam lalu';
  return Math.floor(s/86400) + ' hari lalu';
}

// ── Toast ───────────────────────────────────────
function toast(msg, type = 'info', ms = 3500) {
  let wrap = document.getElementById('toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${esc(msg)}</span>`;
  el.onclick = () => el.remove();
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Modal ───────────────────────────────────────
function modal({ title = '', body = '', ok = 'OK', okClass = 'btn-primary', cancel = 'Batal', onOk, wide = false }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal-box${wide?' wide':''}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="modal-close" aria-label="Tutup">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${cancel ? `<button class="btn btn-ghost btn-sm _cancel">${esc(cancel)}</button>` : ''}
        ${ok     ? `<button class="btn ${okClass} btn-sm _ok">${esc(ok)}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector('.modal-close').onclick = close;
  bg.querySelector('._cancel')?.addEventListener('click', close);
  bg.querySelector('._ok')?.addEventListener('click', async () => {
    if (onOk) await onOk(bg, close); else close();
  });
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  return { bg, close };
}

function confirm(title, msg, onYes, danger = false) {
  return modal({
    title, body: `<p style="color:var(--muted);font-size:.9rem">${esc(msg)}</p>`,
    ok: 'Ya, lanjutkan', okClass: danger ? 'btn-danger' : 'btn-primary',
    onOk: async (_, close) => { await onYes(); close(); }
  });
}

// ── Copy to clipboard ───────────────────────────
function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Disalin!', 'ok')).catch(() => toast('Gagal salin.', 'err'));
}

// ── File icon color ─────────────────────────────
function fileIcon(name, mime) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    html:['HTML','#e34c26'], htm:['HTML','#e34c26'], css:['CSS','#264de4'],
    js:['JS','#f0db4f'], mjs:['JS','#f0db4f'], json:['JSON','#89d96d'],
    png:['PNG','#06b6d4'], jpg:['JPG','#06b6d4'], jpeg:['JPG','#06b6d4'],
    gif:['GIF','#a855f7'], webp:['IMG','#06b6d4'], svg:['SVG','#f97316'],
    ico:['ICO','#f59e0b'], mp3:['MP3','#ec4899'], mp4:['MP4','#3b82f6'],
    webm:['VID','#3b82f6'], zip:['ZIP','#f97316'], pdf:['PDF','#ef4444'],
    md:['MD','#64748b'], txt:['TXT','#94a3b8'], xml:['XML','#10b981'],
    woff:['FONT','#8b5cf6'], woff2:['FONT','#8b5cf6'], ttf:['FONT','#8b5cf6'],
  };
  const r = map[ext] || ['FILE','#94a3b8'];
  return { label: r[0], color: r[1] };
}

// ── Navbar ──────────────────────────────────────
function buildNav(active) {
  const u = Store.user();
  const el = document.getElementById('nav');
  if (!el) return;
  el.innerHTML = `
    <a href="/" class="nav-brand" style="text-decoration:none">
      <div class="nav-brand-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2 L2 7 L12 12 L22 7 Z" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17 L12 22 L22 17" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12 L12 17 L22 12" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      Ray App
    </a>
    <div class="nav-links" id="nav-links">
      ${u ? `
        <a href="/dashboard" class="nav-link${active==='dash'?' active':''}">Dashboard</a>
        ${u.role==='admin' ? `<a href="/admin-panel" class="nav-link${active==='admin'?' active':''}">Admin</a>` : ''}
        <div class="nav-user-wrap" style="display:flex;align-items:center">
          <div class="nav-user" id="nav-user">
            <div class="nav-avatar">${esc(u.username[0].toUpperCase())}</div>
            <span style="font-size:.85rem">${esc(u.username)}</span>
          </div>
        </div>
      ` : `
        <a href="/login" class="nav-link${active==='login'?' active':''}">Masuk</a>
        <a href="/register" class="btn btn-primary btn-sm">Daftar Gratis</a>
      `}
    </div>
    <button class="hamburger" id="hamburger" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>`;

  // User dropdown
  document.getElementById('nav-user')?.addEventListener('click', () => {
    modal({
      title: 'Akun Kamu',
      body: `<div style="display:flex;flex-direction:column;gap:8px">
        <p style="font-size:.85rem;color:var(--muted)">Login sebagai <strong>${esc(u.username)}</strong></p>
        <a href="/dashboard" class="btn btn-ghost btn-sm" style="justify-content:center">Dashboard</a>
        <button class="btn btn-danger btn-sm" onclick="Store.clearAuth();location.href='/'">Keluar</button>
      </div>`,
      ok: '', cancel: 'Tutup'
    });
  });

  // Mobile hamburger → show links in dropdown
  document.getElementById('hamburger')?.addEventListener('click', () => {
    const existing = document.getElementById('mobile-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'mobile-menu';
    menu.style.cssText = 'position:fixed;top:58px;left:0;right:0;background:var(--surface);border-bottom:1.5px solid var(--border);padding:12px 16px;display:flex;flex-direction:column;gap:6px;z-index:999;box-shadow:var(--sh-md)';
    menu.innerHTML = u ? `
      <a href="/dashboard" class="btn btn-ghost btn-sm" style="justify-content:flex-start">Dashboard</a>
      ${u.role==='admin' ? `<a href="/admin-panel" class="btn btn-ghost btn-sm" style="justify-content:flex-start">Admin</a>` : ''}
      <button class="btn btn-danger btn-sm" onclick="Store.clearAuth();location.href='/'">Keluar</button>
    ` : `
      <a href="/login" class="btn btn-ghost btn-sm" style="justify-content:flex-start">Masuk</a>
      <a href="/register" class="btn btn-primary btn-sm" style="justify-content:flex-start">Daftar Gratis</a>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 100);
  });
}
