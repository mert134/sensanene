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
  settings: null
};

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
  if (!res.ok) throw new Error(data.error || `Hata (${res.status})`);
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
    if (btn) { btn.disabled = false; btn.textContent = '🔓 Giriş Yap'; }
  }
}

function renderLogin(me, hata = '') {
  showLogin();
  const box = $('#loginWarn');
  if (!box) return;
  let html = '';
  if (hata) {
    html += `<div class="warn-box" style="background:rgba(237,66,69,.14);border-color:rgba(237,66,69,.45);color:#ff9c9e"><b>⛔</b> ${esc(hata)}</div>`;
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
        g.icon ? el('img', { src: g.icon, style: 'width:32px;height:32px;border-radius:10px' }) : el('div', { class: 'ico', text: '🏠' }),
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
      el('div', {}, [el('h3', { text: `Sunucu Seç (${state.guilds.length})` }), el('div', { class: 'sub', text: 'Botun bulunduğu tüm sunucuları inceleyip yönetebilirsin' })]),
      el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
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
    $('#pageTitle').textContent = 'Bot Bağlanamadı';
    $('#pageSub').textContent = 'Discord bot ayarlarını tamamlaman gerekiyor';
    $('#sec-dashboard').innerHTML = `
      <div class="card" style="max-width:640px;padding:30px 24px">
        <div style="font-size:40px;margin-bottom:10px">🔴</div>
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
          <a class="btn btn-primary" href="/setup">🔧 Kurulum Teşhisi</a>
          <button class="btn" onclick="location.reload()">↻ Tekrar Dene</button>
        </div>
      </div>`;
    return;
  }

  $('#pageTitle').textContent = 'Sunucu bulunamadı';
  $('#pageSub').textContent = 'Botu bir sunucuya eklemen gerekiyor';
  const inv = me.inviteUrl;
  $('#sec-dashboard').innerHTML = `
    <div class="card" style="text-align:center;padding:50px 20px">
      <div style="font-size:46px;margin-bottom:14px">🤖</div>
      <h3 style="justify-content:center;font-size:18px">Bot çevrimiçi, ama henüz sunucuna eklenmemiş</h3>
      <p style="color:var(--muted);font-size:13.5px;line-height:1.8;margin:12px 0 22px">
        Aşağıdan botu sunucuna ekle (yönetici izniyle). Ekledikten sonra <b>Yenile</b>'ye bas.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        ${inv ? `<a class="btn btn-primary" href="${esc(inv)}" target="_blank" rel="noopener">➕ Botu Sunucuya Ekle</a>` : ''}
        <button class="btn" onclick="copyInvite()">🔗 Linki Kopyala</button>
        <button class="btn btn-ok" onclick="location.reload()">↻ Yenile</button>
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
  dashboard: ['Genel Bakış', 'Sunucu durumu ve bot bilgileri'],
  members: ['Üyeler & Moderasyon', 'Bir üyeye tıkla, işlemi seç'],
  channels: ['Kanallar', 'Oluştur, düzenle, sil'],
  roles: ['Roller', 'Rol oluştur, ver, al'],
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

  if (section === 'dashboard') loadDashboard();
  if (section === 'members') loadMembers();
  if (section === 'channels') { loadChannels(); loadBans(); }
  if (section === 'roles') loadRoles();
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
      `<div style="margin-bottom:6px"><span class="badge green">👑 Panel Kurucusu</span> <span class="hint" style="display:inline">Aşağıdakiler botun bu sunucudaki yetkileridir:</span></div>` +
      keyPerms
        .map(([k, label]) => `<span class="role-chip">${hasBotAdmin || botPerms.includes(k) ? '✅' : '❌'} ${label}</span>`)
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
  for (const m of list) {
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
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: labels[kind] }), el('div', { class: 'sub', text: `${ids.length} üye seçildi` })]), el('button', { class: 'modal-close', text: '✕', onclick: closeModal })]),
    el('div', { class: 'bulk-summary' }, [el('div', {}, [el('b', { text: String(ids.length) }), el('span', { text: 'Seçili üye' })]), el('div', {}, [el('b', { text: kind === 'ban' ? 'Kalıcı' : 'Toplu' }), el('span', { text: 'İşlem tipi' })]), el('div', {}, [el('b', { text: '50' }), el('span', { text: 'İşlem sınırı' })])])
  ];
  if (action) body.push(el('label', { class: 'f', text: 'İşlem' }), action, el('div', { style: 'height:10px' }), el('label', { class: 'f', text: 'Rol' }), role);
  if (duration) body.push(el('label', { class: 'f', text: 'Süre' }), duration);
  if (!roleMode) body.push(el('label', { class: 'f', text: 'Sebep' }), reason);
  body.push(el('button', { class: `btn btn-block ${kind === 'ban' ? 'btn-danger' : 'btn-primary'}`, style: 'margin-top:16px', text: 'İşlemi uygula', onclick: async () => {
    const selectedAction = roleMode ? $('#bulkMemberAction').value : kind;
    const payload = { action: selectedAction, userIds: ids, reason: reason.value, roleId: roleMode ? $('#bulkMemberRole').value : null, durationMs: duration ? Number(duration.value) : null };
    try { const r = await api('/api/mod/bulk', { method: 'POST', body: payload }); toast(`${r.succeeded} başarılı, ${r.failed} başarısız`, r.failed ? 'warn' : 'ok'); closeModal(); state.selectedMembers.clear(); loadMembers(); } catch (e) { toast(e.message, 'err'); }
  } }));
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
    el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
  ]);

  const info = el('div', { class: 'hint', style: 'margin-bottom:14px' });
  info.innerHTML = `
    Katılım: <b>${new Date(m.joinedAt).toLocaleDateString('tr-TR')}</b> ·
    Hesap: <b>${new Date(m.createdAt).toLocaleDateString('tr-TR')}</b>
    ${m.muted ? `<br /><span style="color:var(--yellow)">🔇 Susturulmuş${m.mutedUntil ? ' — bitiş: ' + new Date(m.mutedUntil).toLocaleString('tr-TR') : ' (kalıcı)'}</span>` : ''}
    ${m.warnings.length ? `<br /><span style="color:var(--red)">⚠️ ${m.warnings.length} uyarı</span>` : ''}`;

  // --- İşlem seçimi (admin butonları)
  const actions = [
    ['ban', '🔨', 'Yasakla'],
    ['kick', '👢', 'At'],
    ['mute', '🔇', 'Sustur'],
    ['unmute', '🔊', 'Susturmayı Kaldır'],
    ['warn', '⚠️', 'Uyar'],
    ['roles', '🎭', 'Rol Ver / Al']
  ];
  const actionGrid = el('div', { class: 'action-grid' });
  const detailBox = el('div', { id: 'actionDetail' });

  for (const [key, icon, label] of actions) {
    actionGrid.append(
      el('button', { class: 'action-btn', 'data-action': key, onclick: () => selectAction(key) }, [
        el('span', { text: icon }),
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
        el('button', { class: 'x', text: '✕', title: 'Rolü al', onclick: () => removeRole(m.id, r.id, r.name) })
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
      m.warnings.map((w) => `<div class="log-row"><span class="ic">⚠️</span><span class="txt">${esc(w.reason)} <span class="mono">— ${esc(w.by)}</span></span><span class="time">${timeAgo(w.at)}</span></div>`).join('');
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
        el('button', { class: 'btn btn-warn btn-block', text: '🔇 Sustur', onclick: () => doMod('mute', m.id, { durationMs: chosen }) })
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
        el('button', { class: 'btn btn-danger btn-block', text: '🔨 Yasakla', onclick: () => doMod('ban', m.id) })
      ]));
    } else if (key === 'kick') {
      box.append(el('label', { class: 'f', text: 'Sebep' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. uygunsuz davranış' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-danger btn-block', text: '👢 Sunucudan At', onclick: () => doMod('kick', m.id) })
      ]));
    } else if (key === 'warn') {
      box.append(el('label', { class: 'f', text: 'Uyarı sebebi' }), el('input', { class: 'input', id: 'actReason', placeholder: 'örn. küfür' }));
      box.append(el('div', { class: 'hint', text: '3 uyarıya ulaşan üye otomatik 30 dk susturulur.' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-warn btn-block', text: '⚠️ Uyarı Ver', onclick: () => doMod('warn', m.id) })
      ]));
    } else if (key === 'unmute') {
      box.append(el('div', { class: 'hint', text: 'Timeout veya susturma rolü kaldırılır.' }));
      box.append(el('div', { style: 'margin-top:12px' }, [
        el('button', { class: 'btn btn-ok btn-block', text: '🔊 Susturmayı Kaldır', onclick: () => doMod('unmute', m.id) })
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
const CHANNEL_ICONS = { text: '#️⃣', voice: '🔊', category: '📂', announcement: '📢', stage: '🎙️', forum: '💬' };

async function loadChannels() {
  try {
    const [d, c] = await Promise.all([api('/api/channels'), api('/api/settings')]);
    state.channels = d.channels;
    state.settings = c;
    const valid = new Set(d.channels.map((ch) => ch.id));
    state.selectedChannels = new Set([...state.selectedChannels].filter((id) => valid.has(id)));
    if ($('#channelCount')) $('#channelCount').textContent = d.channels.length;
    renderChannels();
  } catch (err) {
    $('#channelList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function updateBulkBar() {
  const bar = $('#bulkActions');
  const cnt = $('#bulkCount');
  if (!bar || !cnt) return;
  const n = state.selectedChannels.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  cnt.textContent = `${n} seçili`;
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
      el('span', { class: 'ico', text: CHANNEL_ICONS[ch.type] || '❔' }),
      el('div', { class: 'nm', html: `${esc(ch.name)}${ch.locked ? ' <span class="tag warnc">KİLİTLİ</span>' : ''}<small>${ch.type}${ch.topic ? ' · ' + esc(ch.topic.slice(0, 60)) : ''}</small>` }),
      el('div', { class: 'acts' }, [
        el('button', { class: 'btn btn-sm', text: '✏️ Düzenle', onclick: () => editChannel(ch) }),
        el('button', { class: 'btn btn-sm btn-danger', text: '🗑', title: 'Sil', onclick: () => deleteChannel(ch) })
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
          el('span', { text: `📂 ${cat.name} (${others.filter((c) => c.parentId === cat.id).length})` }),
          el('button', { class: 'chip', style: 'padding:2px 8px;font-size:11px', text: groupAllSelected ? 'Grubu bırak' : 'Grubu seç', onclick: () => toggleCategoryGroup(cat.id) })
        ]),
        el('div', { class: 'acts', style: 'display:flex;gap:6px' }, [
          el('button', { class: 'btn btn-sm', text: '✏️ Düzenle', onclick: () => editChannel(cat) }),
          el('button', { class: 'btn btn-sm btn-danger', text: '🗑', title: 'Kategoriyi sil', onclick: () => deleteChannel(cat) })
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
  const applyBtn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: `✏️ ${selectedList.length} Öğeye Uygula` });

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
        progressBox.textContent = `⏳ İşleniyor: ${Math.min(i + chunk.length, items.length)} / ${items.length}…`;
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
      el('div', {}, [el('h3', { text: 'Toplu İsim Değiştir' }), el('div', { class: 'sub', text: `${selectedList.length} kanal / kategori seçili` })]),
      el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
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
  const delBtn = el('button', { class: 'btn btn-danger', text: `🗑 Evet, ${selectedList.length} Öğeyi Sil` });

  const body = [
    el('div', { class: 'modal-head' }, [
      el('div', {}, [el('h3', { text: `${selectedList.length} Öğeyi Sil?` }), el('div', { class: 'sub', text: 'Bu işlem geri alınamaz' })]),
      el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
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
        progressBox.textContent = `⏳ Siliniyor: ${Math.min(i + chunk.length, ids.length)} / ${ids.length}…`;
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
      el('div', { class: 'ico', style: 'font-size:26px', text: CHANNEL_ICONS[ch.type] || '❔' }),
      el('div', {}, [el('h3', { text: 'Kanalı Düzenle' }), el('div', { class: 'sub', text: ch.type })]),
      el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
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
        el('div', {}, [el('b', { text: 'Kanala mesaj gönder' }), el('span', { text: 'Mesaj bot hesabından gönderilir.' })]),
        el('span', { class: `lock-status ${ch.locked ? 'locked' : ''}`, text: ch.locked ? 'Yazmaya kapalı' : 'Yazmaya açık' })
      ]),
      el('textarea', { class: 'input', id: 'channelMessage', rows: '4', maxlength: '2000', placeholder: 'Gönderilecek mesajı yaz…' }),
      el('label', { class: 'mention-option' }, [el('input', { type: 'checkbox', id: 'channelAllowMentions' }), el('span', { text: 'Kullanıcı ve rol etiketlerine izin ver' })]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-primary', text: 'Mesajı gönder', onclick: () => sendChannelMessage(ch) }),
        el('button', { class: `btn ${ch.locked ? 'btn-ok' : 'btn-danger'}`, text: ch.locked ? 'Kanal kilidini aç' : 'Kanalı kilitle', onclick: () => toggleChannelLock(ch) })
      ])
    ]));
  }
  body.push(el('div', { class: 'row', style: 'margin-top:14px' }, [
    el('button', { class: 'btn btn-primary', text: '💾 Kaydet', onclick: () => saveChannel(ch) }),
    el('button', { class: 'btn btn-danger', text: '🗑 Kanalı Sil', onclick: () => { closeModal(); deleteChannel(ch); } })
  ]));
  openModal(body);
}

async function sendChannelMessage(ch) {
  const input = $('#channelMessage');
  const content = (input?.value || '').trim();
  if (!content) return toast('Gönderilecek mesajı yaz', 'warn');
  try {
    const r = await api('/api/channels/message', { method: 'POST', body: { channelId: ch.id, content, allowMentions: Boolean($('#channelAllowMentions')?.checked) } });
    if (!r.ok) return toast(r.error || 'Mesaj gönderilemedi', 'err');
    input.value = '';
    toast('Mesaj kanala gönderildi', 'ok');
  } catch (err) { toast(err.message, 'err'); }
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
      el('button', { class: 'btn btn-danger', text: '🗑 Evet, sil', onclick: async () => {
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
      el('div', {}, [el('h3', { text: 'Kanal Oluştur' }), el('div', { class: 'sub', text: 'Metin, ses veya kategori' })]),
      el('button', { class: 'modal-close', text: '✕', onclick: closeModal })
    ]),
    el('label', { class: 'f', text: 'Kanal adı' }),
    el('input', { class: 'input', id: 'newChName', placeholder: 'genel-sohbet' }),
    el('div', { style: 'height:12px' }),
    el('label', { class: 'f', text: 'Tür' }),
    el('select', { class: 'input', id: 'newChType' }, [
      el('option', { value: 'text', text: '📝 Metin kanalı' }),
      el('option', { value: 'voice', text: '🔊 Ses kanalı' }),
      el('option', { value: 'category', text: '📂 Kategori' }),
      el('option', { value: 'announcement', text: '📢 Duyuru kanalı' })
    ]),
    el('div', { style: 'height:12px' }),
    el('label', { class: 'f', text: 'Kategori (opsiyonel)' }),
    el('select', { class: 'input', id: 'newChParent' }, [
      el('option', { value: '', text: '— yok —' }),
      ...state.channels.filter((c) => c.type === 'category').map((c) => el('option', { value: c.id, text: c.name }))
    ]),
    el('div', { style: 'margin-top:16px' }, [
      el('button', { class: 'btn btn-primary btn-block', text: '➕ Oluştur', onclick: async () => {
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
  openModal([
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Toplu kanal oluştur' }), el('div', { class: 'sub', text: 'Her satıra bir kanal adı — en fazla 50' })]), el('button', { class: 'modal-close', text: '✕', onclick: closeModal })]),
    el('label', { class: 'f', text: 'Kanal adları' }),
    el('textarea', { class: 'input', id: 'bulkChannelNames', rows: '9', placeholder: 'genel-sohbet\noyun-odası\nmüzik\nyayıncılar' }),
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('select', { class: 'input', id: 'bulkChannelType' }, [el('option', { value: 'text', text: 'Metin kanalı' }), el('option', { value: 'voice', text: 'Ses kanalı' }), el('option', { value: 'category', text: 'Kategori' }), el('option', { value: 'announcement', text: 'Duyuru kanalı' })]),
      el('select', { class: 'input', id: 'bulkChannelParent' }, [el('option', { value: '', text: 'Kategori yok' }), ...categories.map((c) => el('option', { value: c.id, text: c.name }))])
    ]),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px', text: 'Kanalları oluştur', onclick: async () => {
      const names = $('#bulkChannelNames').value.split(/\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
      if (!names.length) return toast('En az bir kanal adı gir', 'warn');
      try { const r = await api('/api/channels/bulk/create', { method: 'POST', body: { names, type: $('#bulkChannelType').value, categoryId: $('#bulkChannelParent').value || null } }); toast(`${r.created} kanal oluşturuldu${r.failed ? `, ${r.failed} başarısız` : ''}`, r.failed ? 'warn' : 'ok'); closeModal(); loadChannels(); } catch (e) { toast(e.message, 'err'); }
    } })
  ]);
}

async function loadBans() {
  try {
    const d = await api('/api/bans');
    $('#banCount').textContent = d.bans.length;
    const box = $('#banList');
    box.innerHTML = '';
    if (!d.bans.length) {
      box.innerHTML = '<div class="empty">Yasaklı üye yok. 🎉</div>';
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
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Toplu yasak kaldırma' }), el('div', { class: 'sub', text: 'Her satıra bir Discord kullanıcı ID’si' })]), el('button', { class: 'modal-close', text: '✕', onclick: closeModal })]),
    el('textarea', { class: 'input', id: 'bulkUnbanIds', rows: '7', placeholder: '123456789012345678\n987654321098765432' }),
    el('input', { class: 'input', id: 'bulkUnbanReason', style: 'margin-top:10px', placeholder: 'Sebep (opsiyonel)' }),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Yasakları kaldır', onclick: async () => {
      const userIds = $('#bulkUnbanIds').value.split(/\s|,/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
      if (!userIds.length) return toast('Kullanıcı ID’si gir', 'warn');
      try { const r = await api('/api/mod/bulk', { method: 'POST', body: { action: 'unban', userIds, reason: $('#bulkUnbanReason').value } }); toast(`${r.succeeded} yasak kaldırıldı, ${r.failed} başarısız`, r.failed ? 'warn' : 'ok'); closeModal(); loadBans(); } catch (e) { toast(e.message, 'err'); }
    } })
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
    el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Toplu rol oluştur' }), el('div', { class: 'sub', text: 'Her satıra bir rol adı' })]), el('button', { class: 'modal-close', text: '✕', onclick: closeModal })]),
    el('textarea', { class: 'input', id: 'bulkRoleNames', rows: '8', placeholder: 'Yönetici\nModeratör\nVIP\nÜye' }),
    el('label', { class: 'f', style: 'margin-top:12px', text: 'Rol rengi' }), el('input', { type: 'color', class: 'input', id: 'bulkRoleColor', value: '#5865f2', style: 'height:44px' }),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Rolleri oluştur', onclick: async () => { const names = $('#bulkRoleNames').value.split(/\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 50); if (!names.length) return toast('Rol adı gir', 'warn'); const color = $('#bulkRoleColor').value; try { const r = await api('/api/roles/bulk', { method: 'POST', body: { action: 'create', items: names.map((name) => ({ name, color })) } }); toast(`${r.succeeded} rol oluşturuldu`, r.failed ? 'warn' : 'ok'); closeModal(); loadRoles(); } catch (e) { toast(e.message, 'err'); } } })
  ]);
}
function editRole(role) {
  openModal([el('div', { class: 'modal-head' }, [el('div', {}, [el('h3', { text: 'Rolü düzenle' }), el('div', { class: 'sub', text: role.name })]), el('button', { class: 'modal-close', text: '✕', onclick: closeModal })]), el('label', { class: 'f', text: 'Rol adı' }), el('input', { class: 'input', id: 'editRoleName', value: role.name }), el('label', { class: 'f', style: 'margin-top:12px', text: 'Renk' }), el('input', { type: 'color', class: 'input', id: 'editRoleColor', value: role.color === '#000000' ? '#99aab5' : role.color, style: 'height:44px' }), el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', text: 'Kaydet', onclick: async () => { try { const r = await api('/api/roles/edit', { method: 'POST', body: { roleId: role.id, name: $('#editRoleName').value, color: $('#editRoleColor').value } }); toast(r.message, 'ok'); closeModal(); loadRoles(); } catch (e) { toast(e.message, 'err'); } } })]);
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
            el('span', { class: 'rank', text: ['🥇', '🥈', '🥉'][i] || `#${i + 1}` }),
            u.avatar ? el('img', { src: u.avatar }) : el('div', {}),
            el('span', { text: u.name }),
            el('span', { class: 'coins', text: `${u.coins} 💰` })
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
    $('#othMsg').innerHTML = `🪙 Sonuç: <b>${res.result}</b> — ${res.won ? `<span style="color:var(--green)">+${res.payout} coin</span>` : `<span style="color:var(--red)">-${res.bet} coin</span>`} · Bakiye: ${res.balance}`;
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
    $('#othMsg').innerHTML = `🎲 Zar: <b>${res.result}</b> — ${res.won ? `<span style="color:var(--green)">+${res.payout} coin</span>` : `<span style="color:var(--red)">-${res.bet} coin</span>`} · Bakiye: ${res.balance}`;
    loadGame();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function claimDaily() {
  try {
    const res = await api('/api/play/daily', { method: 'POST' });
    if (res.ok) {
      toast(`🎁 +${res.amount} coin aldın!`, 'ok');
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
const LOG_ICONS = { ban: '🔨', unban: '🔓', kick: '👢', mute: '🔇', unmute: '🔊', warn: '⚠️', channel: '📁', role: '🎭', site: '🖥️', bot: '🤖' };

function renderLogs(box, logs) {
  box.innerHTML = '';
  if (!logs || !logs.length) {
    box.innerHTML = '<div class="empty">Henüz kayıt yok.</div>';
    return;
  }
  for (const l of logs) {
    box.append(
      el('div', { class: 'log-row' }, [
        el('span', { class: 'ic', text: LOG_ICONS[l.type] || '•' }),
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
boot();
