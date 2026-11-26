/* =====================================================================
   Panel istemcisi — tüm veriler /api üzerinden gelir.
   ===================================================================== */

const state = {
  me: null,
  guild: null,
  guilds: [],
  members: [],
  selectedMembers: new Set(),
  channels: [],
  selectedChannels: new Set(),
  roles: [],
  selectedRoles: new Set(),
  selectedMember: null,
  settings: null,
  webhookStatus: null
};

let stopActiveMessageBatch = null;
let stopActiveChannelCreation = null;
let webhookStatusTimer = null;
let webhookProgress = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
};

/* ---------------- İKONLAR (24x24, çizgi ikon) ---------------- */
const ICONS = {
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.6a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userX: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><line x1="7.5" y1="7.5" x2="7.51" y2="7.5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1.1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.7 1z"/>',
  list: '<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><line x1="4" y1="6" x2="4.01" y2="6"/><line x1="4" y1="12" x2="4.01" y2="12"/><line x1="4" y1="18" x2="4.01" y2="18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  refresh: '<polyline points="21 4 21 10 15 10"/><path d="M18.4 15a8 8 0 1 1-1.9-8.3L21 10"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.4 10.4 0 0 1 12 19.5C5.6 19.5 2 12.5 2 12.5a18 18 0 0 1 4.6-5.6"/><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.4 18.4 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="2.5" y1="2.5" x2="21.5" y2="21.5"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkSquare: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  square: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 6V4.5a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 14 4.5V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="2.5"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/><path d="M12 8V4.5"/><circle cx="12" cy="3.2" r="1.2"/>',
  crown: '<path d="M3.5 18h17"/><path d="M4.5 15 3.2 6.6 8.4 10 12 4l3.6 6 5.2-3.4L19.5 15z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
  micOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9.5V12a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M17.5 16.4A7 7 0 0 1 5 12v-1.5"/><path d="M19 10.5V12a7 7 0 0 1-.3 1.9"/><line x1="12" y1="19" x2="12" y2="22.5"/><line x1="8.5" y1="22.5" x2="15.5" y2="22.5"/>',
  mic: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22.5"/><line x1="8.5" y1="22.5" x2="15.5" y2="22.5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  megaphone: '<path d="M3 11v2.5a1.5 1.5 0 0 0 1.5 1.5H6l4 4V6L6 10H4.5A1.5 1.5 0 0 0 3 11z"/><path d="M14 8.5a4.5 4.5 0 0 1 0 7"/><path d="M17.5 5.5a9 9 0 0 1 0 13"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  speaker: '<rect x="4" y="2" width="16" height="20" rx="2.5"/><circle cx="12" cy="14" r="3.5"/><line x1="12" y1="6" x2="12.01" y2="6"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.5 14"/>',
  gift: '<rect x="2.5" y="7.5" width="19" height="4.5" rx="1"/><path d="M4.5 12v8.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V12"/><line x1="12" y1="7.5" x2="12" y2="22"/><path d="M12 7.5H8a2.2 2.2 0 0 1 0-4.5c2 0 4 4.5 4 4.5z"/><path d="M12 7.5h4a2.2 2.2 0 0 0 0-4.5c-2 0-4 4.5-4 4.5z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.4A2.7 2.7 0 0 0 12 8.3c-1.5 0-2.6.8-2.6 1.9s1.1 1.9 2.6 1.9 2.6.8 2.6 1.9-1.1 1.9-2.6 1.9a2.7 2.7 0 0 1-2.6-1.1"/><line x1="12" y1="6.3" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="17.7"/>',
  trophy: '<path d="M7 4h10v4.5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2 2 0 0 0 2 4"/><path d="M17 6h2.5a2 2 0 0 1-2 4"/><line x1="12" y1="13.5" x2="12" y2="18"/><path d="M8.5 20.5h7"/><path d="M10 18h4l1 2.5H9z"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  lock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/>',
  unlock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/><path d="M7.5 11V7a4.5 4.5 0 0 1 8.8-1.4"/>',
  home: '<path d="M3 9.7 12 3l9 6.7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12.5 15 12.5 15 22"/>',
  octagon: '<polygon points="7.9 2 16.1 2 22 7.9 22 16.1 16.1 22 7.9 22 2 16.1 2 7.9"/><line x1="12" y1="7.5" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/>',
  wrench: '<path d="M20.8 5.6a5.2 5.2 0 0 1-6.9 6.7L5.4 20.8a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5a5.2 5.2 0 0 1 6.7-6.9L14.6 6l.6 2.8 2.8.6z"/>',
  shield: '<path d="M12 22s8-3.6 8-9.6V5.2L12 2.2 4 5.2v7.2C4 18.4 12 22 12 22z"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  terminal: '<polyline points="4 17 10 11.5 4 6"/><line x1="12.5" y1="19" x2="20" y2="19"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>'
};

/** HTML içine gömülecek ikon. */
function iconSvg(name, className = 'icon') {
  const body = ICONS[name];
  return body
    ? `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
    : '';
}

/** DOM düğümü olarak ikon. */
function iconEl(name, className = 'icon') {
  const holder = el('span');
  holder.innerHTML = iconSvg(name, className);
  return holder.firstElementChild || holder;
}

/** İkon + metin ikilisi (buton ve menü öğeleri için). */
function withIcon(name, label, className = 'icon') {
  return [iconEl(name, className), el('span', { text: label })];
}

/**
 * Uzun toplu işlemleri parçalara bölüp ilerleme göstererek çalıştırır.
 * Sayı sınırı YOKTUR: listenin tamamı işlenir; parçalama yalnızca tek HTTP
 * isteğinin dakikalarca açık kalıp arayüzü kilitlememesi içindir.
 */
async function runInChunks(items, size, worker, onProgress) {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let firstError = '';
  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size);
    try {
      const r = await worker(chunk);
      succeeded += Number(r?.succeeded ?? r?.created ?? 0);
      failed += Number(r?.failed ?? 0);
      if (!firstError && Array.isArray(r?.results)) firstError = r.results.find((item) => !item.ok)?.error || '';
    } catch (err) {
      failed += chunk.length;
      if (!firstError) firstError = err.message || 'İşlem başarısız.';
      processed += chunk.length;
      onProgress?.({ processed, total: items.length, succeeded, failed, firstError, done: false });
      break;
    }
    processed += chunk.length;
    onProgress?.({ processed, total: items.length, succeeded, failed, firstError, done: processed >= items.length });
  }
  return { processed, succeeded, failed, firstError };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    showLogin(data.error || 'Oturum sona erdi, tekrar giriş yap.');
    throw new Error(data.error || 'Erişim reddedildi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Hata (${res.status})`);
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  return data;
}

function toast(msg, type = '') {
  const t = el('div', { class: `toast ${type}`, text: msg });
  $('#toasts').append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(30px)';
    t.style.transition = '.25s';
    setTimeout(() => t.remove(), 260);
  }, 4000);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} gün`);
  if (h) parts.push(`${h} sa`);
  if (m) parts.push(`${m} dk`);
  return parts.join(' ') || `${s} sn`;
}

/* ============================ OTURUM ============================ */
function showLogin(warning) {
  $('#login').style.display = 'grid';
  $('#app').style.display = 'none';
  if (warning) $('#loginWarn').innerHTML = `<div class="warn-box">${esc(warning)}</div>`;
}

function copyText(txt, okMsg = 'Kopyalandı') {
  if (!navigator.clipboard) return toast(txt, 'warn');
  navigator.clipboard.writeText(txt).then(() => toast(okMsg, 'ok')).catch(() => toast('Kopyalanamadı', 'err'));
}

function togglePass() {
  const inp = $('#loginPass');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const btn = $('#togglePassBtn');
  if (btn) {
    btn.innerHTML = iconSvg(inp.type === 'password' ? 'eye' : 'eyeOff');
    btn.title = inp.type === 'password' ? 'Şifreyi göster' : 'Şifreyi gizle';
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const btn = $('#loginBtn');
  const username = ($('#loginUser')?.value || '').trim();
  const password = $('#loginPass')?.value || '';
  if (!username || !password) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Kontrol ediliyor…'; }
  try {
    await api('/auth/login', { method: 'POST', body: { username, password } });
    $('#loginWarn').innerHTML = '';
    if ($('#loginPass')) $('#loginPass').value = '';
    await boot();
  } catch (err) {
    renderLogin(state.me, err.message || 'Giriş başarısız.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Giriş yap'; }
  }
}

function renderLogin(me, hata = '') {
  showLogin();
  const box = $('#loginWarn');
  if (!box) return;
  let html = '';
  if (hata) {
    html += `<div class="warn-box err">${iconSvg('octagon')}<span>${esc(hata)}</span></div>`;
  }
  if (me && !me.configured) {
    const eksikler = [];
    if (me.missingAuth) eksikler.push('<code>ADMIN_USER</code> ve <code>ADMIN_PASS</code>');
    if (me.missingToken) eksikler.push('<code>DISCORD_TOKEN</code>');
    html += `<div class="warn-box">
      <b>Kurulum tamamlanmadı.</b><br />
      Render &gt; Environment bölümüne ekle: ${eksikler.join(', ')}
    </div>`;
  }
  box.innerHTML = html;
}

function showApp() {
  $('#login').style.display = 'none';
  $('#app').style.display = 'block';
}

async function boot() {
  let me;
  try {
    me = await api('/api/me');
  } catch {
    return showLogin();
  }
  state.me = me;

  if (!me.user) return renderLogin(me);

  showApp();
  $('#userPill').textContent = me.user.globalName || me.user.username;
  if (me.user.avatar) {
    $('#userAvatar').src = `https://cdn.discordapp.com/avatars/${me.user.id}/${me.user.avatar}.png?size=64`;
  } else {
    $('#userAvatar').src = `https://cdn.discordapp.com/embed/avatars/0.png`;
  }

  updateBotStatus(me);

  await loadGuilds();
}

