// ╔══════════════════════════════════════════╗
// ║          RAY APP - GLOBAL UTILS          ║
// ╚══════════════════════════════════════════╝

const API = '/api';

// ─── TOKEN MANAGEMENT ────────────────────────
function getToken() { return localStorage.getItem('ray_token') || sessionStorage.getItem('ray_token'); }
function setToken(t) { localStorage.setItem('ray_token', t); }
function getUser() { try { return JSON.parse(localStorage.getItem('ray_user') || sessionStorage.getItem('ray_user') || 'null'); } catch { return null; } }
function setUser(u) { localStorage.setItem('ray_user', JSON.stringify(u)); }
function clearAuth() { localStorage.removeItem('ray_token'); localStorage.removeItem('ray_user'); sessionStorage.removeItem('ray_token'); sessionStorage.removeItem('ray_user'); }

function requireLogin() {
  if (!getToken()) { window.location.href = '/login'; return false; }
  return true;
}
function requireAdmin() {
  const u = getUser();
  if (!u || u.role !== 'admin') { window.location.href = '/dashboard'; return false; }
  return true;
}

// ─── FETCH WRAPPER ────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.body instanceof FormData) delete headers['Content-Type'];

  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearAuth();
    window.location.href = '/login';
    return null;
  }
  return { ok: res.ok, status: res.status, data };
}

// ─── TOAST ────────────────────────────────────
function toast(msg, type = 'info', dur = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon"></span><span>${escapeHtml(String(msg))}</span>`;
  t.onclick = () => t.remove();
  container.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

// ─── HTML ESCAPE ──────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// ─── FORMAT SIZE ──────────────────────────────
function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── FORMAT DATE ──────────────────────────────
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtRelative(d) {
  if (!d) return '-';
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'baru saja';
  if (diff < 3600000) return Math.floor(diff/60000) + ' menit lalu';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' jam lalu';
  return Math.floor(diff/86400000) + ' hari lalu';
}

// ─── MODAL ────────────────────────────────────
function showModal({ title, body, confirmText = 'OK', confirmClass = 'btn-primary', onConfirm, cancelText = 'Batal', size = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${size}">
      <div class="modal-header">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">
        ${cancelText ? `<button class="btn btn-ghost btn-cancel">${escapeHtml(cancelText)}</button>` : ''}
        ${confirmText ? `<button class="btn ${confirmClass} btn-confirm">${escapeHtml(confirmText)}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close')?.addEventListener('click', close);
  overlay.querySelector('.btn-cancel')?.addEventListener('click', close);
  overlay.querySelector('.btn-confirm')?.addEventListener('click', async () => {
    if (onConfirm) await onConfirm(overlay, close);
    else close();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  return { overlay, close };
}

function confirmModal(title, msg, onYes, danger = false) {
  return showModal({ title, body: `<p style="color:var(--muted)">${escapeHtml(msg)}</p>`, confirmText: 'Ya, lanjutkan', confirmClass: danger ? 'btn-danger' : 'btn-primary', onConfirm: async (_, close) => { await onYes(); close(); } });
}

// ─── NAVBAR RENDER ────────────────────────────
function renderNavbar(active = '') {
  const u = getUser();
  const nav = document.getElementById('navbar');
  if (!nav) return;
  nav.innerHTML = `
    <a href="/" class="navbar-brand">
      <div class="logo-icon">~</div>
      Ray App
    </a>
    <div class="navbar-nav" id="navbar-links">
      ${u ? `
        <a href="/dashboard" class="nav-link ${active==='dashboard'?'active':''}">Dashboard</a>
        ${u.role==='admin' ? `<a href="/admin-panel" class="nav-link ${active==='admin'?'active':''}">Admin</a>` : ''}
        <div class="nav-user" id="nav-user-btn">
          <div class="nav-avatar">${u.username[0].toUpperCase()}</div>
          <span>${escapeHtml(u.username)}</span>
          <span style="font-size:.75rem;color:var(--subtle)">&#9660;</span>
        </div>
      ` : `
        <a href="/login" class="nav-link ${active==='login'?'active':''}">Masuk</a>
        <a href="/register" class="btn btn-primary btn-sm">Daftar Gratis</a>
      `}
    </div>
    <div class="sidebar-toggle" id="sidebar-toggle" style="display:none">
      <span></span><span></span><span></span>
    </div>`;

  if (u) {
    document.getElementById('nav-user-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Akun',
        body: `<div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:.85rem;color:var(--muted)">Login sebagai <strong style="color:var(--text)">${escapeHtml(u.username)}</strong></div>
          <button class="btn btn-ghost btn-sm" onclick="window.location='/dashboard'">Dashboard</button>
          <button class="btn btn-danger btn-sm" onclick="clearAuth();window.location='/'">Keluar</button>
        </div>`,
        confirmText: '', cancelText: 'Tutup'
      });
    });
  }
}

// ─── SIDEBAR TOGGLE ───────────────────────────
function initSidebarToggle(sidebarId = 'sidebar') {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById(sidebarId);
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggle || !sidebar) return;

  // Show toggle on mobile
  if (window.innerWidth <= 768) toggle.style.display = 'flex';
  window.addEventListener('resize', () => {
    toggle.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
  });

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay?.classList.toggle('open');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });
}

// ─── COPY TO CLIPBOARD ───────────────────────
function copyText(text, label = 'Disalin!') {
  navigator.clipboard.writeText(text).then(() => toast(label, 'success')).catch(() => toast('Gagal menyalin.', 'error'));
}

// ─── GET FILE ICON CHAR ───────────────────────
function fileIconChar(mimeType, name) {
  if (!mimeType && name) {
    const ext = name.split('.').pop().toLowerCase();
    const m = { html:'H', htm:'H', css:'C', js:'J', json:'{}', png:'img', jpg:'img', jpeg:'img', gif:'img', webp:'img', svg:'svg', mp3:'mus', mp4:'vid', zip:'zip', pdf:'pdf', md:'MD', txt:'TXT' };
    return m[ext] || '?';
  }
  if (mimeType?.startsWith('image/')) return 'img';
  if (mimeType?.includes('html')) return 'H';
  if (mimeType?.includes('css')) return 'C';
  if (mimeType?.includes('javascript')) return 'J';
  if (mimeType?.includes('json')) return '{}';
  if (mimeType?.includes('zip')) return 'zip';
  if (mimeType?.includes('pdf')) return 'pdf';
  if (mimeType?.includes('audio')) return 'mus';
  if (mimeType?.includes('video')) return 'vid';
  if (mimeType?.startsWith('text/')) return 'TXT';
  return 'bin';
}

function fileIconColor(mimeType, name) {
  const c = fileIconChar(mimeType, name);
  const map = { 'H':'#e34c26','C':'#264de4','J':'#f7df1e','{}':'#89d96d','img':'#4dd0e1','zip':'#ff9800','pdf':'#f44336','mus':'#9c27b0','vid':'#2196f3','svg':'#ff9800' };
  return map[c] || '#7eb8d4';
}