function updateBotStatus(me) {
  const on = me.botReady;
  $('#botStatus').innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>${on ? 'Bot çevrimiçi' : 'Bot çevrimdışı'}<br /><span style="opacity:.7">${on && me.botTag ? esc(me.botTag) : 'token kontrol et'}</span>`;
}

async function loadGuilds() {
  try {
    const { guilds } = await api('/api/guilds');
    state.guilds = guilds;
    if (!guilds.length) {
      $('#guildName').textContent = 'Sunucu yok';
      return showWelcome();
    }
    if (guilds.length === 1) {
      await selectGuild(guilds[0]);
    } else {
      openGuildPicker();
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function selectGuild(guild) {
  try {
    await api('/api/guild/select', { method: 'POST', body: { guildId: guild.id } });
    state.guild = guild;
    $('#guildName').textContent = guild.name;
    if (guild.icon) {
      const img = $('#guildIcon');
      img.src = guild.icon;
      img.style.display = 'block';
      $('#guildFallback').style.display = 'none';
    } else {
      $('#guildIcon').style.display = 'none';
      const fb = $('#guildFallback');
      fb.style.display = 'grid';
      fb.textContent = guild.name.charAt(0).toUpperCase();
    }
    closeModal();
    await loadDashboard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function openGuildPicker() {
  if (!state.guilds.length) return;
  const list = el('div', { class: 'channel-list' });
  for (const g of state.guilds) {
    const meta = [g.memberCount ? `${g.memberCount} üye` : '', g.channelCount ? `${g.channelCount} kanal` : ''].filter(Boolean).join(' · ');
    list.append(
      el('button', { class: 'channel-row', style: 'cursor:pointer', onclick: () => selectGuild(g) }, [
        g.icon ? el('img', { src: g.icon, style: 'width:32px;height:32px;border-radius:6px' }) : el('div', { class: 'ico' }, [iconEl('home')]),
        el('div', { class: 'nm', html: `${esc(g.name)}${meta ? `<small>${esc(meta)}</small>` : ''}` }),
        g.botIsAdmin
          ? el('span', { class: 'badge green', text: 'bot: yönetici' })
          : g.canManage
            ? el('span', { class: 'badge', text: 'bot: kısmi yetki' })
            : el('span', { class: 'badge red', text: 'bot yetkisi yok' })
      ])
    );
  }
  openModal([
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: `Sunucu seç (${state.guilds.length})` }), el('div', { class: 'sub', text: 'Botun bulunduğu tüm sunucuları inceleyip yönetebilirsin' })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    list
  ]);
}

function showWelcome() {
  const me = state.me || {};
  for (const s of document.querySelectorAll('.section')) s.classList.remove('active');
  $('#sec-dashboard').classList.add('active');

  if (!me.botReady) {
    const err = me.botError || (me.setup && me.setup.botError) || 'Bot henüz Discord sunucusuna giriş yapamadı.';
    const intentsErr = /intent/i.test(err);
    $('#pageTitle').textContent = 'Bot bağlanamadı';
    $('#pageSub').textContent = 'Discord bot ayarlarını tamamlaman gerekiyor';
    $('#sec-dashboard').innerHTML = `
      <div class="card" style="max-width:640px;padding:30px 24px">
        <div class="empty-hero">${iconSvg('octagon')}</div>
        <h3 style="font-size:18px;margin-bottom:8px">Bot şu an çevrimdışı</h3>
        <div class="warn-box">${esc(err)}</div>
        ${intentsErr ? `
          <p style="font-size:13.5px;line-height:1.8;color:var(--text);margin-bottom:14px">
            <b>Çözüm (30 saniye):</b><br />
            1. Discord Developer Portal &gt; uygulaman &gt; <b>Bot</b> sekmesine gir.<br />
            2. Aşağıdaki <b>Privileged Gateway Intents</b> bölümünden şu ikisini aç:<br />
            &nbsp;&nbsp;• <b>SERVER MEMBERS INTENT</b> → ON<br />
            &nbsp;&nbsp;• <b>MESSAGE CONTENT INTENT</b> → ON<br />
            3. <b>Save Changes</b>'e bas, ardından Render'da <b>Manual Deploy</b> yap.
          </p>
        ` : `
          <p style="font-size:13.5px;line-height:1.8;color:var(--muted);margin-bottom:14px">
            Render &gt; Environment bölümündeki <code>DISCORD_TOKEN</code> değerini ve Developer Portal &gt; Bot sekmesindeki Intent anahtarlarını kontrol et.
          </p>
        `}
        <div class="row" style="max-width:360px">
          <a class="btn btn-primary" href="/setup">${iconSvg('wrench')}<span>Kurulum teşhisi</span></a>
          <button class="btn" onclick="location.reload()">${iconSvg('refresh')}<span>Tekrar dene</span></button>
        </div>
      </div>`;
    return;
  }

  $('#pageTitle').textContent = 'Sunucu bulunamadı';
  $('#pageSub').textContent = 'Botu bir sunucuya eklemen gerekiyor';
  const inv = me.inviteUrl;
  $('#sec-dashboard').innerHTML = `
    <div class="card" style="text-align:center;padding:50px 20px">
      <div class="empty-hero">${iconSvg('bot')}</div>
      <h3 style="justify-content:center;font-size:18px">Bot çevrimiçi ama henüz bir sunucuya eklenmemiş</h3>
      <p style="color:var(--muted);font-size:13.5px;line-height:1.8;margin:12px 0 22px">
        Aşağıdan botu sunucuna ekle (yönetici izniyle). Ekledikten sonra <b>Yenile</b>'ye bas.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        ${inv ? `<a class="btn btn-primary" href="${esc(inv)}" target="_blank" rel="noopener">${iconSvg('plus')}<span>Botu sunucuya ekle</span></a>` : ''}
        <button class="btn" onclick="copyInvite()">${iconSvg('link')}<span>Linki kopyala</span></button>
        <button class="btn btn-ok" onclick="location.reload()">${iconSvg('refresh')}<span>Yenile</span></button>
      </div>
    </div>`;
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.reload();
}

/* ============================ NAVİGASYON ============================ */
document.querySelectorAll('.nav-item[data-section]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.section));
});

const TITLES = {
  dashboard: ['Genel bakış', 'Sunucu durumu ve bot bilgileri'],
  members: ['Üyeler', 'Bir üyeye tıkla, işlemi seç'],
  channels: ['Kanallar', 'Oluştur, düzenle, sil'],
  roles: ['Roller', 'Rol oluştur, ver, al'],
  guard: ['Guard', 'Gerçek zamanlı koruma: honeypot, reklam motoru, modüller, limitler ve canlı olaylar'],
  'guard-center': ['Guard Merkezi', 'Tüm sunucular: whitelist, blacklist, sessiz mod, honeypot ve müdahale istatistikleri'],
  games: ['Oyunlar', 'Yazı tura, zar ve ekonomi'],
  settings: ['Ayarlar', 'Bot davranışını yapılandır'],
  logs: ['Kayıtlar', 'Son 100 işlem']
};

function navigate(section) {
  document.querySelectorAll('.nav-item[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
  document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === `sec-${section}`));
  const [title, sub] = TITLES[section] || ['', ''];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;

  // Kanallardan çıkınca webhook durumu izlemeyi bırak.
  if (section !== 'channels') clearTimeout(webhookStatusTimer);

  if (section === 'dashboard') loadDashboard();
  if (section === 'members') loadMembers();
  if (section === 'channels') { loadChannels(); loadBans(); }
  if (section === 'roles') loadRoles();
  if (section === 'guard') loadGuard();
  if (section === 'guard-center') loadGuardCenter();
  if (section === 'games') loadGame();
  if (section === 'settings') loadSettings();
  if (section === 'logs') loadLogs();
}

/* ============================ MODAL ============================ */
function openModal(children) {
  const body = $('#modalBody');
  body.innerHTML = '';
  for (const c of children) body.append(c);
  $('#modal').classList.add('open');
}
function closeModal() {
  stopActiveMessageBatch?.();
  stopActiveChannelCreation?.();
  $('#modal').classList.remove('open');
}

/* ============================ DASHBOARD ============================ */
async function loadDashboard() {
  try {
    const d = await api('/api/overview');
    $('#stMembers').textContent = d.guild.memberCount;
    $('#stBots').textContent = `${d.guild.botCount} bot · ${d.guild.boostCount} takviye`;
    $('#stChannels').textContent = d.counts.text + d.counts.voice;
    $('#stChannelHint').textContent = `${d.counts.text} metin · ${d.counts.voice} ses`;
    $('#stBans').textContent = d.counts.bans ?? '—';
    $('#stPing').textContent = d.bot.ping != null ? `${d.bot.ping}ms` : '—';
    $('#stUptime').textContent = d.bot.uptime ? `${fmtDuration(d.bot.uptime)} çalışıyor` : 'çevrimdışı';

    $('#botInfo').innerHTML = `
      <div><b>Durum:</b> ${d.bot.ready ? '<span class="badge green">çevrimiçi</span>' : '<span class="badge red">çevrimdışı</span>'}</div>
      <div><b>Etiket:</b> ${esc(d.bot.tag || '—')}</div>
      <div><b>Sunucu:</b> ${d.bot.guildCount} adet</div>
      <div><b>Komut kullanımı:</b> ${d.bot.commands}</div>
      <div><b>Gecikme:</b> ${d.bot.ping ?? '—'} ms</div>
      <div><b>Roller:</b> ${d.counts.roles} · <b>Emoji:</b> ${d.counts.emojis}</div>`;

    const botPerms = d.bot.permissions || [];
    const hasBotAdmin = botPerms.includes('Administrator');
    const keyPerms = [
      ['Administrator', 'Yönetici'],
      ['ManageChannels', 'Kanal Yönet'],
      ['ManageRoles', 'Rol Yönet'],
      ['BanMembers', 'Üye Yasakla'],
      ['KickMembers', 'Üye At'],
      ['ModerateMembers', 'Sustur'],
      ['ManageGuild', 'Sunucu Yönet'],
      ['ManageMessages', 'Mesaj Yönet']
    ];
    $('#myPerms').innerHTML =
      `<div style="margin-bottom:6px"><span class="badge green">Panel kurucusu</span> <span class="hint" style="display:inline">Aşağıdakiler botun bu sunucudaki yetkileridir:</span></div>` +
      keyPerms
        .map(([k, label]) => `<span class="role-chip">${hasBotAdmin || botPerms.includes(k) ? `<span class="ok">${iconSvg('check', 'icon icon-sm')}</span>` : `<span class="no">${iconSvg('x', 'icon icon-sm')}</span>`}${label}</span>`)
        .join('');

    renderLogs($('#recentLogs'), d.recentLogs);
    $('#logCount').textContent = d.recentLogs.length;

    // bot detayları ayarlar sekmesinde de kullanılıyor
    const details = $('#botDetails');
    if (details) {
      details.innerHTML = `
        <div><b>Durum:</b> ${d.bot.ready ? '<span class="badge green">çevrimiçi</span>' : '<span class="badge red">çevrimdışı</span>'}</div>
        <div><b>Bot:</b> ${esc(d.bot.tag || '—')}</div>
        <div><b>Çalışma süresi:</b> ${d.bot.uptime ? fmtDuration(d.bot.uptime) : '—'}</div>
        <div><b>Toplam sunucu:</b> ${d.bot.guildCount}</div>
        <div><b>Bu sunucudaki komut:</b> ${d.bot.commands}</div>`;
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================ ÜYELER ============================ */
async function loadMembers() {
  const grid = $('#memberGrid');
  grid.innerHTML = '<div class="empty"><div class="spinner"></div><div style="margin-top:12px">Üyeler yükleniyor…</div></div>';
  try {
    const d = await api('/api/members');
    state.members = d.members;
    const valid = new Set(d.members.map((m) => m.id));
    state.selectedMembers = new Set([...state.selectedMembers].filter((id) => valid.has(id)));
    renderMembers();
  } catch (err) {
    grid.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderMembers() {
  const q = ($('#memberSearch').value || '').toLowerCase().trim();
  const filter = $('#memberFilter').value;
  const grid = $('#memberGrid');

  let list = state.members;
  if (q) list = list.filter((m) => m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || m.id.includes(q));
  if (filter === 'muted') list = list.filter((m) => m.muted);
  if (filter === 'warned') list = list.filter((m) => m.warnings > 0);
  if (filter === 'bots') list = list.filter((m) => m.bot);

  if (!list.length) {
    grid.innerHTML = '<div class="empty">Eşleşen üye yok.</div>';
    return;
  }

  grid.innerHTML = '';
  // Seçim ve toplu işlemler listenin TAMAMI üzerinde çalışır; buradaki sınır
  // yalnızca binlerce kartı tek seferde DOM'a basıp arayüzü kilitlememek içindir.
  const RENDER_LIMIT = 400;
  const rendered = list.slice(0, RENDER_LIMIT);
  if (list.length > RENDER_LIMIT) {
    grid.append(el('div', { class: 'hint', style: 'margin-bottom:8px', text: `${list.length} üyenin ilk ${RENDER_LIMIT} tanesi gösteriliyor; arama/filtre daraltır. "Tümünü seç" ve toplu işlemler bütün üyeleri kapsar.` }));
  }
  for (const m of rendered) {
    const tags = el('div', { class: 'tags' });
    if (m.bot) tags.append(el('span', { class: 'tag bot', text: 'BOT' }));
    if (m.muted) tags.append(el('span', { class: 'tag muted', text: 'SUSTURULMUŞ' }));
    if (m.warnings > 0) tags.append(el('span', { class: 'tag warnc', text: `${m.warnings} UYARI` }));

    const checkbox = el('input', { type: 'checkbox', class: 'member-select', checked: state.selectedMembers.has(m.id) ? 'checked' : null, onclick: (e) => { e.stopPropagation(); toggleMemberSelect(m.id, e.target.checked); } });
    grid.append(
      el('button', { class: `member-card${state.selectedMembers.has(m.id) ? ' selected' : ''}`, onclick: () => openMember(m.id) }, [
        checkbox,
        el('img', { src: m.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png', alt: '' }),
        el('div', { class: 'info' }, [
          el('div', { class: 'n', text: m.displayName }),
          el('div', { class: 'u', text: '@' + m.username }),
          tags
        ])
      ])
    );
  }
  updateMemberBulkCount();
}

function getVisibleMembers() {
  const q = ($('#memberSearch')?.value || '').toLowerCase().trim();
  const filter = $('#memberFilter')?.value || 'all';
  return state.members.filter((m) => (!q || m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || m.id.includes(q)))
    .filter((m) => filter === 'all' || (filter === 'muted' && m.muted) || (filter === 'warned' && m.warnings > 0) || (filter === 'bots' && m.bot));
}
function updateMemberBulkCount() { if ($('#memberBulkCount')) $('#memberBulkCount').textContent = `${state.selectedMembers.size} seçili`; }
function toggleMemberSelect(id, checked) { checked ? state.selectedMembers.add(id) : state.selectedMembers.delete(id); renderMembers(); }
function selectMembersBy(mode) {
  if (mode === 'none') state.selectedMembers.clear();
  else (mode === 'visible' ? getVisibleMembers() : state.members).forEach((m) => state.selectedMembers.add(m.id));
  renderMembers();
}

async function openMemberBulk(kind) {
  const ids = [...state.selectedMembers];
  if (!ids.length) return toast('Önce en az bir üye seç', 'warn');
  const roleMode = kind === 'roles';
  if (roleMode && !state.roles.length) state.roles = (await api('/api/roles')).roles;
  const reason = el('input', { class: 'input', id: 'bulkMemberReason', placeholder: 'İşlem sebebi' });
  const action = roleMode ? el('select', { class: 'input', id: 'bulkMemberAction' }, [el('option', { value: 'addRole', text: 'Rol ver' }), el('option', { value: 'removeRole', text: 'Rol al' })]) : null;
  const role = roleMode ? el('select', { class: 'input', id: 'bulkMemberRole' }, state.roles.filter((r) => !r.managed).map((r) => el('option', { value: r.id, text: r.name }))) : null;
  const duration = kind === 'mute' ? el('select', { class: 'input', id: 'bulkMemberDuration' }, [
    el('option', { value: '600000', text: '10 dakika' }), el('option', { value: '3600000', text: '1 saat' }), el('option', { value: '86400000', text: '1 gün' }), el('option', { value: '604800000', text: '7 gün' })
  ]) : null;
  const labels = { ban: 'Toplu yasaklama', kick: 'Toplu sunucudan atma', mute: 'Toplu susturma', unmute: 'Toplu susturma kaldırma', warn: 'Toplu uyarı', roles: 'Toplu rol yönetimi' };
  const body = [
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: labels[kind] }), el('div', { class: 'sub', text: `${ids.length} üye seçildi` })]), el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])]),
    el('div', { class: 'bulk-summary' }, [el('div', {}, [el('b', { text: String(ids.length) }), el('span', { text: 'Seçili üye' })]), el('div', {}, [el('b', { text: kind === 'ban' ? 'Kalıcı' : 'Toplu' }), el('span', { text: 'İşlem tipi' })]), el('div', {}, [el('b', { text: 'Yok' }), el('span', { text: 'İşlem sınırı' })])])
  ];
  if (action) body.push(el('label', { class: 'f', text: 'İşlem' }), action, el('div', { style: 'height:10px' }), el('label', { class: 'f', text: 'Rol' }), role);
  if (duration) body.push(el('label', { class: 'f', text: 'Süre' }), duration);
  if (!roleMode) body.push(el('label', { class: 'f', text: 'Sebep' }), reason);
  const progress = el('div', { class: 'hint send-progress', style: 'min-height:18px;margin:10px 0 0' });
  const applyButton = el('button', { class: `btn btn-block ${kind === 'ban' ? 'btn-danger' : 'btn-primary'}`, style: 'margin-top:16px', text: 'İşlemi uygula' });
  applyButton.addEventListener('click', async () => {
    const selectedAction = roleMode ? $('#bulkMemberAction').value : kind;
    applyButton.disabled = true;
    try {
      const r = await runInChunks(ids, 25, (chunk) => api('/api/mod/bulk', {
        method: 'POST',
        body: {
          action: selectedAction,
          userIds: chunk,
          reason: reason.value,
          roleId: roleMode ? $('#bulkMemberRole').value : null,
          durationMs: duration ? Number(duration.value) : null
        }
      }), (state) => {
        progress.textContent = `İşleniyor: ${state.processed}/${state.total} · ${state.succeeded} başarılı${state.failed ? ` · ${state.failed} başarısız` : ''}`;
      });
      progress.textContent = `Bitti: ${r.processed}/${ids.length} · ${r.succeeded} başarılı${r.failed ? ` · ${r.failed} başarısız` : ''}${r.firstError ? ` · ${r.firstError}` : ''}`;
      toast(`${r.succeeded} başarılı, ${r.failed} başarısız`, r.failed ? 'warn' : 'ok');
      state.selectedMembers.clear();
      loadMembers();
    } catch (e) {
      progress.textContent = `Hata: ${e.message}`;
      toast(e.message, 'err');
    } finally {
      applyButton.disabled = false;
    }
  });
  body.push(progress, applyButton);
  openModal(body);
}

async function openMember(id) {
  openModal([el('div', { class: 'empty' }, [el('div', { class: 'spinner' })])]);
  try {
    const [m, rolesData] = await Promise.all([api(`/api/members/${id}`), api('/api/roles')]);
    state.selectedMember = m;
    state.roles = rolesData.roles;
    renderMemberModal(m);
  } catch (err) {
    openModal([el('div', { class: 'empty', text: err.message })]);
  }
}

function renderMemberModal(m) {
  const head = el('div', { class: 'modal-head' }, [
    el('img', { src: m.avatar }),
    el('div', {}, [
      el('h3', { text: m.displayName }),
      el('div', { class: 'sub', text: `@${m.username} · ${m.id}` })
    ]),
    el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
  ]);

  const info = el('div', { class: 'hint', style: 'margin-bottom:14px' });
  info.innerHTML = `
    Katılım: <b>${new Date(m.joinedAt).toLocaleDateString('tr-TR')}</b> ·
    Hesap: <b>${new Date(m.createdAt).toLocaleDateString('tr-TR')}</b>
    ${m.muted ? `<br /><span style="color:var(--yellow)">${iconSvg('micOff', 'icon icon-sm')} Susturulmuş${m.mutedUntil ? ' — bitiş: ' + new Date(m.mutedUntil).toLocaleString('tr-TR') : ' (kalıcı)'}</span>` : ''}
    ${m.warnings.length ? `<br /><span style="color:var(--red)">${iconSvg('alert', 'icon icon-sm')} ${m.warnings.length} uyarı</span>` : ''}`;

  // --- İşlem seçimi (admin butonları)
  const actions = [
    ['ban', 'ban', 'Yasakla'],
    ['kick', 'userX', 'Sunucudan at'],
    ['mute', 'micOff', 'Sustur'],
    ['unmute', 'mic', 'Susturmayı kaldır'],
    ['warn', 'alert', 'Uyar'],
    ['roles', 'tag', 'Rol ver / al']
  ];
  const actionGrid = el('div', { class: 'action-grid' });
  const detailBox = el('div', { id: 'actionDetail' });

  for (const [key, icon, label] of actions) {
    actionGrid.append(
      el('button', { class: 'action-btn', 'data-action': key, onclick: () => selectAction(key) }, [
        iconEl(icon),
        el('span', { text: label })
      ])
    );
  }

  const roleSection = el('div', { style: 'margin-top:6px' });
  roleSection.innerHTML = `<label class="f">Mevcut roller</label><div id="memberRoles"></div>`;
  const chips = el('div');
  for (const r of m.roles) {
    chips.append(
      el('span', { class: 'role-chip' }, [
        el('span', { class: 'role-dot', style: `background:${r.color === '#000000' ? '#99aab5' : r.color}` }),
        el('span', { text: r.name }),
        el('button', { class: 'x', title: 'Rolü al', onclick: () => removeRole(m.id, r.id, r.name) }, [iconEl('x', 'icon icon-sm')])
      ])
    );
  }
  if (!m.roles.length) chips.append(el('span', { class: 'hint', text: 'Rol yok' }));

  const addRoleRow = el('div', { class: 'row', style: 'margin-top:10px' }, [
    el('select', { class: 'input', id: 'rolePick' }, state.roles.map((r) => el('option', { value: r.id, text: r.name }))),
    el('button', { class: 'btn btn-primary', style: 'flex:0 0 auto', text: '+ Ver', onclick: () => addRole(m.id) })
  ]);

  const warnList = el('div', { style: 'margin-top:14px' });
  if (m.warnings.length) {
    warnList.innerHTML = `<label class="f">Uyarı geçmişi</label>` +
      m.warnings.map((w) => `<div class="log-row"><span class="ic">${iconSvg('alert', 'icon icon-sm')}</span><span class="txt">${esc(w.reason)} <span class="mono">— ${esc(w.by)}</span></span><span class="time">${timeAgo(w.at)}</span></div>`).join('');
  }

  openModal([
    head,
    info,
    el('label', { class: 'f', text: 'İşlem seç' }),
    actionGrid,
    detailBox,
    roleSection,
    warnList
  ]);

  roleSection.append(chips, addRoleRow);

  function selectAction(key) {
    document.querySelectorAll('.action-btn').forEach((b) => b.classList.toggle('sel', b.dataset.action === key));

    if (key === 'roles') {
      detailBox.innerHTML = '';
      if (roleSection.scrollIntoView) roleSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    const box = el('div', { class: 'card', style: 'background:var(--panel-2);margin-bottom:12px' });

    if (key === 'mute') {
      const chipsBox = el('div', { class: 'chip-row', style: 'margin-bottom:12px' });
      const durations = [
        ['60 sn', 60000],
        ['5 dk', 300000],
        ['10 dk', 600000],
        ['1 saat', 3600000],
        ['1 gün', 86400000],
        ['7 gün', 604800000]
      ];
      let chosen = 600000;
      durations.forEach(([label, ms], i) => {
        const chip = el('button', { class: `chip${i === 2 ? ' sel' : ''}`, text: label, onclick: (e) => {
          chosen = ms;
          chipsBox.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
          e.target.classList.add('sel');
        } });
        chipsBox.append(chip);
      });
      box.append(el('label', { class: 'f', text: 'Süre' }), chipsBox);
      box.append(el('label', { class: 'f', text: 'Sebep' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. spam' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-warn btn-block', onclick: () => doMod('mute', m.id, { durationMs: chosen }) }, withIcon('micOff', 'Sustur'))
      ]));
    } else if (key === 'ban') {
      box.append(el('label', { class: 'f', text: 'Sebep' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. kural ihlali' }));
      box.append(el('label', { class: 'f', text: 'Mesaj geçmişi' }), el('select', { class: 'input', id: 'actDelete' }, [
        el('option', { value: '0', text: 'Silme' }),
        el('option', { value: '3600', text: 'Son 1 saat' }),
        el('option', { value: '21600', text: 'Son 6 saat' }),
        el('option', { value: '86400', text: 'Son 24 saat' }),
        el('option', { value: '604800', text: 'Son 7 gün' })
      ]));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-danger btn-block', onclick: () => doMod('ban', m.id) }, withIcon('ban', 'Yasakla'))
      ]));
    } else if (key === 'kick') {
      box.append(el('label', { class: 'f', text: 'Sebep' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. uygunsuz davranış' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-danger btn-block', onclick: () => doMod('kick', m.id) }, withIcon('userX', 'Sunucudan at'))
      ]));
    } else if (key === 'warn') {
      box.append(el('label', { class: 'f', text: 'Uyarı sebebi' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. küfür' }));
      box.append(el('div', { class: 'hint', text: '3 uyarıya ulaşan üye otomatik 30 dk susturulur.' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-warn btn-block', onclick: () => doMod('warn', m.id) }, withIcon('alert', 'Uyarı ver'))
      ]));
    } else if (key === 'unmute') {
      box.append(el('div', { class: 'hint', text: 'Timeout veya susturma rolü kaldırılır.' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-ok btn-block', onclick: () => doMod('unmute', m.id) }, withIcon('mic', 'Susturmayı kaldır'))
      ]));
    }

    detailBox.innerHTML = '';
    detailBox.append(box);
  }
}

async function doMod(action, userId, extra = {}) {
  const reason = $('#actReason') ? $('#actReason').value : '';
  const deleteSeconds = $('#actDelete') ? Number($('#actDelete').value) : 0;
  try {
    const res = await api(`/api/mod/${action}`, { method: 'POST', body: { userId, reason, deleteSeconds, ...extra } });
    if (res.ok) {
      toast(res.message || 'İşlem tamam', 'ok');
      closeModal();
      loadMembers();
    } else {
      toast(res.error || 'İşlem yapılamadı', 'err');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function addRole(userId) {
  const roleId = $('#rolePick').value;
  if (!roleId) return;
  try {
    const res = await api('/api/roles/add', { method: 'POST', body: { userId, roleId } });
    if (res.ok) {
      toast(res.message, 'ok');
      openMember(userId);
    } else toast(res.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function removeRole(userId, roleId, name) {
  try {
    const res = await api('/api/roles/remove', { method: 'POST', body: { userId, roleId } });
    if (res.ok) {
      toast(res.message, 'ok');
      openMember(userId);
    } else toast(res.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================ KANALLAR ============================ */
const CHANNEL_ICONS = { text: 'hash', voice: 'speaker', category: 'folder', announcement: 'megaphone', stage: 'mic', forum: 'message' };
/* Gönderim kuyruğu: tur tur, kanal kanal ilerler. Tur içindeki kanallar sınırlı
   sayıda işçiyle paralel gönderilir; aynı kanala iki mesaj arasında en az
   SEND_MIN_CHANNEL_GAP_MS bırakılır (Discord: kanal başına 5 mesaj / 5 sn,
   genel 50 istek / sn).
   Hız sabit değildir: yanıtlar yavaşlar veya Discord 429 dönerse eşzamanlılık
   yarıya iner, işler tekrar hızlanınca kademeli olarak yükselir. İstekler
   zaman aşımına bağlıdır; hiçbir istek kuyruğu sonsuza kadar kilitleyemez.
   Zaman aşımında tekrar DENENMEZ: yeniden denemek sunucudaki Discord kuyruğunu
   daha da şişirip donmayı beslediği için o kanal atlanır ve sonuçta listelenir. */
const SEND_START_CONCURRENCY = 4;
const SEND_MAX_CONCURRENCY = 6;
const SEND_MIN_CONCURRENCY = 2;
const SEND_RAMP_UP_AFTER = 12;
const SEND_MIN_CHANNEL_GAP_MS = 1100;
const SEND_MAX_REQUESTS_PER_SECOND = 20;
const SEND_REQUEST_TIMEOUT_MS = 45000;
const SEND_SLOW_RESPONSE_MS = 4000;
const SEND_RATE_LIMIT_WAIT_MS = 5000;
const SEND_MAX_RATE_LIMIT_RETRY = 4;

async function loadChannels() {
  try {
    const [d, c] = await Promise.all([api('/api/channels'), api('/api/settings')]);
    state.channels = d.channels;
    state.settings = c;
    state.webhookStatus = d.webhooks
      ? {
        total: d.webhooks.total ?? d.webhooks.eligible,
        ready: d.webhooks.ready,
        preparing: d.webhooks.preparing,
        missing: d.webhooks.missing ?? 0,
        noPerm: d.webhooks.noPerm || 0
      }
      : null;
    const valid = new Set(d.channels.map((ch) => ch.id));
    state.selectedChannels = new Set([...state.selectedChannels].filter((id) => valid.has(id)));
    if ($('#channelCount')) $('#channelCount').textContent = d.channels.length;
    renderChannels();
  } catch (err) {
    $('#channelList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/**
 * Webhook DURUM satırı — burada hiçbir şey oluşturulmaz.
 * Anonymous webhook'ları yalnızca sen istediğinde eklenir: hızlı seçimdeki
 * "Anonymous ekle" düğmesiyle (yalnızca seçili kanallara) veya anonim gönderimde.
 * Kanal seçiliyse seçimin durumu gösterilir.
 */
function renderWebhookStatus() {
  const box = $('#webhookStatus');
  if (!box) return;
  if (webhookProgress) {
    box.textContent = `Anonymous webhook ekleniyor: ${webhookProgress.ready}/${webhookProgress.total} hazır${webhookProgress.preparing ? `, ${webhookProgress.preparing} sürüyor` : ''}.`;
    return;
  }
  const usable = (ch) => ch.anonymousWebhook && ch.anonymousWebhook !== 'yetkisiz';
  const selected = state.channels.filter((ch) => state.selectedChannels.has(ch.id) && usable(ch));
  const scope = selected.length ? selected : state.channels.filter(usable);
  const ready = scope.filter((ch) => ch.anonymousWebhook === 'ready').length;
  const preparing = scope.filter((ch) => ch.anonymousWebhook === 'preparing').length;
  const noPerm = state.channels.filter((ch) => ch.anonymousWebhook === 'yetkisiz').length;
  if (!scope.length && !noPerm) {
    box.textContent = '';
    return;
  }
  const noPermText = noPerm ? ` · ${noPerm} kanalda botun "Webhookları Yönet" yetkisi yok` : '';
  const scopeText = selected.length ? `Seçili ${scope.length} kanalın ${ready} tanesinde` : `${scope.length} metin/duyuru kanalının ${ready} tanesinde`;
  box.textContent = preparing
    ? `Anonymous webhook ekleniyor: ${ready}/${scope.length} hazır, ${preparing} sürüyor.${noPermText}`
    : `Anonymous webhook: ${scopeText} hazır${ready < scope.length ? ' — eksikler için "Anonymous ekle"' : ''}.${noPermText}`;
}

/**
 * Hızlı seçimdeki "Anonymous ekle": YALNIZCA SEÇİLİ kanallara Anonymous webhook'u
 * ekler. Seçim yoksa hiçbir şey yapılmaz — bot kendiliğinden webhook oluşturmaz.
 * Hazırlık sunucuda webhook kapısından yürür, gönderim kapısını meşgul etmez.
 */
async function addAnonymousWebhooks() {
  const btn = $('#addAnonymousBtn');
  const label = btn?.querySelector('span');
  const usable = (ch) => ch.anonymousWebhook && ch.anonymousWebhook !== 'yetkisiz';
  const selected = state.channels.filter((ch) => state.selectedChannels.has(ch.id));
  if (!selected.length) return toast('Önce kanal seç — webhook yalnızca seçtiğin kanallara eklenir', 'warn');

  const targets = selected.filter(usable);
  const skipped = selected.length - targets.length;
  if (!targets.length) return toast('Seçili kanallar arasında metin/duyuru kanalı yok', 'warn');

  const missing = targets.filter((ch) => ch.anonymousWebhook !== 'ready');
  if (!missing.length) return toast(`${targets.length} kanalın Anonymous webhook'u zaten hazır`);

  if (btn) btn.disabled = true;
  const ids = missing.map((ch) => ch.id);
  webhookProgress = { ready: targets.length - missing.length, total: targets.length, preparing: missing.length };
  renderWebhookStatus();

  const done = (message, type) => {
    webhookProgress = null;
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Anonymous ekle';
    renderWebhookStatus();
    if (message) toast(message, type);
  };

  try {
    // Uzun seçimlerde tek dev istek yerine parçalar halinde gönderilir (sınır değil, ilerleme için).
    for (let i = 0; i < ids.length; i += 100) {
      if (label) label.textContent = `Ekleniyor ${Math.min(i + 100, ids.length)}/${ids.length}`;
      await api('/api/channels/webhooks/warm', { method: 'POST', body: { channelIds: ids.slice(i, i + 100) } });
    }
    watchRequestedWebhooks(ids, 80, (s) => {
      loadChannels();
      if (!s) return done(`${ids.length} kanala Anonymous webhook eklenemedi — sunucu loglarına bak`, 'warn');
      const note = skipped ? ` · ${skipped} kanal atlandı (metin kanalı değil veya yetki yok)` : '';
      if (s.missing === 0) done(`${s.ready} kanala Anonymous webhook eklendi${note}`);
      else done(`${s.ready}/${s.total} hazır, ${s.missing} kanala eklenemedi${note}`, 'warn');
    });
  } catch (err) {
    done(err.message || 'Anonymous webhook eklenemedi', 'err');
  }
}

/** İstenen kanalların hazırlığı bitene kadar durumu izler; bitince durur. */
function watchRequestedWebhooks(ids, tries, onSettled, last = null) {
  clearTimeout(webhookStatusTimer);
  if (tries <= 0) {
    if (onSettled) onSettled(last);
    return;
  }
  webhookStatusTimer = setTimeout(() => {
    api('/api/channels/webhooks/status', { method: 'POST', body: { channelIds: ids } })
      .then((r) => {
        webhookProgress = { ready: r.ready, total: r.total, preparing: r.preparing };
        renderWebhookStatus();
        if (r.missing > 0 || r.preparing > 0) watchRequestedWebhooks(ids, tries - 1, onSettled, r);
        else if (onSettled) onSettled(r);
      })
      .catch(() => watchRequestedWebhooks(ids, tries - 1, onSettled, last));
  }, 1500);
}

function updateBulkBar() {
  const bar = $('#bulkActions');
  const cnt = $('#bulkCount');
  if (!bar || !cnt) return;
  const n = state.selectedChannels.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  cnt.textContent = `${n} seçili`;
  renderWebhookStatus();
}

function getFilteredChannels() {
  const q = ($('#channelSearch')?.value || '').trim().toLowerCase();
  if (!q) return state.channels;
  return state.channels.filter((c) => c.name.toLowerCase().includes(q) || (c.topic && c.topic.toLowerCase().includes(q)));
}

function selectChannelsBy(mode) {
  if (mode === 'none') {
    state.selectedChannels.clear();
  } else if (mode === 'all') {
    state.channels.forEach((c) => state.selectedChannels.add(c.id));
  } else if (mode === 'visible') {
    getFilteredChannels().forEach((c) => state.selectedChannels.add(c.id));
  } else if (mode === 'voice') {
    state.channels.filter((c) => c.type === 'voice' || c.type === 'stage').forEach((c) => state.selectedChannels.add(c.id));
  } else if (mode === 'text') {
    state.channels.filter((c) => c.type === 'text' || c.type === 'announcement' || c.type === 'forum').forEach((c) => state.selectedChannels.add(c.id));
  } else if (mode === 'category') {
    state.channels.filter((c) => c.type === 'category').forEach((c) => state.selectedChannels.add(c.id));
  }
  renderChannels();
}

function toggleChannelSelect(id, checked) {
  if (checked) state.selectedChannels.add(id);
  else state.selectedChannels.delete(id);
  updateBulkBar();
}

function toggleCategoryGroup(catId) {
  const ids = [catId, ...state.channels.filter((c) => c.parentId === catId).map((c) => c.id)];
  const allSelected = ids.every((id) => state.selectedChannels.has(id));
  ids.forEach((id) => (allSelected ? state.selectedChannels.delete(id) : state.selectedChannels.add(id)));
  renderChannels();
}

function renderChannels() {
  const box = $('#channelList');
  box.innerHTML = '';
  updateBulkBar();
  renderWebhookStatus();
  if (!state.channels.length) {
    box.innerHTML = '<div class="empty">Kanal yok.</div>';
    return;
  }

  const q = ($('#channelSearch')?.value || '').trim().toLowerCase();
  const matches = (ch) => !q || ch.name.toLowerCase().includes(q) || (ch.topic && ch.topic.toLowerCase().includes(q));

  const categories = state.channels.filter((c) => c.type === 'category');
  const others = state.channels.filter((c) => c.type !== 'category');

  const makeCheck = (id) => {
    const cb = el('input', { type: 'checkbox', class: 'ch-check' });
    cb.checked = state.selectedChannels.has(id);
    cb.addEventListener('change', (e) => toggleChannelSelect(id, e.target.checked));
    return cb;
  };

  const makeRow = (ch) =>
    el('div', { class: 'channel-row' }, [
      makeCheck(ch.id),
      el('span', { class: 'ico' }, [iconEl(CHANNEL_ICONS[ch.type] || 'hash')]),
      el('div', { class: 'nm', html: `${esc(ch.name)}${ch.locked ? ' <span class="tag warnc">KİLİTLİ</span>' : ''}<small>${ch.type}${ch.topic ? ' · ' + esc(ch.topic.slice(0, 60)) : ''}</small>` }),
      el('div', { class: 'acts' }, [
        el('button', { class: 'btn btn-sm', onclick: () => editChannel(ch) }, withIcon('edit', 'Düzenle')),
        el('button', { class: 'btn btn-sm btn-danger', title: 'Sil', onclick: () => deleteChannel(ch) }, [iconEl('trash', 'icon icon-sm')])
      ])
    ]);

  const uncategorized = others.filter((c) => (!c.parentId || !categories.some((cat) => cat.id === c.parentId)) && matches(c));
  if (uncategorized.length) {
    box.append(el('div', { class: 'cat-head', text: 'Kategorisiz' }));
    uncategorized.forEach((ch) => box.append(makeRow(ch)));
  }

  for (const cat of categories) {
    const kids = others.filter((c) => c.parentId === cat.id && matches(c));
    if (q && !matches(cat) && !kids.length) continue;
    const groupIds = [cat.id, ...others.filter((c) => c.parentId === cat.id).map((c) => c.id)];
    const groupAllSelected = groupIds.length > 0 && groupIds.every((id) => state.selectedChannels.has(id));
    box.append(
      el('div', { class: 'cat-head' }, [
        el('div', { class: 'cat-left' }, [
          makeCheck(cat.id),
          el('span', { class: 'cat-name' }, [iconEl('folder', 'icon icon-sm'), el('span', { text: `${cat.name} (${others.filter((c) => c.parentId === cat.id).length})` })]),
          el('button', { class: 'chip', style: 'padding:2px 8px;font-size:11px', text: groupAllSelected ? 'Grubu bırak' : 'Grubu seç', onclick: () => toggleCategoryGroup(cat.id) })
        ]),
        el('div', { class: 'acts', style: 'display:flex;gap:6px' }, [
          el('button', { class: 'btn btn-sm', onclick: () => editChannel(cat) }, withIcon('edit', 'Düzenle')),
          el('button', { class: 'btn btn-sm btn-danger', title: 'Kategoriyi sil', onclick: () => deleteChannel(cat) }, [iconEl('trash', 'icon icon-sm')])
        ])
      ])
    );
    kids.forEach((ch) => box.append(makeRow(ch)));
  }

  if (!box.children.length) {
    box.innerHTML = '<div class="empty">Aramana uyan kanal bulunamadı.</div>';
  }
}

function computeBulkRenameItems(selectedList, mode, val1, val2) {
  return selectedList.map((ch, idx) => {
    let next = ch.name;
    if (mode === 'prefix') next = `${val1}${ch.name}`;
    else if (mode === 'suffix') next = `${ch.name}${val1}`;
    else if (mode === 'replace') next = val1 ? ch.name.split(val1).join(val2) : ch.name;
    else if (mode === 'set') next = val1.replaceAll('{n}', String(idx + 1)).replaceAll('{ad}', ch.name);
    return { channelId: ch.id, oldName: ch.name, name: next.trim().slice(0, 100) };
  });
}

function openBulkRename() {
  const selectedList = state.channels.filter((c) => state.selectedChannels.has(c.id));
  if (!selectedList.length) return toast('Önce kanal veya kategori seç', 'warn');

  let mode = 'prefix';
  const modeLabels = [
    ['prefix', 'Başına ekle'],
    ['suffix', 'Sonuna ekle'],
    ['replace', 'Bul & Değiştir'],
    ['set', 'Hepsini aynı ad yap']
  ];

  const chipsWrap = el('div', { class: 'chip-row', style: 'margin-bottom:12px' });
  const input1Label = el('label', { class: 'f', text: 'Başına eklenecek yazı' });
  const input1 = el('input', { class: 'input', id: 'bulkVal1', placeholder: 'örn: yakında-' });
  const input2Wrap = el('div', { style: 'display:none;margin-top:10px' }, [
    el('label', { class: 'f', text: 'Yerine yazılacak (boş bırakırsan siler)' }),
    el('input', { class: 'input', id: 'bulkVal2', placeholder: 'yeni kelime' })
  ]);
  const hintEl = el('div', { class: 'hint', text: 'Örn: "yakında-" yazarsan genel-sohbet → yakında-genel-sohbet olur.' });
  const previewBox = el('div', { class: 'preview-box', style: 'margin-top:12px' });
  const progressBox = el('div', { class: 'hint', style: 'margin-top:8px;font-weight:600' });
  const applyBtn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px' }, withIcon('edit', `${selectedList.length} öğeye uygula`));

  function updatePreview() {
    const v1 = input1.value;
    const v2 = input2Wrap.querySelector('#bulkVal2').value;
    const items = computeBulkRenameItems(selectedList, mode, v1, v2);
    previewBox.innerHTML = '';
    const sample = items.slice(0, 8);
    for (const it of sample) {
      previewBox.append(
        el('div', { class: 'preview-row' }, [
          el('span', { class: 'old', text: it.oldName }),
          el('span', { text: '→' }),
          el('span', { class: 'new', text: it.name || '(boş)' })
        ])
      );
    }
    if (items.length > 8) {
      previewBox.append(el('div', { class: 'hint', text: `… ve ${items.length - 8} öğe daha` }));
    }
  }

  function setMode(m) {
    mode = m;
    [...chipsWrap.children].forEach((b) => b.classList.toggle('sel', b.dataset.mode === m));
    input2Wrap.style.display = m === 'replace' ? 'block' : 'none';
    if (m === 'prefix') {
      input1Label.textContent = 'Başına eklenecek yazı';
      input1.placeholder = 'örn: yakında-';
      hintEl.textContent = 'Örn: "yakında-" yazarsan genel-sohbet → yakında-genel-sohbet olur.';
    } else if (m === 'suffix') {
      input1Label.textContent = 'Sonuna eklenecek yazı';
      input1.placeholder = 'örn: -yakında';
      hintEl.textContent = 'Örn: "-yakında" yazarsan sohbet → sohbet-yakında olur.';
    } else if (m === 'replace') {
      input1Label.textContent = 'Değiştirilecek kelime';
      input1.placeholder = 'aranan kelime';
      hintEl.textContent = 'Seçilen tüm kanalların adında bu kısmı değiştirir (ikinci kutu boşsa o kısmı siler).';
    } else if (m === 'set') {
      input1Label.textContent = 'Yeni isim';
      input1.placeholder = 'yakında veya yakında-{n}';
      hintEl.textContent = 'Numaralandırmak için {n} kullanabilirsin: yakında-{n} → yakında-1, yakında-2…';
    }
    updatePreview();
  }

  for (const [key, label] of modeLabels) {
    const b = el('button', { class: 'chip', text: label, 'data-mode': key, onclick: () => setMode(key) });
    chipsWrap.append(b);
  }
  input1.addEventListener('input', updatePreview);
  input2Wrap.querySelector('#bulkVal2').addEventListener('input', updatePreview);

  applyBtn.addEventListener('click', async () => {
    const v1 = input1.value;
    const v2 = input2Wrap.querySelector('#bulkVal2').value;
    if (!v1 && mode !== 'replace') return toast('Bir yazı gir', 'warn');
    if (mode === 'replace' && !v1) return toast('Aranacak kelimeyi gir', 'warn');
    const items = computeBulkRenameItems(selectedList, mode, v1, v2).map(({ channelId, name }) => ({ channelId, name }));
    if (items.some((x) => !x.name)) return toast('Bazı isimler boş kalıyor, kontrol et', 'warn');

    applyBtn.disabled = true;
    let updated = 0;
    let skipped = 0;
    let failedCount = 0;
    try {
      for (let i = 0; i < items.length; i += 20) {
        const chunk = items.slice(i, i + 20);
        progressBox.textContent = `İşleniyor: ${Math.min(i + chunk.length, items.length)} / ${items.length}…`;
        const res = await api('/api/channels/bulk/rename', { method: 'POST', body: { items: chunk } });
        if (!res.ok) { toast(res.error, 'err'); break; }
        updated += res.updated || 0;
        skipped += res.skipped || 0;
        failedCount += (res.failed || []).length;
      }
      toast(`${updated} güncellendi${skipped ? `, ${skipped} aynıydı` : ''}${failedCount ? `, ${failedCount} hata` : ''}`, failedCount ? 'warn' : 'ok');
      closeModal();
      loadChannels();
    } catch (err) {
      toast(err.message, 'err');
      applyBtn.disabled = false;
    }
  });

  setMode('prefix');
  openModal([
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: 'Toplu isim değiştir' }), el('div', { class: 'sub', text: `${selectedList.length} kanal / kategori seçili` })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    chipsWrap,
    input1Label,
    input1,
    input2Wrap,
    hintEl,
    el('label', { class: 'f', style: 'margin-top:12px', text: 'Önizleme' }),
    previewBox,
    progressBox,
    applyBtn
  ]);
}

async function bulkSetTopics() {
  const eligible = state.channels.filter((c) => state.selectedChannels.has(c.id) && ['text', 'announcement', 'forum'].includes(c.type));
  if (!eligible.length) return toast('Konu destekleyen metin kanalı seç', 'warn');
  const topic = prompt(`${eligible.length} kanal için yeni konu (boş bırakırsan konular temizlenir):`, '');
  if (topic === null) return;
  try { const r = await api('/api/channels/bulk/topic', { method: 'POST', body: { channelIds: eligible.map((c) => c.id), topic } }); toast(`${r.updated} kanal konusu güncellendi`, r.failed ? 'warn' : 'ok'); loadChannels(); } catch (e) { toast(e.message, 'err'); }
}

function openBulkDelete() {
  const selectedList = state.channels.filter((c) => state.selectedChannels.has(c.id));
  if (!selectedList.length) return toast('Önce silinecek kanal seç', 'warn');

  const hasCat = selectedList.some((c) => c.type === 'category');
  const childCb = el('input', { type: 'checkbox', class: 'ch-check', id: 'bulkDelChildren' });
  const progressBox = el('div', { class: 'hint', style: 'margin-top:8px;font-weight:600' });
  const delBtn = el('button', { class: 'btn btn-danger' }, withIcon('trash', `Evet, ${selectedList.length} öğeyi sil`));

  const body = [
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: `${selectedList.length} öğeyi sil?` }), el('div', { class: 'sub', text: 'Bu işlem geri alınamaz' })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    el('p', { style: 'font-size:13.5px;color:var(--muted);line-height:1.7;margin-bottom:10px', html: `Seçilen <b>${selectedList.length}</b> kanal/kategori ve mesaj geçmişi kalıcı olarak silinecek.` }),
    el('div', { class: 'preview-box', style: 'margin-bottom:12px' },
      selectedList.slice(0, 12).map((c) => el('div', { text: `${CHANNEL_ICONS[c.type] || '•'} ${c.name}` })).concat(
        selectedList.length > 12 ? [el('div', { class: 'hint', text: `… ve ${selectedList.length - 12} öğe daha` })] : []
      )
    )
  ];

  if (hasCat) {
    body.push(
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer' }, [
        childCb,
        el('span', { text: 'Seçili kategorilerin içindeki tüm kanalları da sil' })
      ])
    );
  }

  delBtn.addEventListener('click', async () => {
    delBtn.disabled = true;
    const ids = selectedList.map((c) => c.id);
    const deleteChildren = Boolean(hasCat && childCb.checked);
    let deleted = 0;
    let failedCount = 0;
    try {
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        progressBox.textContent = `Siliniyor: ${Math.min(i + chunk.length, ids.length)} / ${ids.length}…`;
        const res = await api('/api/channels/bulk/delete', { method: 'POST', body: { channelIds: chunk, deleteChildren } });
        if (!res.ok) { toast(res.error, 'err'); break; }
        deleted += res.deleted || 0;
        failedCount += (res.failed || []).length;
      }
      state.selectedChannels.clear();
      toast(`${deleted} kanal/kategori silindi${failedCount ? `, ${failedCount} silinemedi` : ''}`, failedCount ? 'warn' : 'ok');
      closeModal();
      loadChannels();
    } catch (err) {
      toast(err.message, 'err');
      delBtn.disabled = false;
    }
  });

  body.push(progressBox);
  body.push(el('div', { class: 'row', style: 'margin-top:14px' }, [
    el('button', { class: 'btn', text: 'Vazgeç', onclick: closeModal }),
    delBtn
  ]));
  openModal(body);
}

function editChannel(ch) {
  const body = [
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'ico' }, [iconEl(CHANNEL_ICONS[ch.type] || 'hash', 'icon icon-lg')]),
      el('div', {}, [el('h3', { text: 'Kanalı Düzenle' }), el('div', { class: 'sub', text: ch.type })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    el('label', { class: 'f', text: 'Kanal adı' }),
    el('input', { class: 'input', id: 'chName', value: ch.name, maxlength: '100' }),
    el('div', { style: 'height:12px' })
  ];
  if (ch.type === 'text' || ch.type === 'announcement' || ch.type === 'forum') {
    body.push(el('label', { class: 'f', text: 'Kanal konusu' }));
    body.push(el('textarea', { class: 'input', id: 'chTopic', placeholder: 'Kanal açıklaması…', text: ch.topic || '' }));
  }
  if (ch.type === 'text' || ch.type === 'announcement') {
    body.push(el('div', { class: 'channel-control-box' }, [
      el('div', { class: 'channel-control-head' }, [
        el('div', {}, [el('b', { text: 'Kanala mesaj gönder' }), el('span', { text: 'Bot hesabı veya Anonymous webhook üzerinden gönderilir.' })]),
        el('span', { class: `lock-status ${ch.locked ? 'locked' : ''}`, text: ch.locked ? 'Yazmaya kapalı' : 'Yazmaya açık' })
      ]),
      el('textarea', { class: 'input', id: 'channelMessage', rows: '4', maxlength: '2000', placeholder: 'Gönderilecek mesajı yaz…' }),
      el('label', { class: 'f', text: 'Kaç kez gönderilsin?' }),
      el('input', { class: 'input', id: 'channelMessageCount', type: 'number', min: '1', step: '1', value: '1' }),
      el('div', { class: 'hint', text: 'Etiket ayarları her tekrara uygulanır. Discord gönderim hız sınırları geçerlidir; gönderimi durdurabilirsin.' }),
      el('div', { class: 'anonymous-option' }, [
        el('label', { class: 'mention-option' }, [el('input', { type: 'checkbox', id: 'channelAnonymous', checked: true }), el('span', { text: 'Anonymous' })]),
        el('small', { text: 'Gönderici adı yalnızca “Anonymous” olur; panel kullanıcısının adı görünmez.' })
      ]),
      el('div', { class: 'mention-options' }, [
        el('label', { class: 'mention-option' }, [el('input', { type: 'checkbox', id: 'channelAllowMentions', checked: true }), el('span', { text: 'Kullanıcı ve rol etiketlerini etkinleştir' })]),
        el('label', { class: 'mention-option danger' }, [el('input', { type: 'checkbox', id: 'channelAllowEveryone', checked: true }), el('span', { text: '@everyone etiketini etkinleştir' })]),
        el('label', { class: 'mention-option danger' }, [el('input', { type: 'checkbox', id: 'channelAllowHere', checked: true }), el('span', { text: '@here etiketini etkinleştir' })])
      ]),
      el('div', { class: 'hint send-progress', id: 'channelMessageProgress', style: 'min-height:18px;margin:6px 0' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-primary', id: 'channelMessageSend', text: 'Mesajı gönder', onclick: () => sendChannelMessage(ch) }),
        el('button', { class: 'btn btn-danger', id: 'channelMessageStop', text: 'Gönderimi durdur', style: 'display:none' }),
        el('button', { class: `btn ${ch.locked ? 'btn-ok' : 'btn-danger'}`, text: ch.locked ? 'Kanal kilidini aç' : 'Kanalı kilitle', onclick: () => toggleChannelLock(ch) })
      ])
    ]));
  }
  body.push(el('div', { class: 'row', style: 'margin-top:14px' }, [
    el('button', { class: 'btn btn-primary', onclick: () => saveChannel(ch) }, withIcon('save', 'Kaydet')),
    el('button', { class: 'btn btn-danger', onclick: () => { closeModal(); deleteChannel(ch); } }, withIcon('trash', 'Kanalı sil'))
  ]));
  openModal(body);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} sn`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} dk ${seconds} sn` : `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} sa ${restMinutes} dk` : `${hours} sa`;
}

/** Bekleme sırasında durdurma isteği gelirse hemen çözülür. */
function waitWhileActive(ms, isStopped) {
  return new Promise((resolve) => {
    let left = Math.max(0, ms);
    const tick = () => {
      if (isStopped() || left <= 0) return resolve();
      const slice = Math.min(120, left);
      left -= slice;
      setTimeout(tick, slice);
    };
    tick();
  });
}

/** Genel istek hızını saniyede belirlenen sayıda tutar (limit dinamik olabilir). */
function createRequestThrottle(limit) {
  const stamps = [];
  const limitOf = () => Math.max(1, typeof limit === 'function' ? limit() : limit);
  return async (isStopped) => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= 1000) stamps.shift();
      if (stamps.length < limitOf()) {
        stamps.push(now);
        return;
      }
      await waitWhileActive(Math.max(20, 1000 - (now - stamps[0]) + 5), isStopped);
      if (isStopped()) return;
    }
  };
}

/** Yanıt sürelerine göre eşzamanlılığı kendi ayarlayan hız denetleyicisi. */
function createSendPacer() {
  let concurrency = SEND_START_CONCURRENCY;
  let fastStreak = 0;
  return {
    get concurrency() { return concurrency; },
    noteSuccess(latencyMs) {
      if (latencyMs > SEND_SLOW_RESPONSE_MS) return this.notePressure();
      fastStreak += 1;
      if (fastStreak >= SEND_RAMP_UP_AFTER && concurrency < SEND_MAX_CONCURRENCY) {
        concurrency += 1;
        fastStreak = 0;
      }
      return concurrency;
    },
    notePressure() {
      fastStreak = 0;
      concurrency = Math.max(SEND_MIN_CONCURRENCY, Math.floor(concurrency / 2));
      return concurrency;
    }
  };
}

function rateLimitWaitMs(err) {
  const detail = err?.detail || {};
  const seconds = Number(detail.retryAfterSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds * 1000), 60000);
  if (Number(detail.upstreamStatus) === 429) return SEND_RATE_LIMIT_WAIT_MS;
  return /rate.?limit|too many requests|hız sınır/i.test(String(err?.message || '')) ? SEND_RATE_LIMIT_WAIT_MS : 0;
}

function formatSendProgress(state) {
  const parts = [];
  if (state.rounds > 1) parts.push(`Tur ${state.round}/${state.rounds}`);
  if (state.channel) parts.push(`#${state.channel.name}`);
  parts.push(`${state.sent}/${state.total} mesaj`);
  if (state.waitingMs) {
    return `${parts.join(' · ')} · ${state.waitReason || 'Bekleniyor'} (${formatDuration(state.waitingMs)} · hız ${state.concurrency})`;
  }
  if (state.rate) parts.push(`${state.rate}/sn`);
  if (state.concurrency < SEND_MAX_CONCURRENCY) parts.push(`hız ${state.concurrency}`);
  if (state.remainingMs >= 1000) parts.push(`kalan ~${formatDuration(state.remainingMs)}`);
  return parts.join(' · ');
}

/**
 * Seçili kanallara mesajı tur tur gönderir: her turda kanalların her birine bir
 * mesaj, tur bitince bir sonraki tur. Tur içinde kanallar sırayla alınır ama en
 * fazla SEND_MAX_CONCURRENCY işçi aynı anda çalışır; aynı kanala iki mesaj arasında
 * en az SEND_MIN_CHANNEL_GAP_MS bırakılır ve genel istek hızı sınırlanır.
 */
async function sendMessageBatch(channels, content, repeatCount, options, onProgress) {
  if (stopActiveMessageBatch) throw new Error('Önceki gönderimin durması bekleniyor.');
  const total = channels.length * repeatCount;
  if (!channels.length || !Number.isSafeInteger(repeatCount) || repeatCount < 1 || !Number.isSafeInteger(total)) {
    throw new Error('Pozitif ve güvenli bir tam sayı gir.');
  }
  let sent = 0;
  let attempted = 0;
  const failures = [];
  let stopRequested = false;
  const inflight = new Set();
  const stop = () => {
    stopRequested = true;
    for (const controller of inflight) controller.abort();
  };
  stopActiveMessageBatch = stop;

  const failedChannels = new Set();
  const startedAt = Date.now();
  const nextAllowedAt = new Map();
  const pacer = createSendPacer();
  const throttle = createRequestThrottle(() => Math.min(SEND_MAX_REQUESTS_PER_SECOND, pacer.concurrency * 4));
  let waitingMs = 0;
  let waitReason = '';
  let currentChannel = null;
  let currentRound = 1;

  const report = () => {
    if (!onProgress) return;
    const done = sent + failures.length;
    const elapsed = Date.now() - startedAt;
    onProgress({
      sent,
      attempted,
      total,
      failures,
      channel: currentChannel,
      round: currentRound,
      rounds: repeatCount,
      waitingMs,
      waitReason,
      concurrency: pacer.concurrency,
      rate: elapsed > 3000 && sent > 0 ? Math.round((sent / elapsed) * 10000) / 10 : 0,
      remainingMs: done >= 3 && done < total ? Math.round((elapsed / done) * (total - done)) : 0
    });
  };

  /** Aynı kanala art arda gönderim gerekiyorsa Discord sınırına kadar bekler. */
  const waitForChannelSlot = async (channelId) => {
    const readyAt = nextAllowedAt.get(channelId) || 0;
    const wait = readyAt - Date.now();
    if (wait > 0) await waitWhileActive(wait, () => stopRequested);
    nextAllowedAt.set(channelId, Date.now() + SEND_MIN_CHANNEL_GAP_MS);
  };

  /** Beklerken arayüzün donmuş görünmemesi için saniyede bir ilerleme yayınlar. */
  const heartbeat = setInterval(() => report(), 1000);

  // Anonim gönderim webhook gerektirir: bu çağrı YALNIZCA gönderim için seçilen
  // kanalların eksik webhook'larını hazırlar, başka hiçbir kanala dokunmaz.
  if (options.anonymous) {
    api('/api/channels/webhooks/warm', { method: 'POST', body: { channelIds: channels.map((channel) => channel.id) } })
      .catch(() => {});
  }

  const sendOne = async (channel, round) => {
    attempted += 1;
    currentChannel = channel;
    currentRound = round;

    for (let tries = 0; tries <= SEND_MAX_RATE_LIMIT_RETRY; tries += 1) {
      if (stopRequested) return;
      const startedAtMs = Date.now();
      const controller = new AbortController();
      inflight.add(controller);
      const timer = setTimeout(() => controller.abort(), SEND_REQUEST_TIMEOUT_MS);
      try {
        await waitForChannelSlot(channel.id);
        if (stopRequested) return;
        await throttle(() => stopRequested);
        if (stopRequested) return;
        const result = await api('/api/channels/message', {
          method: 'POST',
          signal: controller.signal,
          body: {
            channelId: channel.id,
            content,
            allowMentions: options.allowMentions,
            allowEveryone: options.allowEveryone,
            allowHere: options.allowHere,
            anonymous: options.anonymous
          }
        });
        if (!result.ok) throw new Error(result.error || 'Mesaj gönderilemedi.');
        sent += 1;
        pacer.noteSuccess(Date.now() - startedAtMs);
        return;
      } catch (err) {
        if (stopRequested) return;
        const timedOut = err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''));
        const wait = rateLimitWaitMs(err);

        if (timedOut) {
          // Sunucu bu kanala 45 sn içinde yanıt veremedi: tekrar DENEME.
          // Yeniden denemek sunucudaki Discord kuyruğunu şişirip donmayı besler.
          pacer.notePressure();
          failures.push({ channel: channel.name, error: 'Zaman aşımı: sunucu yoğun, bu kanal atlandı.' });
          failedChannels.add(channel.id);
          return;
        }

        if (wait && tries < SEND_MAX_RATE_LIMIT_RETRY) {
          // Hız sınırı: bu kanalı beklet, genel hızı da düşür; diğer kanallar devam etsin.
          pacer.notePressure();
          nextAllowedAt.set(channel.id, Date.now() + wait);
          waitingMs = wait;
          waitReason = 'Discord hız sınırı bekleniyor';
          report();
          await waitWhileActive(wait, () => stopRequested);
          waitingMs = 0;
          waitReason = '';
          continue;
        }

        failures.push({ channel: channel.name, error: err?.message || 'Mesaj gönderilemedi.' });
        failedChannels.add(channel.id);
        return;
      } finally {
        clearTimeout(timer);
        inflight.delete(controller);
      }
    }
  };

  try {
    for (let round = 1; round <= repeatCount; round += 1) {
      if (stopRequested) break;
      const targets = channels.filter((channel) => !failedChannels.has(channel.id));
      if (!targets.length) break;

      // Tur içinde kanallar sırayla alınır; hız denetleyicisinin izin verdiği kadarı aynı anda gider.
      let nextTask = 0;
      const workerCount = Math.min(SEND_MAX_CONCURRENCY, targets.length);
      const worker = async (slot) => {
        while (!stopRequested) {
          // Turdaki işler tükendiyse bu işçi biter; hız düşse bile burada takılı kalmaz.
          if (nextTask >= targets.length) return;
          if (slot >= pacer.concurrency) {
            await waitWhileActive(150, () => stopRequested);
            continue;
          }
          const index = nextTask++;
          if (index >= targets.length) return;
          await sendOne(targets[index], round);
          report();
        }
      };
      await Promise.all(Array.from({ length: workerCount }, (_, slot) => worker(slot)));
    }
  } finally {
    clearInterval(heartbeat);
    if (stopActiveMessageBatch === stop) stopActiveMessageBatch = null;
  }

  return { sent, attempted, total, failures, stopped: stopRequested, elapsedMs: Date.now() - startedAt };
}

function reportMessageBatchResult(result) {
  const duration = Number(result.elapsedMs) > 0 ? ` · ${formatDuration(result.elapsedMs)}` : '';
  if (result.stopped) {
    return toast(`Gönderim durduruldu: ${result.sent}/${result.total} mesaj gönderildi${duration}.`, 'warn');
  }
  if (result.failures.length) {
    const first = result.failures[0];
    const more = result.failures.length > 1 ? ` Ayrıca ${result.failures.length - 1} hedefte hata var.` : '';
    return toast(`${result.sent}/${result.total} mesaj gönderildi${duration}. #${first.channel}: ${first.error}${more}`, 'warn');
  }
  toast(`${result.sent} mesaj gönderildi${duration}.`, 'ok');
}

async function sendChannelMessage(ch) {
  const input = $('#channelMessage');
  const content = (input?.value || '').trim();
  if (!content) return toast('Gönderilecek mesajı yaz', 'warn');
  const repeatCount = Number($('#channelMessageCount')?.value || 1);
  if (!Number.isSafeInteger(repeatCount) || repeatCount < 1) {
    return toast('Gönderim sayısı pozitif bir tam sayı olmalı.', 'warn');
  }

  const sendButton = $('#channelMessageSend');
  const stopButton = $('#channelMessageStop');
  const progress = $('#channelMessageProgress');
  stopButton.onclick = () => {
    stopActiveMessageBatch?.();
    stopButton.disabled = true;
    progress.textContent = 'Durduruluyor…';
  };
  sendButton.disabled = true;
  stopButton.disabled = false;
  stopButton.style.display = 'inline-flex';
  progress.textContent = 'Gönderim başlıyor…';
  try {
    const result = await sendMessageBatch([ch], content, repeatCount, {
      allowMentions: Boolean($('#channelAllowMentions')?.checked),
      allowEveryone: Boolean($('#channelAllowEveryone')?.checked),
      allowHere: Boolean($('#channelAllowHere')?.checked),
      anonymous: Boolean($('#channelAnonymous')?.checked)
    }, (state) => {
      progress.textContent = formatSendProgress(state);
    });
    if (result.sent === result.total) input.value = '';
    progress.textContent = result.stopped
      ? `Durduruldu: ${result.sent}/${result.total} gönderildi.`
      : `${result.sent}/${result.total} gönderildi · ${formatDuration(result.elapsedMs)}`;
    reportMessageBatchResult(result);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    sendButton.disabled = false;
    stopButton.disabled = false;
    stopButton.style.display = 'none';
  }
}

function openBulkChannelMessage() {
  const channels = state.channels.filter((ch) => state.selectedChannels.has(ch.id) && ['text', 'announcement'].includes(ch.type));
  if (!channels.length) return toast('Toplu mesaj için metin veya duyuru kanalı seç.', 'warn');

  const messageInput = el('textarea', { class: 'input', id: 'bulkChannelMessage', rows: '4', maxlength: '2000', placeholder: 'Gönderilecek mesajı yaz…' });
  const countInput = el('input', { class: 'input', id: 'bulkChannelMessageCount', type: 'number', min: '1', step: '1', value: '1' });
  const anonymousInput = el('input', { type: 'checkbox', id: 'bulkChannelAnonymous', checked: true });
  const mentionInput = el('input', { type: 'checkbox', id: 'bulkChannelAllowMentions', checked: true });
  const everyoneInput = el('input', { type: 'checkbox', id: 'bulkChannelAllowEveryone', checked: true });
  const hereInput = el('input', { type: 'checkbox', id: 'bulkChannelAllowHere', checked: true });
  const progress = el('div', { class: 'hint send-progress', style: 'min-height:18px;margin:6px 0' });
  const stopButton = el('button', { class: 'btn btn-danger', text: 'Gönderimi durdur', style: 'display:none' });
  const sendButton = el('button', { class: 'btn btn-primary', text: `Toplu gönder (${channels.length} kanal)` });

  sendButton.addEventListener('click', async () => {
    const content = messageInput.value.trim();
    if (!content) return toast('Gönderilecek mesajı yaz.', 'warn');
    const repeatCount = Number(countInput.value);
    const total = channels.length * repeatCount;
    if (!Number.isSafeInteger(repeatCount) || repeatCount < 1 || !Number.isSafeInteger(total)) {
      return toast('Kanal başına pozitif ve güvenli bir tam sayı gir.', 'warn');
    }

    stopButton.onclick = () => {
      stopActiveMessageBatch?.();
      stopButton.disabled = true;
      progress.textContent = 'Durduruluyor…';
    };
    sendButton.disabled = true;
    stopButton.disabled = false;
    stopButton.style.display = 'inline-flex';
    progress.textContent = 'Toplu gönderim başlıyor…';
    try {
      const result = await sendMessageBatch(channels, content, repeatCount, {
        allowMentions: mentionInput.checked,
        allowEveryone: everyoneInput.checked,
        allowHere: hereInput.checked,
        anonymous: anonymousInput.checked
      }, (state) => {
        progress.textContent = formatSendProgress(state);
      });
      if (result.sent === result.total) messageInput.value = '';
      progress.textContent = result.stopped
        ? `Durduruldu: ${result.sent}/${result.total} gönderildi.`
        : `${result.sent}/${result.total} gönderildi · ${formatDuration(result.elapsedMs)}`;
      reportMessageBatchResult(result);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      sendButton.disabled = false;
      stopButton.disabled = false;
      stopButton.style.display = 'none';
    }
  });

  openModal([
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: 'Toplu mesaj gönder' }), el('div', { class: 'sub', text: `${channels.length} metin/duyuru kanalı seçili` })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    el('label', { class: 'f', text: 'Mesaj' }),
    messageInput,
    el('label', { class: 'f', text: 'Her kanala kaç kez?' }),
    countInput,
    el('div', { class: 'hint', text: `Gönderim tur tur ilerler: her turda ${channels.length} kanalın her birine bir mesaj atılır, tur bitince sonraki tura geçilir. Kanallar sırayla alınır, aynı anda en fazla ${SEND_MAX_CONCURRENCY} istek gider; aynı kanala iki mesaj arasında en az ${Math.round(SEND_MIN_CHANNEL_GAP_MS / 100) / 10} sn bırakılır. Discord hız sınırı veya yavaş yanıt görülürse hız kendini düşürür, işler açılınca tekrar yükseltir; ${SEND_REQUEST_TIMEOUT_MS / 1000} sn içinde yanıt vermeyen kanal tekrar denenmez, atlanır ve sonuçta listelenir — böylece kuyruk hiç kilitlenmez.${anonymousInput.checked ? ' Anonim modda webhook’u olmayan kanallara webhook bu gönderimde eklenir; önceden eklemek için hızlı seçimdeki “Anonymous ekle” düğmesini kullan.' : ''}` }),
    el('div', { class: 'anonymous-option' }, [
      el('label', { class: 'mention-option' }, [anonymousInput, el('span', { text: 'Anonymous' })]),
      el('small', { text: 'Gönderici adı yalnızca “Anonymous” olur.' })
    ]),
    el('div', { class: 'mention-options' }, [
      el('label', { class: 'mention-option' }, [mentionInput, el('span', { text: 'Kullanıcı ve rol etiketleri' })]),
      el('label', { class: 'mention-option danger' }, [everyoneInput, el('span', { text: '@everyone etiketi' })]),
      el('label', { class: 'mention-option danger' }, [hereInput, el('span', { text: '@here etiketi' })])
    ]),
    progress,
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', text: 'Vazgeç', onclick: closeModal }),
      stopButton,
      sendButton
    ])
  ]);
}

async function toggleChannelLock(ch) {
  try {
    const r = await api('/api/channels/lock', { method: 'POST', body: { channelId: ch.id, locked: !ch.locked } });
    if (!r.ok) return toast(r.error || 'Kanal güncellenemedi', 'err');
    ch.locked = r.locked;
    toast(r.message, 'ok');
    editChannel(ch);
    loadChannels();
  } catch (err) { toast(err.message, 'err'); }
}

async function saveChannel(ch) {
  const name = $('#chName').value.trim();
  const topicEl = $('#chTopic');
  try {
    if (name && name !== ch.name) {
      const r = await api('/api/channels/rename', { method: 'POST', body: { channelId: ch.id, name } });
      if (!r.ok) return toast(r.error, 'err');
    }
    if (topicEl && topicEl.value !== (ch.topic || '')) {
      const r = await api('/api/channels/topic', { method: 'POST', body: { channelId: ch.id, topic: topicEl.value } });
      if (!r.ok) return toast(r.error, 'err');
    }
    toast('Kanal güncellendi', 'ok');
    closeModal();
    loadChannels();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function deleteChannel(ch) {
  openModal([
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Kanalı sil?' })])]),
    el('p', { style: 'font-size:13.5px;color:var(--muted);line-height:1.8;margin-bottom:18px', html: `<b>#${esc(ch.name)}</b> kanalı ve içindeki tüm mesajlar kalıcı olarak silinecek.` }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn', text: 'Vazgeç', onclick: closeModal }),
      el('button', { class: 'btn btn-danger', text: 'Evet, sil', onclick: async () => {
        try {
          const r = await api('/api/channels/delete', { method: 'POST', body: { channelId: ch.id } });
          if (r.ok) { toast(r.message, 'ok'); closeModal(); loadChannels(); }
          else toast(r.error, 'err');
        } catch (err) { toast(err.message, 'err'); }
      } })
    ])
  ]);
}

function openChannelCreate() {
  openModal([
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: 'Kanal oluştur' }), el('div', { class: 'sub', text: 'Metin, ses veya kategori' })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    el('label', { class: 'f', text: 'Kanal adı' }),
    el('input', { class: 'input', id: 'newChName', placeholder: 'genel-sohbet' }),
    el('div', { style: 'height:12px' }),
    el('label', { class: 'f', text: 'Tür' }),
    el('select', { class: 'input', id: 'newChType' }, [
      el('option', { value: 'text', text: 'Metin kanalı' }),
      el('option', { value: 'voice', text: 'Ses kanalı' }),
      el('option', { value: 'category', text: 'Kategori' }),
      el('option', { value: 'announcement', text: 'Duyuru kanalı' })
    ]),
    el('div', { style: 'height:12px' }),
    el('label', { class: 'f', text: 'Kategori (opsiyonel)' }),
    el('select', { class: 'input', id: 'newChParent' }, [
      el('option', { value: '', text: '— yok —' }),
      ...state.channels.filter((c) => c.type === 'category').map((c) => el('option', { value: c.id, text: c.name }))
    ]),
    el('div', { style: 'margin-top:16px' }, [
      el('button', { class: 'btn btn-primary btn-block', text: 'Oluştur', onclick: async () => {
        const name = $('#newChName').value.trim();
        const type = $('#newChType').value;
        const categoryId = $('#newChParent').value || null;
        if (!name) return toast('Kanal adı gerekli', 'warn');
        try {
          const r = await api('/api/channels/create', { method: 'POST', body: { name, type, categoryId } });
          if (r.ok) { toast(r.message, 'ok'); closeModal(); loadChannels(); }
          else toast(r.error, 'err');
        } catch (err) { toast(err.message, 'err'); }
      } })
    ])
  ]);
}

function openBulkChannelCreate() {
  const categories = state.channels.filter((c) => c.type === 'category');
  const namesInput = el('textarea', { class: 'input', id: 'bulkChannelNames', rows: '9', placeholder: 'genel-sohbet\noyun-odası\nmüzik\nyayıncılar' });
  const typeInput = el('select', { class: 'input', id: 'bulkChannelType' }, [
    el('option', { value: 'text', text: 'Metin kanalı' }),
    el('option', { value: 'voice', text: 'Ses kanalı' }),
    el('option', { value: 'category', text: 'Kategori' }),
    el('option', { value: 'announcement', text: 'Duyuru kanalı' })
  ]);
  const parentInput = el('select', { class: 'input', id: 'bulkChannelParent' }, [
    el('option', { value: '', text: 'Kategori yok' }),
    ...categories.map((c) => el('option', { value: c.id, text: c.name }))
  ]);
  const progress = el('div', { class: 'hint', style: 'min-height:18px;margin:8px 0' });
  const createButton = el('button', { class: 'btn btn-primary', text: 'Kanalları oluştur' });
  const stopButton = el('button', { class: 'btn btn-danger', text: 'Durdur', style: 'display:none' });

  createButton.addEventListener('click', async () => {
    const names = namesInput.value.split(/\n|,/).map((name) => name.trim()).filter(Boolean);
    if (!names.length) return toast('En az bir kanal adı gir.', 'warn');
    if (stopActiveChannelCreation) return toast('Önceki toplu oluşturma bitene kadar bekle.', 'warn');

    const type = typeInput.value;
    const categoryId = parentInput.value || null;
    let stopRequested = false;
    const stop = () => { stopRequested = true; };
    stopActiveChannelCreation = stop;
    let created = 0;
    let failed = 0;
    let processed = 0;
    let firstError = '';
    createButton.disabled = true;
    stopButton.disabled = false;
    stopButton.style.display = 'inline-flex';

    try {
      const chunkSize = 10;
      for (let index = 0; index < names.length; index += chunkSize) {
        if (stopRequested) break;
        const chunk = names.slice(index, index + chunkSize);
        try {
          const result = await api('/api/channels/bulk/create', {
            method: 'POST',
            body: { names: chunk, type, categoryId }
          });
          created += result.created || 0;
          failed += result.failed || 0;
          if (!firstError && result.results?.length) firstError = result.results.find((item) => !item.ok)?.error || '';
        } catch (err) {
          failed += chunk.length;
          if (!firstError) firstError = err.message;
          break;
        }
        processed += chunk.length;
        progress.textContent = `İşlendi: ${processed}/${names.length} · ${created} oluşturuldu${failed ? ` · ${failed} başarısız` : ''}`;
      }
      const stateText = stopRequested ? 'Durduruldu' : 'Tamamlandı';
      progress.textContent = `${stateText}: ${processed}/${names.length} işlendi · ${created} oluşturuldu${failed ? ` · ${failed} başarısız` : ''}${firstError ? ` · ${firstError}` : ''}`;
      toast(`${created} kanal oluşturuldu${failed ? `, ${failed} başarısız` : ''}${stopRequested ? ' · işlem durduruldu' : ''}`, failed ? 'warn' : 'ok');
      if (created) loadChannels();
    } catch (err) {
      toast(err.message || 'Toplu kanal oluşturma başarısız.', 'err');
    } finally {
      if (stopActiveChannelCreation === stop) stopActiveChannelCreation = null;
      createButton.disabled = false;
      stopButton.disabled = false;
      stopButton.style.display = 'none';
    }
  });

  stopButton.addEventListener('click', () => {
    stopActiveChannelCreation?.();
    stopButton.disabled = true;
    progress.textContent = 'Durduruluyor…';
  });

  openModal([
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: 'Toplu kanal oluştur' }), el('div', { class: 'sub', text: 'Her satıra bir kanal adı; aynı ad birden fazla kez kullanılabilir. Discord sunucu sınırları geçerlidir.' })]),
      el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])
    ]),
    el('label', { class: 'f', text: 'Kanal adları' }),
    namesInput,
    el('div', { class: 'row', style: 'margin-top:12px' }, [typeInput, parentInput]),
    progress,
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', text: 'Vazgeç', onclick: closeModal }),
      stopButton,
      createButton
    ])
  ]);
}

async function loadBans() {
  try {
    const d = await api('/api/bans');
    $('#banCount').textContent = d.bans.length;
    const box = $('#banList');
    box.innerHTML = '';
    if (!d.bans.length) {
      box.innerHTML = '<div class="empty">Yasaklı üye yok.</div>';
      return;
    }
    for (const b of d.bans) {
      box.append(
        el('div', { class: 'channel-row' }, [
          el('img', { src: b.avatar, style: 'width:26px;height:26px;border-radius:50%' }),
          el('div', { class: 'nm', html: `${esc(b.username)}<small>${esc(b.reason || 'sebep yok')}</small>` }),
          el('button', { class: 'btn btn-sm btn-ok', text: 'Yasağı kaldır', onclick: async () => {
            try {
              const r = await api('/api/mod/unban', { method: 'POST', body: { userId: b.id, reason: 'panelden kaldırıldı' } });
              if (r.ok) { toast(r.message, 'ok'); loadBans(); loadChannels(); }
              else toast(r.error, 'err');
            } catch (err) { toast(err.message, 'err'); }
          } })
        ])
      );
    }
  } catch (err) {
    $('#banList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

async function quickUnban() {
  const id = $('#unbanInput').value.trim();
  if (!id) return toast('Kullanıcı ID gir', 'warn');
  try {
    const r = await api('/api/mod/unban', { method: 'POST', body: { userId: id, reason: 'panelden kaldırıldı' } });
    if (r.ok) { toast(r.message, 'ok'); $('#unbanInput').value = ''; loadBans(); }
    else toast(r.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function openBulkUnban() {
  openModal([
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Toplu yasak kaldırma' }), el('div', { class: 'sub', text: 'Her satıra bir Discord kullanıcı ID’si' })]), el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])]),
    el('textarea', { class: 'input', id: 'bulkUnbanIds', rows: '7', placeholder: '123456789012345678\n987654321098765432' }),
    el('input', { class: 'input', id: 'bulkUnbanReason', style: 'margin-top:10px', placeholder: 'Sebep (opsiyonel)' }),
    (() => {
      const progress = el('div', { class: 'hint send-progress', style: 'min-height:18px;margin:10px 0 0' });
      const button = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Yasakları kaldır' });
      button.addEventListener('click', async () => {
        const userIds = [...new Set($('#bulkUnbanIds').value.split(/\s|,/).map((x) => x.trim()).filter(Boolean))];
        if (!userIds.length) return toast('Kullanıcı ID’si gir', 'warn');
        button.disabled = true;
        try {
          const r = await runInChunks(userIds, 25, (chunk) => api('/api/mod/bulk', {
            method: 'POST',
            body: { action: 'unban', userIds: chunk, reason: $('#bulkUnbanReason').value }
          }), (state) => {
            progress.textContent = `İşleniyor: ${state.processed}/${state.total} · ${state.succeeded} kaldırıldı${state.failed ? ` · ${state.failed} başarısız` : ''}`;
          });
          progress.textContent = `Bitti: ${r.processed}/${userIds.length} · ${r.succeeded} kaldırıldı${r.failed ? ` · ${r.failed} başarısız` : ''}`;
          toast(`${r.succeeded} yasak kaldırıldı, ${r.failed} başarısız`, r.failed ? 'warn' : 'ok');
          loadBans();
        } catch (e) {
          progress.textContent = `Hata: ${e.message}`;
          toast(e.message, 'err');
        } finally {
          button.disabled = false;
        }
      });
      return [progress, button];
    })()
  ]);
}

/* ============================ ROLLER ============================ */
async function loadRoles() {
  try {
    const d = await api('/api/roles');
    state.roles = d.roles;
    const valid = new Set(d.roles.filter((r) => !r.managed).map((r) => r.id));
    state.selectedRoles = new Set([...state.selectedRoles].filter((id) => valid.has(id)));
    const box = $('#roleList');
    box.innerHTML = '';
    if (!d.roles.length) {
      box.innerHTML = '<div class="empty">Rol yok.</div>';
      return;
    }
    for (const r of d.roles) {
      box.append(
        el('div', { class: `channel-row${state.selectedRoles.has(r.id) ? ' selected' : ''}` }, [
          !r.managed && el('input', { type: 'checkbox', class: 'role-select', checked: state.selectedRoles.has(r.id) ? 'checked' : null, onchange: (e) => { e.target.checked ? state.selectedRoles.add(r.id) : state.selectedRoles.delete(r.id); updateRoleBulkCount(); } }),
          el('span', { class: 'role-dot', style: `background:${r.color === '#000000' ? '#99aab5' : r.color};width:12px;height:12px` }),
          el('div', { class: 'nm', html: `${esc(r.name)}<small>${r.memberCount} üye · sıra ${r.position}${r.managed ? ' · bot rolü' : ''}</small>` }),
          el('div', { class: 'acts' }, [
            !r.managed && el('button', { class: 'btn btn-sm', text: 'Düzenle', onclick: () => editRole(r) }),
            !r.managed && el('button', { class: 'btn btn-sm btn-danger', text: 'Sil', title: 'Rolü sil', onclick: () => deleteRole(r) })
          ])
        ])
      );
    }
    updateRoleBulkCount();
  } catch (err) {
    $('#roleList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function updateRoleBulkCount() { if ($('#roleBulkCount')) $('#roleBulkCount').textContent = `${state.selectedRoles.size} seçili`; }
function selectRoles(mode) { state.selectedRoles.clear(); if (mode === 'all') state.roles.filter((r) => !r.managed).forEach((r) => state.selectedRoles.add(r.id)); loadRoles(); }
async function bulkRenameRoles(mode) {
  if (!state.selectedRoles.size) return toast('Önce rol seç', 'warn');
  const value = prompt(mode === 'prefix' ? 'Eklenecek ön ek:' : 'Eklenecek son ek:');
  if (!value) return;
  try { const r = await api('/api/roles/bulk', { method: 'POST', body: { action: 'rename', roleIds: [...state.selectedRoles], mode, value } }); toast(`${r.succeeded} rol güncellendi`, r.failed ? 'warn' : 'ok'); state.selectedRoles.clear(); loadRoles(); } catch (e) { toast(e.message, 'err'); }
}
async function bulkDeleteRoles() {
  if (!state.selectedRoles.size) return toast('Önce rol seç', 'warn');
  if (!confirm(`${state.selectedRoles.size} rol kalıcı olarak silinsin mi?`)) return;
  try { const r = await api('/api/roles/bulk', { method: 'POST', body: { action: 'delete', roleIds: [...state.selectedRoles] } }); toast(`${r.succeeded} rol silindi`, r.failed ? 'warn' : 'ok'); state.selectedRoles.clear(); loadRoles(); } catch (e) { toast(e.message, 'err'); }
}
function openBulkRoleCreate() {
  openModal([
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Toplu rol oluştur' }), el('div', { class: 'sub', text: 'Her satıra bir rol adı' })]), el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])]),
    el('textarea', { class: 'input', id: 'bulkRoleNames', rows: '8', placeholder: 'Yönetici\nModeratör\nVIP\nÜye' }),
    el('label', { class: 'f', style: 'margin-top:12px', text: 'Rol rengi' }), el('input', { type: 'color', class: 'input', id: 'bulkRoleColor', value: '#5865f2', style: 'height:44px' }),
    (() => {
      const progress = el('div', { class: 'hint send-progress', style: 'min-height:18px;margin:10px 0 0' });
      const button = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Rolleri oluştur' });
      button.addEventListener('click', async () => {
        const names = $('#bulkRoleNames').value.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
        if (!names.length) return toast('Rol adı gir', 'warn');
        const color = $('#bulkRoleColor').value;
        button.disabled = true;
        try {
          const r = await runInChunks(names, 25, (chunk) => api('/api/roles/bulk', {
            method: 'POST',
            body: { action: 'create', items: chunk.map((name) => ({ name, color })) }
          }), (state) => {
            progress.textContent = `İşleniyor: ${state.processed}/${state.total} · ${state.succeeded} oluşturuldu${state.failed ? ` · ${state.failed} başarısız` : ''}`;
          });
          progress.textContent = `Bitti: ${r.processed}/${names.length} · ${r.succeeded} oluşturuldu${r.failed ? ` · ${r.failed} başarısız` : ''}${r.firstError ? ` · ${r.firstError}` : ''}`;
          toast(`${r.succeeded} rol oluşturuldu${r.failed ? `, ${r.failed} başarısız` : ''}`, r.failed ? 'warn' : 'ok');
          loadRoles();
        } catch (e) {
          progress.textContent = `Hata: ${e.message}`;
          toast(e.message, 'err');
        } finally {
          button.disabled = false;
        }
      });
      return [progress, button];
    })()
  ]);
}
function editRole(role) {
  openModal([el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Rolü düzenle' }), el('div', { class: 'sub', text: role.name })]), el('button', { class: 'modal-close', title: 'Kapat', onclick: closeModal }, [iconEl('x', 'icon icon-sm')])]), el('label', { class: 'f', text: 'Rol adı' }), el('input', { class: 'input', id: 'editRoleName', value: role.name }), el('label', { class: 'f', style: 'margin-top:12px', text: 'Renk' }), el('input', { type: 'color', class: 'input', id: 'editRoleColor', value: role.color === '#000000' ? '#99aab5' : role.color, style: 'height:44px' }), el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Kaydet', onclick: async () => { try { const r = await api('/api/roles/edit', { method: 'POST', body: { roleId: role.id, name: $('#editRoleName').value, color: $('#editRoleColor').value } }); toast(r.message, 'ok'); closeModal(); loadRoles(); } catch (e) { toast(e.message, 'err'); } } })]);
}

async function createRole() {
  const name = $('#newRoleName').value.trim();
  const color = $('#newRoleColor').value;
  if (!name) return toast('Rol adı gir', 'warn');
  try {
    const r = await api('/api/roles/create', { method: 'POST', body: { name, color } });
    if (r.ok) {
      toast(r.message, 'ok');
      $('#newRoleName').value = '';
      loadRoles();
    } else toast(r.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteRole(role) {
  if (!confirm(`"${role.name}" rolü silinsin mi? (${role.memberCount} üyeden kaldırılacak)`)) return;
  try {
    const r = await api('/api/roles/delete', { method: 'POST', body: { roleId: role.id } });
    if (r.ok) { toast(r.message, 'ok'); loadRoles(); }
    else toast(r.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================ OYUNLAR ============================ */
async function loadGame() {
  try {
    const d = await api('/api/play/balance');
    $('#myStats').innerHTML = `
      <div><b>Coin:</b> ${d.coins}</div>
      <div><b>Oynanan oyun:</b> ${d.games}</div>
      <div><b>Kazanç:</b> ${d.wins} · <b>Kayıp:</b> ${d.losses}</div>
      <div><b>Sıralama:</b> ${d.rank ? '#' + d.rank : '—'}</div>`;
    const board = $('#leaderboard');
    board.innerHTML = '';
    if (!d.leaderboard.length) {
      board.innerHTML = '<div class="empty">Henüz kimse oynamamış.</div>';
    } else {
      d.leaderboard.forEach((u, i) => {
        board.append(
          el('div', { class: 'leader-row' }, [
            el('span', { class: i < 3 ? 'rank top' : 'rank', text: String(i + 1) }),
            u.avatar ? el('img', { src: u.avatar }) : el('div', {}),
            el('span', { text: u.name }),
            el('span', { class: 'coins' }, [el('span', { text: String(u.coins) }), el('span', { text: 'coin' })])
          ])
        );
      });
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function playCoinflip(pick) {
  const bet = Number($('#othBet').value);
  if (!bet || bet < 10) return toast('Bahis en az 10 coin olmalı', 'warn');
  try {
    const res = await api('/api/play/coinflip', { method: 'POST', body: { bet, pick } });
    if (res.error) return toast(res.error, 'err');
    $('#othMsg').innerHTML = `Sonuç: <b>${res.result}</b> — ${res.won ? `<span style="color:var(--green)">+${res.payout} coin</span>` : `<span style="color:var(--red)">-${res.bet} coin</span>`} · Bakiye: ${res.balance}`;
    toast(res.won ? `Kazandın! +${res.payout} coin` : `Kaybettin -${res.bet} coin`, res.won ? 'ok' : 'err');
    loadGame();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function playDice() {
  const bet = Number($('#othBet').value);
  const guess = Number($('#diceGuess').value);
  if (!bet || bet < 10) return toast('Bahis en az 10 coin olmalı', 'warn');
  try {
    const res = await api('/api/play/dice', { method: 'POST', body: { bet, guess } });
    if (res.error) return toast(res.error, 'err');
    $('#othMsg').innerHTML = `Zar: <b>${res.result}</b> — ${res.won ? `<span style="color:var(--green)">+${res.payout} coin</span>` : `<span style="color:var(--red)">-${res.bet} coin</span>`} · Bakiye: ${res.balance}`;
    loadGame();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function claimDaily() {
  try {
    const res = await api('/api/play/daily', { method: 'POST' });
    if (res.ok) {
      toast(`+${res.amount} coin aldın.`, 'ok');
      loadGame();
    } else {
      const h = Math.floor(res.remaining / 3600000);
      const m = Math.floor((res.remaining % 3600000) / 60000);
      toast(`Günlük ödül için ${h}s ${m}dk bekle`, 'warn');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================ AYARLAR ============================ */
async function loadSettings() {
  try {
    const d = await api('/api/settings');
    const opts = (list, selected) => [
      el('option', { value: '', text: '— kapalı —' }),
      ...list.map((c) => el('option', { value: c.id, text: c.name, selected: c.id === selected ? '' : null }))
    ];
    const setSel = (id, list, val) => {
      const node = $(id);
      node.innerHTML = '';
      opts(list, val).forEach((o) => node.append(o));
      node.value = val || '';
    };
    setSel('#setLogChannel', d.textChannels, d.settings.logChannelId);
    setSel('#setWelcomeChannel', d.textChannels, d.settings.welcomeChannelId);
    setSel('#setAutoRole', d.roles, d.settings.autoRoleId);
    $('#setWelcomeMsg').value = d.settings.welcomeMessage || '';
    $('#setPrefix').value = d.settings.prefix || '!';
    loadDashboard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveSettings() {
  try {
    const body = {
      logChannelId: $('#setLogChannel').value || null,
      welcomeChannelId: $('#setWelcomeChannel').value || null,
      welcomeMessage: $('#setWelcomeMsg').value,
      autoRoleId: $('#setAutoRole').value || null,
      prefix: $('#setPrefix').value || '!'
    };
    const r = await api('/api/settings', { method: 'POST', body });
    if (r.ok) toast('Ayarlar kaydedildi', 'ok');
    else toast(r.error, 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================ GUARD (KORUMA) ============================
   Gerçek zamanlı koruma paneli: modül kartları, honeypot, reklam motoru,
   eşikler, trend grafiği, limitler ve canlı olay akışı.                      */
let guardData = null;
const GUARD_SEVERITY = { high: 'YÜKSEK', medium: 'ORTA', low: 'BİLGİ' };

const GUARD_MODULE_ICON = {
  antiNuke: 'shield', antiRaid: 'users', channelGuard: 'hash', roleGuard: 'tag',
  webhookGuard: 'link', botGuard: 'bot', spamGuard: 'message', adGuard: 'megaphone',
  mentionGuard: 'alert', honeypot: 'lock', accountGuard: 'userX'
};

async function loadGuard() {
  try {
    guardData = await api('/api/guard');
    renderGuard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function guardSet(sel, value) {
  const node = $(sel);
  if (node) node.value = value;
}

function renderGuard() {
  if (!guardData) return;
  const cfg = guardData.guard;
  const s = guardData.summary || {};
  const admin = guardData.admin || {};
  const stats = s.stats || {};

  const on = Boolean(cfg.enabled);
  const truth = admin.operational === false && admin.status
    ? (admin.status === 'pending'
      ? 'Koruma bu sunucuda henüz etkin değil (operatör onayı bekliyor). Ayar ve limitler kayıtlıdır; onaylanınca otomatik devreye girer. '
      : admin.status === 'silent'
        ? 'Koruma bu sunucuda operatör tarafından sessize alınmış. '
        : '')
    : '';

  // HERO
  const hero = $('#guardHero');
  if (hero) {
    hero.classList.toggle('off', !on);
    hero.classList.toggle('danger', on && ((s.violations24h || 0) > 8 || admin.status === 'silent'));
  }
  const live = $('#guardLive');
  if (live) {
    live.classList.toggle('off', !on);
    live.innerHTML = `<i></i> ${on ? 'CANLI' : 'KAPALI'}`;
  }
  const power = $('#guardToggleBtn');
  if (power) {
    power.classList.toggle('on', on);
    const label = $('#guardPowerLabel');
    if (label) label.textContent = on ? 'Koruma açık' : 'Korumayı aç';
  }

  const sub = $('#guardHeroSub');
  if (sub) {
    sub.innerHTML = truth + (on
      ? `${s.modulesActive || 0}/${s.modulesTotal || 0} modül izliyor · ana ceza <b>${esc(s.punishmentLabel || '—')}</b> · pencere ${cfg.windowSeconds} sn. İhlalde otomatik müdahale aktif.`
      : 'Koruma kapalı. Açtığında modüller izlemeye başlar ve ihlallerde otomatik ceza uygulanır.');
  }

  const chips = $('#guardHeroChips');
  if (chips) {
    chips.innerHTML = '';
    const chip = (icon, text, cls = '') => el('span', { class: `guard-chip ${cls}` }, [iconEl(icon, 'icon'), el('span', { text })]);
    chips.append(chip('shield', `${s.modulesActive || 0}/${s.modulesTotal || 0} modül`, 'on'));
    chips.append(chip('megaphone', `Reklam ${stats.ads || 0}`, ''));
    chips.append(chip('lock', `Honeypot ${cfg.honeypot?.hits || 0}`, cfg.honeypot?.channelId ? 'on' : 'warn'));
    chips.append(chip('alert', `Müdahale ${stats.blocked || 0}`, ''));
    chips.append(chip('message', `Silinen ${stats.deleted || 0}`, ''));
    if (admin.status && admin.status !== 'active') {
      chips.append(chip('eye', admin.status === 'silent' ? 'Sessiz mod' : 'Onay bekliyor', 'warn'));
    }
  }

  // KPI'lar
  const kpis = $('#guardKpis');
  if (kpis) {
    kpis.innerHTML = '';
    const kpi = (icon, label, value, sub2, cls = '', color = '') => el('div', { class: `guard-kpi ${cls}`, style: color ? `--k:${color}` : '' }, [
      el('div', { class: 'k-top' }, [iconEl(icon, 'icon'), el('span', { text: label })]),
      el('div', { class: 'k-val', text: String(value) }),
      el('div', { class: 'k-sub', text: sub2 })
    ]);
    kpis.append(kpi('alert', 'Müdahale', stats.blocked || 0, `${stats.timeouts || 0} timeout · ${stats.bans || 0} ban`, 'hot', '#ff5d73'));
    kpis.append(kpi('message', 'Silinen mesaj', stats.deleted || 0, `${stats.ads || 0} reklam · ${stats.honeypot || 0} tuzak`, 'cool', '#22d3ee'));
    kpis.append(kpi('lock', 'Honeypot', cfg.honeypot?.channelId ? 'AKTİF' : 'KURULU DEĞİL', cfg.honeypot?.channelId ? `${cfg.honeypot.hits || 0} tetikleme` : 'Tuzak kanal kur', cfg.honeypot?.channelId ? 'good' : '', '#ffb547'));
    kpis.append(kpi('ban', 'Rolleri alınan', stats.stripped || 0, `${stats.restored || 0} geri kuruldu`, '', '#7c5cff'));
    kpis.append(kpi('shield', 'Modüller', `${s.modulesActive || 0}/${s.modulesTotal || 0}`, `pencere ${cfg.windowSeconds} sn`, 'gold', '#f7c948'));
    kpis.append(kpi('clock', 'Son 24 saat', s.violations24h || 0, 'ihlal kaydı', '', '#34e39a'));
  }

  // Hazır ayarlar
  const presets = $('#guardPresets');
  if (presets) {
    presets.innerHTML = '';
    presets.append(el('span', { class: 'p-label', text: 'Hazır ayar:' }));
    (guardData.presets || []).forEach((p) => {
      const cls = p.key === 'siki' ? 'siki' : p.key === 'gevsek' ? 'gevsek' : 'dengeli';
      presets.append(el('button', {
        class: `preset-btn ${cls}`,
        title: p.desc,
        onclick: () => applyGuardPreset(p.key, p.label)
      }, [el('span', { class: 'p-dot' }), el('span', { text: p.label })]));
    });
  }

  // Temel ayarlar
  const punish = $('#guardPunishment');
  if (punish) {
    punish.innerHTML = '';
    (guardData.punishments || []).forEach((p) => punish.append(el('option', { value: p.key, text: p.label })));
    punish.value = cfg.punishment;
  }
  guardSet('#guardTimeout', cfg.timeoutMinutes ?? 10);
  guardSet('#guardWindow', cfg.windowSeconds);
  guardSet('#guardWindowBadge', `${cfg.windowSeconds} sn`);
  if ($('#guardWindowBadge')) $('#guardWindowBadge').textContent = `${cfg.windowSeconds} sn`;
  fillGuardSelect('#guardLogChannel', guardData.textChannels || [], cfg.logChannelId, '— seçilmedi —');
  fillGuardSelect('#guardJailRole', guardData.roles || [], cfg.jailRoleId, '— kapalı —');
  fillGuardSelect('#guardMutedRole', guardData.roles || [], cfg.mutedRoleId, '— otomatik —');
  if ($('#guardNote')) {
    $('#guardNote').innerHTML = 'Botun ve panelin kendi toplu işlemleri guard tarafından tehlike sayılmaz. Kendi hesabınla toplu işlem yapacaksan hesabını <b>Güvenli liste</b>\'ye ekle.';
  }

  // Modüller
  const mods = $('#guardModules');
  if (mods) {
    mods.innerHTML = '';
    (guardData.modules || []).forEach((m) => {
      const isOn = Boolean(cfg.modules[m.key]);
      const tile = el('button', {
        class: `mod-tile${isOn ? ' on' : ''}`, title: m.desc,
        onclick: () => toggleGuardModule(m.key, !isOn)
      }, [
        el('span', { class: 'm-ico' }, [iconEl(GUARD_MODULE_ICON[m.key] || 'shield', 'icon')]),
        el('span', { class: 'm-body' }, [
          el('span', { class: 'm-name' }, [el('span', { text: m.label })]),
          el('span', { class: 'm-desc', text: m.desc })
        ]),
        el('span', { class: 'm-switch' })
      ]);
      mods.append(tile);
    });
  }
  if ($('#guardModuleCount')) {
    $('#guardModuleCount').textContent = `${(guardData.modules || []).filter((m) => cfg.modules[m.key]).length}/${(guardData.modules || []).length}`;
  }

  // Honeypot
  const honey = cfg.honeypot || {};
  if ($('#guardHoneypotBadge')) {
    const badge = $('#guardHoneypotBadge');
    badge.textContent = honey.channelId ? 'aktif' : 'kapalı';
    badge.className = `badge ${honey.channelId ? 'green' : 'red'}`;
  }
  const honeyAction = $('#guardHoneypotAction');
  if (honeyAction) {
    honeyAction.innerHTML = '';
    (guardData.honeypotActions || []).forEach((a) => honeyAction.append(el('option', { value: a.key, text: a.label })));
    honeyAction.value = honey.action || 'timeout';
  }
  guardSet('#guardHoneypotHours', honey.hours ?? 1);
  const honeyInfo = $('#guardHoneypotInfo');
  if (honeyInfo) {
    honeyInfo.innerHTML = '';
    const tile = (label, value) => el('div', { class: 'honey-tile' }, [el('div', { class: 'h-l', text: label }), el('div', { class: 'h-v', text: value })]);
    const chName = honey.channelId ? (guardData.textChannels || []).find((c) => c.id === honey.channelId)?.name : null;
    honeyInfo.append(tile('Tuzak kanal', honey.channelId ? `#${chName || honey.channelId}` : 'Kurulu değil'));
    honeyInfo.append(tile('Tuzak rol', honey.roleId ? (guardData.roles || []).find((r) => r.id === honey.roleId)?.name || honey.roleId : 'Kurulu değil'));
    honeyInfo.append(tile('Tetikleme', `${honey.hits || 0} kez`));
    honeyInfo.append(tile('Son tetikleme', honey.lastAt ? timeAgo(honey.lastAt) : '—'));
  }

  // Reklam
  const ad = cfg.ad || {};
  if ($('#guardAdBadge')) $('#guardAdBadge').textContent = `${ad.detected || 0} tespit`;
  const adAction = $('#guardAdAction');
  if (adAction) {
    adAction.innerHTML = '';
    (guardData.adActions || []).forEach((a) => adAction.append(el('option', { value: a.key, text: a.label })));
    adAction.value = ad.action || 'delete';
  }
  if ($('#guardAdInvites')) $('#guardAdInvites').value = ad.allowInvites ? 'allow' : 'block';
  if ($('#guardAdDomains')) $('#guardAdDomains').value = (ad.trustedDomains || []).join(', ');

  // Gelişmiş ayarlar
  const th = cfg.thresholds || {};
  guardSet('#guardMassDestructive', th.massDestructive ?? 6);
  guardSet('#guardMaxMentions', th.maxMentions ?? 6);
  guardSet('#guardMassMention', th.massMention ?? 12);
  const raidSel = $('#guardRaidAction');
  if (raidSel) {
    raidSel.innerHTML = '';
    (guardData.raidActions || []).forEach((a) => raidSel.append(el('option', { value: a.key, text: a.label })));
    raidSel.value = cfg.raidAction || 'notify';
  }
  const botSel = $('#guardBotAction');
  if (botSel) {
    botSel.innerHTML = '';
    (guardData.botActions || []).forEach((a) => botSel.append(el('option', { value: a.key, text: a.label })));
    botSel.value = cfg.botAction || 'kick';
  }
  const naSel = $('#guardNewAccountAction');
  if (naSel) {
    naSel.innerHTML = '';
    (guardData.newAccountActions || []).forEach((a) => naSel.append(el('option', { value: a.key, text: a.label })));
    naSel.value = cfg.newAccount?.action || 'notify';
  }
  guardSet('#guardNewAccountDays', cfg.newAccount?.days ?? 7);
  const checks = {
    guardCapsEnabled: cfg.caps?.enabled !== false,
    guardEmojiEnabled: cfg.emoji?.enabled !== false,
    guardVerifyLevel: cfg.safety?.verifyLevel !== false,
    guardAutoRestore: cfg.safety?.autoRestore !== false,
    guardWatchIntegrations: cfg.safety?.watchIntegrations !== false,
    guardAutoReply: cfg.honeypot?.autoReply !== false
  };
  Object.entries(checks).forEach(([id, value]) => { const n = $(`#${id}`); if (n) n.checked = value; });

  // Güvenli liste + trend
  renderGuardWhitelist(cfg.whitelist);
  renderGuardTrend();
  renderGuardLimits();
  renderGuardEvents(guardData.events || []);
}

function fillGuardSelect(id, list, value, emptyLabel) {
  const node = $(id);
  if (!node) return;
  node.innerHTML = '';
  node.append(el('option', { value: '', text: emptyLabel }));
  (list || []).forEach((item) => node.append(el('option', { value: item.id, text: item.name })));
  if (value && !(list || []).some((i) => i.id === value)) {
    node.append(el('option', { value, text: `${value} (önbellekte yok)` }));
  }
  node.value = value || '';
}

async function toggleAllGuardModules(enabled) {
  if (!guardData) return;
  const changes = (guardData.modules || []).filter((m) => Boolean(guardData.guard.modules[m.key]) !== enabled);
  if (!changes.length) return toast(enabled ? 'Tüm modüller zaten açık' : 'Tüm modüller zaten kapalı');
  try {
    for (const m of changes) {
      await api('/api/guard/module', { method: 'POST', body: { key: m.key, enabled } });
    }
    await loadGuard();
    toast(`${changes.length} modül ${enabled ? 'açıldı' : 'kapatıldı'}`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleGuardModule(key, enabled) {
  try {
    const r = await api('/api/guard/module', { method: 'POST', body: { key, enabled } });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    renderGuard();
    toast(`${guardData.modules.find((m) => m.key === key)?.label || key} ${enabled ? 'açıldı' : 'kapatıldı'}`, enabled ? 'ok' : 'warn');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function applyGuardPreset(preset, label) {
  if (!confirm(`"${label}" hazır ayarı uygulanacak. Modüller, limitler, cezalar ve eşikler bu profile göre değiştirilecek. Devam?`)) return;
  try {
    const r = await api('/api/guard/preset', { method: 'POST', body: { preset } });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    guardData.admin = r.admin || guardData.admin;
    if (r.statsSeries) guardData.statsSeries = r.statsSeries;
    renderGuard();
    toast(`${label} ayarı uygulandı`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderGuardLimits() {
  const box = $('#guardLimits');
  if (!box || !guardData) return;
  const cfg = guardData.guard;
  box.innerHTML = '';
  const labels = el('div', { class: 'limit-tile-labels', style: 'grid-column:1/-1' }, [
    el('span', { class: 'lt1', text: 'İşlem' }),
    el('span', { class: 'lt2', text: 'Limit' }),
    el('span', { class: 'lt3', text: 'Oran 1/x' })
  ]);
  box.append(labels);
  (guardData.limitActions || []).forEach((a) => {
    const isOn = Boolean(cfg.modules[a.module]);
    const modName = (guardData.modules || []).find((m) => m.key === a.module)?.label || a.module;
    const limitInput = el('input', { class: 'input', type: 'number', min: '1', max: '100', id: `guardLimit-${a.key}` });
    limitInput.value = cfg.limits[a.key] ?? a.def;
    const ratioInput = el('input', { class: 'input l-ratio', type: 'number', min: '0', max: '100', id: `guardRatio-${a.key}`, title: '0 = yalnızca sabit limit' });
    ratioInput.value = cfg.ratios?.[a.key] ?? 0;
    box.append(el('div', { class: `limit-tile${isOn ? '' : ' off'}` }, [
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'l-name', text: a.label }),
        el('span', { class: 'l-mod', text: isOn ? `${modName} izliyor` : `${modName} kapalı` })
      ]),
      limitInput,
      ratioInput
    ]));
  });
}

async function saveGuardLimits() {
  try {
    const limits = {};
    const ratios = {};
    (guardData.limitActions || []).forEach((a) => {
      const l = Number($(`#guardLimit-${a.key}`)?.value);
      const r = Number($(`#guardRatio-${a.key}`)?.value);
      if (Number.isFinite(l) && l !== guardData.guard.limits[a.key]) limits[a.key] = l;
      if (Number.isFinite(r) && r !== (guardData.guard.ratios?.[a.key] ?? 0)) ratios[a.key] = r;
    });
    if (!Object.keys(limits).length && !Object.keys(ratios).length) return toast('Limitlerde değişiklik yok');
    const r = await api('/api/guard/config', { method: 'POST', body: { limits, ratios } });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    renderGuard();
    toast(`${Object.keys(limits).length + Object.keys(ratios).length} limit/oran güncellendi`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveGuardConfig() {
  try {
    const body = {
      logChannelId: $('#guardLogChannel')?.value || null,
      jailRoleId: $('#guardJailRole')?.value || null,
      mutedRoleId: $('#guardMutedRole')?.value || null,
      punishment: $('#guardPunishment')?.value,
      windowSeconds: Number($('#guardWindow')?.value),
      timeoutMinutes: Number($('#guardTimeout')?.value),
      honeypot: {
        action: $('#guardHoneypotAction')?.value,
        hours: Number($('#guardHoneypotHours')?.value)
      },
      ad: {
        action: $('#guardAdAction')?.value,
        allowInvites: $('#guardAdInvites')?.value === 'allow',
        trustedDomains: ($('#guardAdDomains')?.value || '').split(',').map((d) => d.trim()).filter(Boolean)
      }
    };
    const r = await api('/api/guard/config', { method: 'POST', body });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    if (r.events) guardData.events = r.events;
    if (r.statsSeries) guardData.statsSeries = r.statsSeries;
    renderGuard();
    toast('Guard ayarları kaydedildi', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveGuardAdvanced() {
  try {
    const body = {
      thresholds: {
        massDestructive: Number($('#guardMassDestructive')?.value),
        maxMentions: Number($('#guardMaxMentions')?.value),
        massMention: Number($('#guardMassMention')?.value)
      },
      raidAction: $('#guardRaidAction')?.value,
      botAction: $('#guardBotAction')?.value,
      newAccount: {
        action: $('#guardNewAccountAction')?.value,
        days: Number($('#guardNewAccountDays')?.value)
      },
      caps: { enabled: Boolean($('#guardCapsEnabled')?.checked) },
      emoji: { enabled: Boolean($('#guardEmojiEnabled')?.checked) },
      safety: {
        verifyLevel: Boolean($('#guardVerifyLevel')?.checked),
        autoRestore: Boolean($('#guardAutoRestore')?.checked),
        watchIntegrations: Boolean($('#guardWatchIntegrations')?.checked)
      },
      honeypot: { autoReply: Boolean($('#guardAutoReply')?.checked) }
    };
    const r = await api('/api/guard/config', { method: 'POST', body });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    if (r.events) guardData.events = r.events;
    renderGuard();
    toast('Gelişmiş ayarlar kaydedildi', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleGuard() {
  try {
    const enabled = !guardData.guard.enabled;
    const r = await api('/api/guard/config', { method: 'POST', body: { enabled } });
    guardData.guard = r.guard;
    guardData.summary = r.summary;
    renderGuard();
    await loadGuardEvents();
    toast(enabled ? 'Koruma açıldı — otomatik müdahale aktif' : 'Koruma kapatıldı', enabled ? 'ok' : 'warn');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function honeypotAction(action) {
  const labels = { setup: 'Tuzak kanal kuruluyor…', role: 'Tuzak rol kuruluyor…', test: 'Test tetikleniyor…', disable: 'Honeypot kapatılıyor…' };
  toast(labels[action] || 'İşlem…');
  try {
    const r = await api('/api/guard/honeypot', { method: 'POST', body: { action } });
    if (r.guard) guardData.guard = r.guard;
    if (r.summary) guardData.summary = r.summary;
    if (r.events) guardData.events = r.events;
    renderGuard();
    if (action === 'setup') toast(r.result?.existing ? 'Mevcut tuzak kanal kullanılıyor' : 'Tuzak kanal oluşturuldu 🍯', 'ok');
    else if (action === 'role') toast('Tuzak rol oluşturuldu', 'ok');
    else if (action === 'disable') toast('Honeypot kapatıldı', 'warn');
    else toast('Test tetiklendi — olay akışına bak', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runAdSim() {
  const input = $('#guardAdSimInput');
  const box = $('#guardAdSimResult');
  if (!input || !box) return;
  const text = (input.value || '').trim();
  if (!text) return toast('Test için bir metin yaz', 'warn');
  box.className = 'ad-sim-result';
  box.innerHTML = '<span style="color:var(--muted)">Taranıyor…</span>';
  try {
    const r = await api('/api/guard/ad-sim', { method: 'POST', body: { text } });
    const a = r.analysis || {};
    box.className = `ad-sim-result ${a.confident ? 'hit' : 'clean'}`;
    box.innerHTML = '';
    box.append(el('span', { class: 'score-pill', text: `SKOR ${a.score ?? 0} / 3` }));
    box.append(el('span', { text: a.confident ? '🚫 Reklam olarak işaretlenir' : '✅ Temiz görünüyor' }));
    if ((a.reasons || []).length) {
      const reasons = el('div', { class: 'ad-sim-reasons' });
      a.reasons.forEach((reason) => reasons.append(el('span', { text: reason })));
      box.append(reasons);
    }
  } catch (err) {
    box.className = 'ad-sim-result';
    box.textContent = err.message;
  }
}

function renderGuardTrend() {
  const box = $('#guardTrend');
  if (!box || !guardData) return;
  box.innerHTML = '';
  const series = guardData.statsSeries || [];
  if (!series.length) {
    box.innerHTML = '<div class="empty" style="padding:14px">Trend verisi yok.</div>';
    return;
  }
  const max = Math.max(1, ...series.map((d) => Math.max(d.blocked || 0, d.deleted || 0, d.honeypot || 0)));
  series.forEach((d) => {
    const col = el('div', { class: 't-col', title: `${d.day}\nMüdahale: ${d.blocked || 0}\nSilinen: ${d.deleted || 0}\nHoneypot: ${d.honeypot || 0}` });
    const bars = el('div', { style: 'flex:1;display:flex;align-items:flex-end;gap:1px;width:100%;justify-content:flex-end' });
    const bar = (val, cls) => {
      const h = Math.round((val / max) * 100);
      return el('div', { class: `t-bar ${cls}`, style: `height:${val ? Math.max(6, h) : 0}%` });
    };
    bars.append(bar(d.honeypot || 0, 'b3'), bar(d.deleted || 0, 'b2'), bar(d.blocked || 0, 'b1'));
    col.append(bars, el('div', { class: 't-day', text: d.day.slice(5) }));
    box.append(col);
  });
}

function renderGuardWhitelist(rawList) {
  const box = $('#guardWhitelist');
  if (!box) return;
  const list = (rawList || []).map((u) => (typeof u === 'string' ? { id: u, name: u, bot: false } : u));
  box.innerHTML = '';
  if ($('#guardWhitelistCount')) $('#guardWhitelistCount').textContent = list.length;
  if (!list.length) {
    box.innerHTML = '<div class="empty">Güvenli liste boş. Güvendiğin yetkilileri ekle.</div>';
    return;
  }
  list.forEach((u) => {
    box.append(el('div', { class: 'log-row', style: 'display:flex;align-items:center;gap:8px' }, [
      el('span', { class: 'ic' }, [iconEl(u.bot ? 'bot' : 'user', 'icon icon-sm')]),
      el('span', { class: 'txt', text: u.name }),
      el('span', { style: 'margin-left:auto;color:var(--muted);font-size:11px', text: u.id }),
      el('button', { class: 'btn btn-sm btn-danger', text: 'Çıkar', onclick: () => guardWhitelist(u.id, 'remove') })
    ]));
  });
}

async function addGuardWhitelist() {
  const input = $('#guardWhitelistInput');
  const value = (input.value || '').trim();
  if (!value) return toast('Kullanıcı ID gir', 'warn');
  await guardWhitelist(value.replace(/[<@!>]/g, ''), 'add');
  input.value = '';
}

async function guardWhitelist(userId, action) {
  try {
    const r = await api('/api/guard/whitelist', { method: 'POST', body: { userId, action } });
    guardData.guard = r.guard;
    if (r.summary) guardData.summary = r.summary;
    renderGuardWhitelist(r.guard.whitelist);
    toast(action === 'add' ? 'Güvenli listeye eklendi' : 'Güvenli listeden çıkarıldı', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function guardEventIcon(e) {
  if (e.module === 'honeypot') return 'lock';
  if (e.module === 'adGuard') return 'megaphone';
  if (e.module === 'antiRaid') return 'users';
  if (e.module === 'spamGuard') return 'message';
  if (e.type === 'punishment') return 'ban';
  if (e.type === 'violation') return 'alert';
  if (e.type === 'action') return 'sliders';
  return 'shield';
}

function renderGuardEvents(events) {
  const box = $('#guardEvents');
  if (!box) return;
  const query = ($('#guardEventSearch')?.value || '').trim().toLocaleLowerCase('tr');
  const list = (events || []).filter((e) => !query
    || String(e.title).toLocaleLowerCase('tr').includes(query)
    || String(e.detail || '').toLocaleLowerCase('tr').includes(query)
    || String(e.actor?.name || '').toLocaleLowerCase('tr').includes(query)
    || String(e.module || '').toLowerCase().includes(query));
  box.innerHTML = '';
  if ($('#guardEventCount')) $('#guardEventCount').textContent = guardData ? (guardData.events || []).length : list.length;
  if (!list.length) {
    box.innerHTML = '<div class="ev-empty">Henüz guard kaydı yok. Koruma açıkken izlenen işlemler ve müdahaleler burada listelenir.</div>';
    return;
  }
  const MODULE_LABEL = Object.fromEntries((guardData?.modules || []).map((m) => [m.key, m.label]));
  list.slice(0, 80).forEach((e) => {
    const cls = e.type === 'punishment' ? 'punish' : (e.severity || 'low');
    const row = el('div', { class: `ev-row ${cls}` }, [
      el('div', { class: 'ev-ico' }, [iconEl(guardEventIcon(e), 'icon')]),
      el('div', { class: 'ev-body' }, [
        el('div', { class: 'ev-title' }, [
          el('span', { text: e.title }),
          e.module && MODULE_LABEL[e.module] ? el('span', { class: 'ev-mod', text: MODULE_LABEL[e.module] }) : null,
          e.score != null ? el('span', { class: 'ev-score', text: `skor ${e.score}` }) : null
        ]),
        e.detail ? el('div', { class: 'ev-detail', text: e.detail }) : null,
        (e.actor?.name || e.count != null || e.punishment) ? el('div', { class: 'ev-meta' }, [
          e.actor?.name ? el('span', {}, [el('span', { text: 'Sorumlu: ' }), el('b', { text: e.actor.name })]) : null,
          e.count != null ? el('span', {}, [el('span', { text: 'Sayaç: ' }), el('b', { text: `${e.count}${e.limit != null ? ` / ${e.limit}` : ''}` })]) : null,
          e.punishment ? el('span', {}, [el('span', { text: 'Ceza: ' }), el('b', { text: e.punishment })]) : null,
          e.evidence ? el('span', {}, [el('span', { text: 'Kanıt: ' }), el('b', { text: String(e.evidence).slice(0, 60) })]) : null
        ]) : null
      ]),
      el('span', { class: 'ev-time', text: timeAgo(e.at) })
    ]);
    box.append(row);
  });
}

async function loadGuardEvents() {
  try {
    const r = await api('/api/guard/events');
    if (guardData) {
      guardData.events = r.events;
      guardData.summary = r.summary;
    }
    renderGuardEvents(r.events);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function clearGuardEvents() {
  if (!confirm('Tüm guard olay kayıtları silinsin mi?')) return;
  try {
    await api('/api/guard/events/clear', { method: 'POST', body: {} });
    if (guardData) guardData.events = [];
    renderGuardEvents([]);
    toast('Guard akışı temizlendi', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runGuardTest() {
  try {
    const r = await api('/api/guard/test', { method: 'POST', body: {} });
    if (guardData) {
      guardData.events = r.events;
      guardData.summary = r.summary;
    }
    renderGuardEvents(r.events);
    toast(`Test kaydı üretildi: ${r.event.title}`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runSafetyAudit() {
  try {
    const r = await api('/api/guard/audit', { method: 'POST', body: {} });
    if (guardData) {
      guardData.summary = r.summary;
      guardData.events = r.events;
    }
    renderGuard();
    toast('Güvenlik denetimi tamamlandı', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function takeGuardBackup() {
  try {
    const r = await api('/api/guard/backup', { method: 'POST', body: {} });
    toast(`Yedek alındı: ${r.roles} rol, ${r.channels} kanal`, 'ok');
    await loadGuard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function restoreGuardBackup() {
  if (!confirm('Yedekten geri yükleme: silinmiş roller/kanallar yeniden oluşturulacak. Devam?')) return;
  try {
    const r = await api('/api/guard/restore', { method: 'POST', body: {} });
    toast(`Geri yüklendi: ${r.roles || 0} rol, ${r.channels || 0} kanal`, 'ok');
    await loadGuard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function panicGuard() {
  if (!confirm('🚨 PANİK MODU\n\nSunucudaki TÜM yetkili rollerinden (senin ve botun hariç) yetkiler alınacak, davetler silinecek. Bu işlem geri alınamaz.\n\nDevam edilsin mi?')) return;
  if (!confirm('Son onay: gerçekten tüm yetkileri sıfırlayayım mı?')) return;
  try {
    const r = await api('/api/guard/panic', { method: 'POST', body: {} });
    toast(`Panik modu: ${r.members || 0} üyeden ${r.roles || 0} rol alındı, ${r.invites || 0} davet silindi`, 'warn');
    await loadGuard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ==================== GUARD MERKEZİ (OPERATÖR KATMANI) ====================
   Tüm sunucuların koruma durumu buradan yönetilir: whitelist (koruma gerçekten
   çalışsın), blacklist / sessiz mod (izleme dursun ama sunucuya normal görünsün)
   ve otomatik pasifleştirme. Bu bilgiler Discord tarafına sızmaz.            */
let gcData = null;
let gcFilter = 'all';
const gcOpen = new Set();
const gcDetail = new Map();   // guildId -> detay verisi
const gcDraft = new Map();    // guildId -> düzenlenen güvenli liste (id dizisi)

const GC_STATUS = {
  active: { label: 'Koruma çalışıyor', badge: 'green', truth: 'on' },
  idle: { label: 'Sunucu kapatmış', badge: 'red', truth: 'idle' },
  silent: { label: 'Sessizde (blacklist)', badge: 'red', truth: 'off' },
  pending: { label: 'Onay bekliyor', badge: '', truth: 'wait' }
};
const GC_FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Çalışıyor' },
  { key: 'silent', label: 'Sessizde' },
  { key: 'pending', label: 'Onay bekliyor' },
  { key: 'idle', label: 'Sunucu kapatmış' }
];

async function loadGuardCenter() {
  try {
    gcData = await api('/api/guard/center');
    renderGuardCenter();
  } catch (err) {
    const box = $('#gcGuilds');
    if (box) box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    toast(err.message, 'err');
  }
}

async function syncGuardCenter() {
  try {
    gcData = await api('/api/guard/center/sync', { method: 'POST', body: {} });
    renderGuardCenter();
    toast(`${gcData.synced ?? gcData.guilds.length} sunucu senkronize edildi`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleAutoBlock() {
  const node = $('#gcAutoBlock');
  try {
    gcData = await api('/api/guard/center/policy', { method: 'POST', body: { autoBlockNewGuilds: node.checked } });
    renderGuardCenter();
    toast(node.checked ? 'Yeni sunucular otomatik pasif başlayacak' : 'Yeni sunucular otomatik pasifleştirilmeyecek');
  } catch (err) {
    node.checked = !node.checked;
    toast(err.message, 'err');
  }
}

function gcTruthText(g) {
  if (g.status === 'silent') {
    return `Koruma bu sunucuda ÇALIŞMIYOR (sessiz mod). Discord tarafında her şey normal görünüyor: /guard durum "koruma aktif" der, komutlar çalışır. Sebep: ${g.silentReason || 'belirtilmedi'}`;
  }
  if (g.status === 'pending') {
    return 'Whitelist\'te değil — koruma çalışmıyor. Sunucu yeni eklendiği için otomatik pasif başladı; uygun görürsen "Whitelist\'e al" ile aç.';
  }
  if (g.status === 'idle') {
    return 'Whitelist\'te ama sunucu korumayı kendisi kapatmış. Açtığında izleme gerçekten çalışır.';
  }
  return `Koruma gerçekten çalışıyor: ${g.modulesActive}/${g.modulesTotal} modül izliyor, pencere ${g.windowSeconds} sn, ceza kuralı ${g.punishmentLabel}.`;
}

function renderGuardCenter() {
  if (!gcData) return;
  const stats = gcData.stats;
  $('#gcAutoBlock').checked = Boolean(gcData.policy.autoBlockNewGuilds);
  const badge = $('#gcBadge');
  badge.textContent = `${stats.active}/${stats.total} sunucuda koruma çalışıyor`;
  badge.className = `badge ${stats.active > 0 ? 'green' : 'red'}`;

  const statBox = $('#gcStats');
  statBox.innerHTML = '';
  const cards = [
    { cls: '', value: stats.total, label: 'Toplam sunucu' },
    { cls: 'ok', value: stats.active, label: 'Koruma çalışıyor (whitelist)' },
    { cls: 'off', value: stats.silent, label: 'Sessizde (blacklist)' },
    { cls: 'wait', value: stats.pending, label: 'Onay bekliyor' },
    { cls: 'ok', value: stats.totalBlocked || 0, label: 'Toplam müdahale' },
    { cls: 'off', value: stats.totalHoneypot || 0, label: 'Honeypot tetikleme' }
  ];
  cards.forEach((c) => statBox.append(el('div', { class: `gc-stat ${c.cls}` }, [el('b', { text: String(c.value) }), el('span', { text: c.label })])));

  const filterBox = $('#gcFilter');
  filterBox.innerHTML = '';
  GC_FILTERS.forEach((f) => {
    const count = f.key === 'all' ? stats.total : stats[f.key] ?? 0;
    filterBox.append(el('button', {
      class: `chip${gcFilter === f.key ? ' sel' : ''}`,
      onclick: () => { gcFilter = f.key; renderGuardCenter(); }
    }, [el('span', { text: `${f.label} (${count})` })]));
  });

  const query = ($('#gcSearch')?.value || '').trim().toLocaleLowerCase('tr');
  const list = gcData.guilds.filter((g) => (gcFilter === 'all' || g.status === gcFilter))
    .filter((g) => !query || String(g.name).toLocaleLowerCase('tr').includes(query) || String(g.id).includes(query));

  const listBox = $('#gcGuilds');
  listBox.innerHTML = '';
  $('#gcGuildCount').textContent = `${list.length}/${gcData.guilds.length}`;
  if (!list.length) {
    listBox.innerHTML = '<div class="empty">Bu filtrede sunucu yok.</div>';
  } else {
    list.forEach((g) => listBox.append(gcRow(g)));
  }

  renderGuardOps();
}

function gcRow(g) {
  const st = GC_STATUS[g.status] || GC_STATUS.pending;
  const isOpen = gcOpen.has(g.id);
  const row = el('div', { class: `gc-row${isOpen ? ' open' : ''}`, 'data-guild': g.id });

  const actions = el('div', { class: 'gc-actions' });
  if (g.status !== 'active' && g.status !== 'idle') {
    actions.append(el('button', { class: 'btn btn-sm btn-primary', text: "Whitelist'e al", onclick: () => gcAction(g, 'approve') }));
  }
  if (g.status === 'silent') {
    actions.append(el('button', { class: 'btn btn-sm', text: 'Sessizden çıkar', onclick: () => gcAction(g, 'unsilent') }));
  }
  if (g.status === 'active' || g.status === 'idle') {
    actions.append(el('button', { class: 'btn btn-sm btn-danger', text: "Blacklist'e al (sessiz)", onclick: () => gcAction(g, 'revoke') }));
    actions.append(el('button', {
      class: 'btn btn-sm',
      text: g.enabled ? 'Görünür korumayı kapat' : 'Görünür korumayı aç',
      onclick: () => gcAction(g, g.enabled ? 'disable' : 'enable')
    }));
  }
  actions.append(el('button', { class: 'btn btn-sm', text: isOpen ? 'Kapat' : 'Ayarlar & olaylar', onclick: () => gcToggleDetail(g.id) }));

  const meta = [
    `${g.memberCount != null ? `${g.memberCount} üye` : 'üye sayısı bilinmiyor'}`,
    g.online ? 'bot önbelleğinde' : 'bot önbelleğinde değil',
    g.addedAt ? `eklendi: ${timeAgo(g.addedAt)}` : null,
    g.approvedAt ? `whitelist: ${timeAgo(g.approvedAt)}${g.approvedBy ? ` (${g.approvedBy})` : ''}` : null,
    `${g.modulesActive}/${g.modulesTotal} modül · pencere ${g.windowSeconds} sn · ceza ${g.punishmentLabel}`,
    g.stats ? `${g.stats.blocked || 0} müdahale · ${g.stats.ads || 0} reklam · ${g.stats.deleted || 0} silinen` : null,
    g.honeypot?.channelId ? `🍯 honeypot aktif (${g.honeypot.hits || 0} tetikleme)` : '🍯 honeypot yok',
    `${g.eventCount} olay kaydı · son 24 saatte ${g.violations24h} ihlal`,
    g.backup ? `yedek: ${g.backup.roles} rol, ${g.backup.channels} kanal (${timeAgo(g.backup.at)})` : 'yedek yok'
  ].filter(Boolean).join(' · ');

  const head = el('div', { class: 'gc-head' }, [
    el('div', { style: 'min-width:220px;flex:1 1 260px' }, [
      el('div', { class: 'gc-title' }, [
        iconEl('shield', 'icon icon-sm'),
        el('span', { text: g.name }),
        el('span', { class: `badge ${st.badge}`, text: st.label }),
        g.enabled ? el('span', { class: 'tag bot', text: 'durum: açık görünüyor' }) : el('span', { class: 'tag muted', text: 'durum: kapalı görünüyor' })
      ]),
      el('div', { class: 'gc-id', text: g.id }),
      el('div', { class: 'gc-meta', text: meta }),
      el('div', { class: `gc-truth ${st.truth}`, text: gcTruthText(g) })
    ]),
    actions
  ]);

  const noteRow = el('div', { class: 'gc-note' }, [
    el('span', { class: 'hint', text: 'Operatör notu:' }),
    (() => {
      const input = el('input', { class: 'input', placeholder: 'Bu sunucu hakkında not (yalnızca panelde görünür)', value: g.note || '' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') gcSetNote(g.id, input.value); });
      return input;
    })(),
    el('button', { class: 'btn btn-sm', text: 'Notu kaydet', onclick: (e) => gcSetNote(g.id, e.target.closest('.gc-note').querySelector('input').value) })
  ]);

  row.append(head, noteRow);
  if (isOpen) row.append(gcDetailBox(g.id));
  return row;
}

function gcDetailBox(guildId) {
  const box = el('div', { class: 'gc-detail', id: `gc-detail-${guildId}` });
  const data = gcDetail.get(guildId);
  if (!data) {
    box.append(el('div', { class: 'empty', text: 'Detay yükleniyor…' }));
    return box;
  }
  const cfg = data.guard;

  box.append(el('div', { class: `gc-truth ${GC_STATUS[data.admin.status]?.truth || 'wait'}`, text: gcTruthText({ ...data.admin, ...data.guild, status: data.admin.status }) }));

  /* --- hero satırı --- */
  const heroChips = el('div', { class: 'guard-hero-chips', style: 'margin:10px 0 4px' });
  const chip = (text, cls = '') => heroChips.append(el('span', { class: `guard-chip ${cls}`, text }));
  chip(`${data.admin.modulesActive}/${data.admin.modulesTotal} modül`, 'on');
  chip(`Ceza: ${data.admin.punishmentLabel}`);
  chip(`Müdahale: ${data.admin.stats?.blocked || 0}`);
  chip(`Reklam: ${data.admin.stats?.ads || 0}`);
  chip(`Honeypot: ${cfg.honeypot?.hits || 0}`, cfg.honeypot?.channelId ? 'on' : 'warn');
  box.append(heroChips);

  /* --- hazır ayarlar --- */
  const presetRow = el('div', { class: 'guard-presets', style: 'margin:10px 0 4px' });
  presetRow.append(el('span', { class: 'p-label', text: 'Hazır ayar:' }));
  (data.presets || []).forEach((p) => {
    const cls = p.key === 'siki' ? 'siki' : p.key === 'gevsek' ? 'gevsek' : 'dengeli';
    presetRow.append(el('button', {
      class: `preset-btn ${cls}`,
      title: p.desc,
      onclick: () => gcApplyPreset(guildId, p.key, p.label)
    }, [el('span', { class: 'p-dot' }), el('span', { text: p.label })]));
  });
  box.append(presetRow);

  /* --- temel yapılandırma --- */
  const grid = el('div', { class: 'grid cols-3', style: 'margin-top:10px' });

  const logSelect = el('select', { class: 'input', id: `gc-log-${guildId}` });
  logSelect.append(el('option', { value: '', text: '— seçilmedi —' }));
  data.textChannels.forEach((c) => logSelect.append(el('option', { value: c.id, text: c.name })));
  logSelect.value = cfg.logChannelId || '';
  if (cfg.logChannelId && logSelect.value !== cfg.logChannelId) {
    logSelect.append(el('option', { value: cfg.logChannelId, text: `${cfg.logChannelId} (önbellekte yok)` }));
    logSelect.value = cfg.logChannelId;
  }

  const jailSelect = el('select', { class: 'input', id: `gc-jail-${guildId}` });
  jailSelect.append(el('option', { value: '', text: '— kapalı —' }));
  data.roles.forEach((r) => jailSelect.append(el('option', { value: r.id, text: r.name })));
  jailSelect.value = cfg.jailRoleId || '';

  const punishSelect = el('select', { class: 'input', id: `gc-punish-${guildId}` });
  data.punishments.forEach((p) => punishSelect.append(el('option', { value: p.key, text: p.label })));
  punishSelect.value = cfg.punishment;

  const windowInput = el('input', { class: 'input', type: 'number', min: '5', max: '600', step: '5', id: `gc-window-${guildId}` });
  windowInput.value = cfg.windowSeconds;

  const timeoutInput = el('input', { class: 'input', type: 'number', min: '1', max: '1440', id: `gc-timeout-${guildId}` });
  timeoutInput.value = cfg.timeoutMinutes ?? 10;

  const honeyAction = el('select', { class: 'input', id: `gc-honey-action-${guildId}` });
  (data.honeypotActions || guardData?.honeypotActions || []).forEach((a) => honeyAction.append(el('option', { value: a.key, text: a.label })));
  honeyAction.value = cfg.honeypot?.action || 'timeout';

  const adAction = el('select', { class: 'input', id: `gc-ad-action-${guildId}` });
  (data.adActions || guardData?.adActions || []).forEach((a) => adAction.append(el('option', { value: a.key, text: a.label })));
  adAction.value = cfg.ad?.action || 'delete';

  grid.append(
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Guard kanalı' }), logSelect, el('div', { class: 'hint', text: data.online ? 'Bot önbelleğindeki metin/duyuru kanalları.' : 'Sunucu bot önbelleğinde değil; mevcut ID korunur.' })]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Ana ceza' }), punishSelect, el('div', { class: 'hint', text: 'Eşik aşılınca gerçekten uygulanır.' })]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Sayım penceresi (sn)' }), windowInput, el('div', { class: 'hint', text: '5–600 saniye.' })]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Timeout süresi (dk)' }), timeoutInput]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Jail rolü' }), jailSelect]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: '🍯 Honeypot cezası' }), honeyAction]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: '📣 Reklam cezası' }), adAction])
  );
  box.append(grid);

  /* --- honeypot aksiyonları --- */
  box.append(el('div', { class: 'honey-actions', style: 'margin-top:6px' }, [
    el('button', { class: 'btn btn-sm btn-danger', text: '🍯 Tuzak kanal kur/onar', onclick: () => gcHoneypot(guildId, 'setup') }),
    el('button', { class: 'btn btn-sm btn-warn', text: 'Tuzak rol kur', onclick: () => gcHoneypot(guildId, 'role') }),
    el('button', { class: 'btn btn-sm', text: 'Honeypot kapat', onclick: () => gcHoneypot(guildId, 'disable') })
  ]));

  /* --- modüller --- */
  const mods = el('div', { class: 'gc-mods' });
  data.modules.forEach((m) => {
    const on = Boolean(cfg.modules[m.key]);
    mods.append(el('button', {
      class: `chip${on ? ' sel' : ''}`,
      title: m.desc,
      onclick: (e) => { cfg.modules[m.key] = !on; e.currentTarget.classList.toggle('sel', !on); e.currentTarget.querySelector('span').textContent = `${!on ? '●' : '○'} ${m.label}`; }
    }, [el('span', { text: `${on ? '●' : '○'} ${m.label}` })]));
  });
  box.append(el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Modüller' }), mods]));

  /* --- limitler --- */
  const limits = el('div', { class: 'grid cols-4' });
  data.limitActions.forEach((a) => {
    const input = el('input', { class: 'input', type: 'number', min: '1', max: '100', id: `gc-limit-${guildId}-${a.key}` });
    input.value = cfg.limits[a.key] ?? a.def;
    limits.append(el('div', { class: 'field' }, [el('label', { class: 'f', text: a.label }), input]));
  });
  box.append(el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Limitler (pencere içinde)' }), limits]));

  /* --- güvenli liste --- */
  const draft = gcDraft.get(guildId) || cfg.whitelist.map((u) => (typeof u === 'string' ? u : u.id));
  gcDraft.set(guildId, [...draft]);
  const wlBox = el('div', { class: 'chip-row', style: 'display:flex;flex-wrap:wrap;gap:6px' });
  const redrawWl = () => {
    wlBox.innerHTML = '';
    const ids = gcDraft.get(guildId) || [];
    if (!ids.length) wlBox.append(el('span', { class: 'hint', text: 'Güvenli liste boş.' }));
    ids.forEach((id) => {
      const known = cfg.whitelist.find((u) => String(u.id || u) === String(id));
      wlBox.append(el('span', { class: 'chip sel' }, [
        el('span', { text: `${known && known.name && known.name !== id ? known.name : ''} ${id}`.trim() }),
        el('button', {
          class: 'btn btn-sm',
          text: '×',
          style: 'padding:0 4px;margin-left:4px',
          onclick: () => { gcDraft.set(guildId, (gcDraft.get(guildId) || []).filter((x) => String(x) !== String(id))); redrawWl(); }
        })
      ]));
    });
  };
  redrawWl();
  const wlInput = el('input', { class: 'input', placeholder: 'Kullanıcı ID ekle', style: 'max-width:220px' });
  wlInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = String(wlInput.value || '').replace(/[<@!>]/g, '').trim();
    if (!id) return;
    const list = gcDraft.get(guildId) || [];
    if (!list.map(String).includes(id)) gcDraft.set(guildId, [...list, id]);
    wlInput.value = '';
    redrawWl();
  });
  box.append(el('div', { class: 'field' }, [
    el('label', { class: 'f', text: 'Güvenli liste (limitlere ve cezalara takılmaz)' }),
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, [
      wlInput,
      el('button', { class: 'btn btn-sm', text: 'Ekle', onclick: () => { wlInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } })
    ]),
    wlBox
  ]));

  /* --- trend --- */
  if (data.statsSeries?.length) {
    box.append(el('label', { class: 'f', style: 'margin-top:8px', text: '14 günlük müdahale trendi' }));
    const trend = el('div', { class: 'guard-trend' });
    const max = Math.max(1, ...data.statsSeries.map((d) => Math.max(d.blocked || 0, d.deleted || 0, d.honeypot || 0)));
    data.statsSeries.forEach((d) => {
      const col = el('div', { class: 't-col', title: `${d.day} · müdahale ${d.blocked || 0} · silinen ${d.deleted || 0} · honeypot ${d.honeypot || 0}` });
      const bars = el('div', { style: 'flex:1;display:flex;align-items:flex-end;gap:1px;width:100%;justify-content:flex-end' });
      const bar = (val, cls) => el('div', { class: `t-bar ${cls}`, style: `height:${val ? Math.max(6, Math.round((val / max) * 100)) : 0}%` });
      bars.append(bar(d.honeypot || 0, 'b3'), bar(d.deleted || 0, 'b2'), bar(d.blocked || 0, 'b1'));
      col.append(bars, el('div', { class: 't-day', text: d.day.slice(5) }));
      trend.append(col);
    });
    box.append(trend);
  }

  /* --- düğmeler --- */
  box.append(el('div', { class: 'toolbar', style: 'padding:0;margin-top:12px' }, [
    el('button', { class: 'btn btn-primary', text: 'Ayarları kaydet', onclick: () => gcSaveConfig(guildId) }),
    el('button', { class: 'btn', text: 'Test olayı üret', onclick: () => gcTest(guildId) }),
    el('button', { class: 'btn', text: 'Yedek al', onclick: () => gcBackup(guildId) }),
    el('button', { class: 'btn btn-warn', text: 'Yedekten geri yükle', onclick: () => gcRestore(guildId) }),
    el('button', { class: 'btn btn-danger', text: 'PANİK MODU', onclick: () => gcPanic(guildId) }),
    el('button', { class: 'btn btn-danger', text: 'Olay akışını temizle', onclick: () => gcClearEvents(guildId) })
  ]));

  /* --- olaylar + operatör geçmişi --- */
  const evBox = el('div', { id: `gc-events-${guildId}`, style: 'margin-top:10px' });
  evBox.append(el('label', { class: 'f', text: `Guard olayları (${data.events.length})` }));
  if (!data.events.length) evBox.append(el('div', { class: 'empty', text: 'Bu sunucu için guard kaydı yok.' }));
  data.events.slice(0, 20).forEach((e) => {
    const cls = e.type === 'punishment' ? 'punish' : (e.severity || 'low');
    evBox.append(el('div', { class: `ev-row ${cls}` }, [
      el('div', { class: 'ev-ico' }, [iconEl(guardEventIcon(e), 'icon')]),
      el('div', { class: 'ev-body' }, [
        el('div', { class: 'ev-title' }, [el('span', { text: e.title }), e.score != null ? el('span', { class: 'ev-score', text: `skor ${e.score}` }) : null]),
        e.detail ? el('div', { class: 'ev-detail', text: e.detail }) : null,
        (e.actor?.name || e.punishment) ? el('div', { class: 'ev-meta' }, [
          e.actor?.name ? el('span', {}, [el('span', { text: 'Sorumlu: ' }), el('b', { text: e.actor.name })]) : null,
          e.punishment ? el('span', {}, [el('span', { text: 'Ceza: ' }), el('b', { text: e.punishment })]) : null
        ]) : null
      ]),
      el('span', { class: 'ev-time', text: timeAgo(e.at) })
    ]));
  });

  if (data.ops?.length) {
    evBox.append(el('label', { class: 'f', style: 'margin-top:10px', text: `Bu sunucunun operatör geçmişi (${data.ops.length})` }));
    data.ops.slice(0, 10).forEach((o) => {
      evBox.append(el('div', { class: 'log-row', style: 'display:flex;gap:9px' }, [
        el('span', { class: 'ic' }, [iconEl('sliders', 'icon icon-sm')]),
        el('span', { class: 'txt', text: `${GC_OPS_LABEL[o.action] || o.action} — ${o.detail || ''}` }),
        el('span', { class: 'time', text: `${o.actor || 'panel'} · ${timeAgo(o.at)}` })
      ]));
    });
  }
  box.append(evBox);
  return box;
}

async function gcApplyPreset(guildId, preset, label) {
  if (!confirm(`"${label}" hazır ayarı bu sunucuya uygulanacak. Devam?`)) return;
  try {
    const r = await api('/api/guard/center/preset', { method: 'POST', body: { guildId, preset } });
    if (r.statsSeries) {
      const data = gcDetail.get(guildId);
      if (data) data.statsSeries = r.statsSeries;
    }
    gcDetail.delete(guildId);
    gcDetail.set(guildId, await api(`/api/guard/center/guild/detail?guildId=${encodeURIComponent(guildId)}`));
    await loadGuardCenter();
    gcOpen.add(guildId);
    renderGuardCenter();
    toast(`${label} ayarı uygulandı`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcHoneypot(guildId, action) {
  try {
    const r = await api('/api/guard/center/honeypot', { method: 'POST', body: { guildId, action } });
    gcDetail.delete(guildId);
    gcDetail.set(guildId, await api(`/api/guard/center/guild/detail?guildId=${encodeURIComponent(guildId)}`));
    await loadGuardCenter();
    gcOpen.add(guildId);
    renderGuardCenter();
    const label = action === 'setup' ? 'Tuzak kanal hazır 🍯' : action === 'role' ? 'Tuzak rol hazır' : 'Honeypot kapatıldı';
    toast(label, action === 'disable' ? 'warn' : 'ok');
    void r;
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcRestore(guildId) {
  if (!confirm('Yedekten geri yükleme: eksik roller/kanallar yeniden oluşturulacak. Devam?')) return;
  try {
    const r = await api('/api/guard/center/restore', { method: 'POST', body: { guildId } });
    toast(`Geri yüklendi: ${r.roles || 0} rol, ${r.channels || 0} kanal`, 'ok');
    await loadGuardCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcPanic(guildId) {
  if (!confirm('🚨 PANİK MODU\nTüm yetkili roller soyulacak ve davetler silinecek. Bu işlem geri alınamaz. Devam?')) return;
  if (!confirm('Son onay: gerçekten panik modunu çalıştırayım mı?')) return;
  try {
    const r = await api('/api/guard/center/panic', { method: 'POST', body: { guildId } });
    toast(`Panik: ${r.roles || 0} rol alındı, ${r.invites || 0} davet silindi`, 'warn');
    await loadGuardCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

const GC_OPS_LABEL = {
  approve: 'Whitelist’e alındı',
  revoke: 'Whitelist’ten çıkarıldı (sessiz)',
  'silent-on': 'Sessize alındı',
  'silent-off': 'Sessiz mod kaldırıldı',
  'auto-pending': 'Otomatik pasif (yeni sunucu)',
  joined: 'Sunucu eklendi',
  config: 'Ayar güncellendi',
  note: 'Not',
  test: 'Test kaydı',
  backup: 'Yedek',
  restore: 'Yedekten geri yükleme',
  panic: 'PANİK MODU',
  honeypot: 'Honeypot',
  preset: 'Hazır ayar',
  'events-clear': 'Olay akışı temizlendi',
  policy: 'Politika'
};

async function gcToggleDetail(guildId) {
  if (gcOpen.has(guildId)) {
    gcOpen.delete(guildId);
    renderGuardCenter();
    return;
  }
  gcOpen.add(guildId);
  renderGuardCenter();
  try {
    gcDetail.set(guildId, await api(`/api/guard/center/guild/detail?guildId=${encodeURIComponent(guildId)}`));
    renderGuardCenter();
  } catch (err) {
    toast(err.message, 'err');
    gcOpen.delete(guildId);
    renderGuardCenter();
  }
}

async function gcAction(g, action) {
  let reason = null;
  if (action === 'revoke' || action === 'silent') {
    reason = prompt('Sessize alma sebebi (opsiyonel — yalnızca panelde görünür, sunucuya gösterilmez):', g.note || '') || null;
  }
  try {
    const r = await api('/api/guard/center/guild', { method: 'POST', body: { guildId: g.id, action, reason } });
    gcData = r;
    if (gcDetail.has(g.id)) gcDetail.delete(g.id);
    renderGuardCenter();
    const labels = { approve: "whitelist'e alındı — koruma çalışıyor", revoke: "blacklist'e alındı — koruma sessizce durdu", silent: 'sessize alındı', unsilent: 'sessiz mod kaldırıldı', enable: 'görünür koruma açıldı', disable: 'görünür koruma kapatıldı' };
    toast(`${g.name}: ${labels[action] || action}`);
    if (action === 'revoke' || action === 'silent') toast('Sunucu tarafında her şey normal görünmeye devam ediyor.', 'warn');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcSetNote(guildId, text) {
  try {
    const r = await api('/api/guard/center/note', { method: 'POST', body: { guildId, text } });
    if (gcData) {
      const row = gcData.guilds.find((g) => g.id === guildId);
      if (row && r.guild) Object.assign(row, r.guild);
      gcData.ops = r.ops;
    }
    renderGuardCenter();
    toast(text ? 'Not kaydedildi' : 'Not silindi');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcSaveConfig(guildId) {
  const data = gcDetail.get(guildId);
  if (!data) return toast('Detay yüklenmedi', 'warn');
  const limits = {};
  data.limitActions.forEach((a) => {
    const node = $(`#gc-limit-${guildId}-${a.key}`);
    if (node) limits[a.key] = Number(node.value);
  });
  const body = {
    guildId,
    logChannelId: $(`#gc-log-${guildId}`)?.value || null,
    jailRoleId: $(`#gc-jail-${guildId}`)?.value || null,
    punishment: $(`#gc-punish-${guildId}`)?.value,
    windowSeconds: Number($(`#gc-window-${guildId}`)?.value),
    timeoutMinutes: Number($(`#gc-timeout-${guildId}`)?.value),
    honeypot: { action: $(`#gc-honey-action-${guildId}`)?.value },
    ad: { action: $(`#gc-ad-action-${guildId}`)?.value },
    modules: data.guard.modules,
    limits,
    whitelist: gcDraft.get(guildId) || []
  };
  try {
    await api('/api/guard/center/config', { method: 'POST', body });
    gcDetail.delete(guildId);
    gcDetail.set(guildId, await api(`/api/guard/center/guild/detail?guildId=${encodeURIComponent(guildId)}`));
    await loadGuardCenter();
    gcOpen.add(guildId);
    renderGuardCenter();
    toast('Ayarlar kaydedildi', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcTest(guildId) {
  try {
    const r = await api('/api/guard/center/test', { method: 'POST', body: { guildId } });
    const data = gcDetail.get(guildId);
    if (data) data.events = r.events;
    renderGuardCenter();
    toast(`Test kaydı üretildi: ${r.event.title}`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcBackup(guildId) {
  try {
    const r = await api('/api/guard/center/backup', { method: 'POST', body: { guildId } });
    toast(`Yedek alındı: ${r.roles} rol, ${r.channels} kanal`);
    await loadGuardCenter();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function gcClearEvents(guildId) {
  try {
    await api('/api/guard/center/events/clear', { method: 'POST', body: { guildId } });
    const data = gcDetail.get(guildId);
    if (data) data.events = [];
    await loadGuardCenter();
    toast('Olay akışı temizlendi');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderGuardOps() {
  const box = $('#gcOps');
  if (!box || !gcData) return;
  const list = gcData.ops || [];
  box.innerHTML = '';
  $('#gcOpsCount').textContent = list.length;
  if (!list.length) {
    box.innerHTML = '<div class="empty">Henüz operatör işlemi yok.</div>';
    return;
  }
  list.forEach((o) => {
    box.append(el('div', { class: 'log-row', style: 'display:flex;gap:9px;align-items:flex-start' }, [
      el('span', { class: 'ic' }, [iconEl(o.action === 'revoke' || o.action === 'silent-on' ? 'ban' : o.action === 'approve' ? 'check' : 'sliders', 'icon icon-sm')]),
      el('div', { class: 'txt' }, [
        el('div', {}, [el('b', { text: o.guildName || o.guildId || 'Genel' }), el('span', { class: 'tag bot', style: 'margin-left:6px', text: GC_OPS_LABEL[o.action] || o.action })]),
        o.detail ? el('div', { style: 'color:var(--muted);font-size:11.5px', text: o.detail }) : null
      ]),
      el('span', { class: 'time', text: `${o.actor || 'panel'} · ${timeAgo(o.at)}` })
    ]));
  });
}

async function clearGuardOps() {
  try {
    await api('/api/guard/center/ops/clear', { method: 'POST', body: {} });
    if (gcData) gcData.ops = [];
    renderGuardOps();
    toast('Operatör kayıtları temizlendi');
  } catch (err) {
    toast(err.message, 'err');
  }
}


async function copyInvite() {
  try {
    const { url } = await api('/api/bot/invite');
    await navigator.clipboard.writeText(url);
    toast('Davet linki kopyalandı — tarayıcıya yapıştır', 'ok');
  } catch {
    toast('Kopyalanamadı', 'err');
  }
}

/* ============================ KAYITLAR ============================ */
const LOG_ICONS = { ban: 'ban', unban: 'unlock', kick: 'userX', mute: 'micOff', unmute: 'mic', warn: 'alert', channel: 'folder', role: 'tag', site: 'sliders', bot: 'bot', guard: 'shield' };

function renderLogs(box, logs) {
  box.innerHTML = '';
  if (!logs || !logs.length) {
    box.innerHTML = '<div class="empty">Henüz kayıt yok.</div>';
    return;
  }
  for (const l of logs) {
    box.append(
      el('div', { class: 'log-row' }, [
        el('span', { class: 'ic' }, [iconEl(LOG_ICONS[l.type] || 'list', 'icon icon-sm')]),
        el('span', { class: 'txt', text: l.text }),
        el('span', { class: 'time', text: timeAgo(l.at) })
      ])
    );
  }
}

async function loadLogs() {
  try {
    const d = await api('/api/logs');
    renderLogs($('#logList'), d.logs);
  } catch (err) {
    $('#logList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ============================ BAŞLAT ============================ */
/** HTML'de data-icon / data-icon-label ile işaretlenen yerlere ikonları yerleştirir. */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const name = node.getAttribute('data-icon');
    node.removeAttribute('data-icon');
    node.innerHTML = iconSvg(name);
  });
  root.querySelectorAll('[data-icon-label]').forEach((node) => {
    const [name, ...rest] = node.getAttribute('data-icon-label').split(':');
    node.removeAttribute('data-icon-label');
    node.innerHTML = `${iconSvg(name)}<span>${rest.join(':')}</span>`;
  });
}

hydrateIcons();
const passToggle = $('#togglePassBtn');
if (passToggle && !passToggle.innerHTML.trim()) passToggle.innerHTML = iconSvg('eye');
boot();
