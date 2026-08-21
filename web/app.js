/* ChatHub Web Client —— 单文件前端逻辑
   API: REST + WebSocket (Node.js + SQLite backend) */
(function(){
'use strict';

const STORAGE = {
  TOKEN: 'chathub.token',
  SERVER: 'chathub.server',
  USER: 'chathub.user',
};

const DEFAULT_SERVER = 'http://localhost:8787';
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','🤔','😎','🥳','😭','😡','🤯','😱','🤗','🙄','😴','🤮','🤩','🥺','😏','😇','🤠','🤡','👻','💀','👽','🤖','💩','😺','🙈','🙉','🙊','💯','✅','❌','⭐','🔥','💎','🎉','🎊','👍','👎','👋','🤝','🙏','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💞','💓','💗','💖','💘','💝','💟','👀','✨','⚡','🌈','☀️','🌙','⭐','💫','🎯','📌','📝','📎','🖼️','🎨','🎵','🔔','🔕','🐛','🚀','🛸','💡','🧠','📚','💻','⌨️','🖥️','🖱️','🗂️','☕','🍕','🍔','🍺','🍷','🥤','🐍','🦀','🦞','🐳','🦄'];

// ===== Mini HTTP client =====
function api(server, method, path, body, token) {
  const url = server + path;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(async (r) => {
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || ('HTTP ' + r.status);
      const e = new Error(msg);
      e.status = r.status;
      e.data = data;
      throw e;
    }
    return data;
  });
}

function uploadImage(server, token, file) {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(server + '/api/uploads', {
    method: 'POST',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    body: fd,
  }).then(async (r) => {
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error((d && (d.error || d.message)) || '上传失败');
    return d;
  });
}

// ===== Public API object (used by auth page) =====
const CH = {
  server() { return localStorage.getItem(STORAGE.SERVER) || DEFAULT_SERVER; },
  setServer(v) { localStorage.setItem(STORAGE.SERVER, v); },
  getToken() { return localStorage.getItem(STORAGE.TOKEN); },
  saveToken(t) { localStorage.setItem(STORAGE.TOKEN, t); },
  clearToken() { localStorage.removeItem(STORAGE.TOKEN); localStorage.removeItem(STORAGE.USER); },
  call(path, method, body) { return api(this.server(), method, path, body, this.getToken()); },
  boot() { /* noop here, main app does full boot */ },
  toast(msg, type) { showToast(msg, type); },
};
window.ChatHub = CH;

// ===== Toast =====
let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) { alert(msg); return; }
  const ic = document.getElementById('toast-ic');
  const txt = document.getElementById('toast-txt');
  el.className = 'toast show ' + (type === 'err' ? 'err' : 'ok');
  ic.textContent = type === 'err' ? '✕' : '✓';
  txt.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ===== Helpers =====
function $(id){ return document.getElementById(id); }
function el(tag, attrs, children){
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
    else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  }
  if (children) for (const c of Array.isArray(children) ? children : [children]) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
function fmtTime(ts){
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dayKey(ts){ const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ts){
  const d = new Date(ts); const n = new Date();
  const diffDays = Math.floor((new Date(n.getFullYear(),n.getMonth(),n.getDate()) - new Date(d.getFullYear(),d.getMonth(),d.getDate())) / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return diffDays + ' 天前';
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}
function colorFor(name){
  const colors = ['#E53935','#D81B60','#8E24AA','#5E35B1','#3949AB','#1E88E5','#039BE5','#00ACC1','#00897B','#43A047','#7CB342','#C0CA33','#FDD835','#FB8C00','#F4511E','#6D4C41'];
  let h = 0; for (const c of String(name||'')) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}
function initial(name){
  const s = String(name || '?').trim();
  return s ? s[0].toUpperCase() : '?';
}

// ===== Markdown-lite rendering (bold, inline code, code fences, @mentions) =====
const KNOWN_LANGS = ['javascript','js','typescript','ts','python','py','swift','rust','go','java','kotlin','c','cpp','c++','c#','cs','ruby','php','shell','bash','sh','sql','html','css','json','yaml','yml','toml','ini','md','markdown','text'];
let knownUserMap = new Map(); // lowercase name -> user info

function setKnownUsers(users){
  knownUserMap = new Map();
  for (const u of users || []) knownUserMap.set(String(u.username||'').toLowerCase(), u);
}

function renderContent(text, options){
  options = options || {};
  let html = escapeHtml(text || '');

  // Code fences ```lang ... ```
  const blocks = [];
  html = html.replace(/```([A-Za-z0-9_+\-#]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const id = blocks.length;
    const L = (lang || '').toLowerCase();
    const displayLang = KNOWN_LANGS.includes(L) ? L : (lang || 'code');
    blocks.push(`<pre><div class="code-head"><span>${escapeHtml(displayLang)}</span><button class="code-copy" data-code="${encodeURIComponent(code)}">复制</button></div><code>${code}</code></pre>`);
    return `\x00CB${id}\x00`;
  });

  // Inline code `x`
  html = html.replace(/`([^`\n]+)`/g, (m, c) => `<code>${c}</code>`);

  // @mentions
  html = html.replace(/@([A-Za-z0-9_\u4e00-\u9fa5]{2,24})/g, (m, name) => {
    const u = knownUserMap.get(name.toLowerCase());
    if (u || options.allowUnresolvedMentions) return `<span class="mention" title="${u ? '@'+u.username : '未找到用户'}">@${escapeHtml(name)}</span>`;
    return m;
  });

  // Bold **x**
  html = html.replace(/\*\*([^*<]+)\*\*/g, '<b>$1</b>');

  // Restore code blocks
  html = html.replace(/\x00CB(\d+)\x00/g, (m, id) => blocks[id] || '');

  return html;
}

// ===== State =====
const State = {
  me: null,
  token: null,
  server: DEFAULT_SERVER,
  channels: [],
  categories: [],
  users: [],
  messages: [],
  dmUsers: [], // user list of open DMs
  current: { kind: 'channel', id: 'general' }, // or {kind:'dm', id:userId}
  ws: null,
  wsReconnectTimer: null,
  onlineUserIds: new Set(),
  attachments: [], // pending to send
  // Q&A
  questions: [],
  selectedQid: null,
  tags: [],
  // Admin
  adminStats: null,
  adminUsers: [],
};

// ===== API wrappers =====
function call(path, method, body){ return api(State.server, method, path, body, State.token); }

// ===== Authentication guard =====
function ensureAuth(){
  State.token = CH.getToken();
  State.server = CH.server();
  if (!State.token) { location.href = 'auth.html'; return false; }
  return true;
}

// ===== WebSocket =====
function wsConnect(){
  if (State.ws) { try { State.ws.close(); } catch {} }
  const proto = State.server.startsWith('https://') ? 'wss://' : 'ws://';
  const host = State.server.replace(/^https?:\/\//,'');
  const url = `${proto}${host}/ws?token=${encodeURIComponent(State.token)}`;
  let ws;
  try { ws = new WebSocket(url); } catch (e) { setWsStatus(false); scheduleReconnect(); return; }
  State.ws = ws;

  ws.addEventListener('open', () => { setWsStatus(true); });
  ws.addEventListener('close', () => { setWsStatus(false); scheduleReconnect(); });
  ws.addEventListener('error', () => { setWsStatus(false); scheduleReconnect(); try{ws.close();}catch{} });
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    handleWsEvent(m);
  });
}
function scheduleReconnect(){
  if (State.wsReconnectTimer) return;
  State.wsReconnectTimer = setTimeout(() => { State.wsReconnectTimer = null; wsConnect(); }, 3500);
}
function setWsStatus(ok){
  const b = $('ws-status');
  if (!b) return;
  b.style.borderColor = ok ? 'var(--green)' : 'var(--red)';
  b.style.color = ok ? 'var(--green)' : 'var(--red)';
  b.textContent = ok ? '●' : '○';
  b.title = ok ? 'WebSocket 已连接' : 'WebSocket 未连接（将自动重连）';
}
function handleWsEvent(m){
  switch (m.type) {
    case 'hello':
      State.me = m.user;
      State.onlineUserIds = new Set(m.onlineUserIds || []);
      renderMe(); renderOnlineList();
      break;
    case 'channel_message':
      if (State.current.kind === 'channel' && State.current.id === m.channel_id) {
        appendMessage(m.message);
      }
      break;
    case 'dm_message': {
      const other = State.me.id === m.message.sender_id ? m.message.recipient_id : m.message.sender_id;
      if (State.current.kind === 'dm' && State.current.id === other) appendMessage(m.message);
      break;
    }
    case 'message_updated':
      updateMessage(m.message_id, m.message);
      break;
    case 'message_deleted':
      removeMessage(m.message_id);
      break;
    case 'reaction': {
      const msgEl = document.querySelector(`[data-msg-id="${m.message_id}"] .msg-reactions`);
      if (msgEl) {
        msgEl.innerHTML = m.reactions.map(r => {
          const mine = (r.user_ids || []).includes(State.me && State.me.id);
          return `<button class="react ${mine?'me':''}" onclick="toggleReact('${m.message_id}','${r.emoji}')">${r.emoji}<span class="c">${r.count}</span></button>`;
        }).join('');
      }
      break;
    }
    case 'presence':
      if (m.user_ids) State.onlineUserIds = new Set(m.user_ids);
      if (m.user_id && m.online) State.onlineUserIds.add(m.user_id);
      if (m.user_id && !m.online) State.onlineUserIds.delete(m.user_id);
      renderOnlineList();
      break;
    case 'new_question':
    case 'question_updated':
    case 'answer_added':
    case 'answer_accepted':
    case 'question_deleted':
      if ($('q-list')) loadQuestions();
      break;
    case 'banned':
      if (m.user_id === (State.me && State.me.id)) {
        CH.clearToken();
        showToast('账号已被管理员封禁', 'err');
        setTimeout(() => location.href = 'auth.html', 800);
      }
      break;
  }
}

// ===== Rendering: Me =====
function renderMe(){
  if (!State.me) return;
  const av = $('me-avatar');
  av.textContent = initial(State.me.display_name || State.me.username);
  av.style.background = State.me.avatar_color || colorFor(State.me.username);
  $('me-name').textContent = State.me.display_name || State.me.username;
  $('me-sub').textContent = State.me.is_admin ? '🛡️ 管理员' : '已登录';
  $('nav-admin').style.display = State.me.is_admin ? '' : 'none';
}

// ===== Rendering: Sidebar nav =====
function renderSidebar(){
  // Channels
  const cl = $('channel-list');
  cl.innerHTML = '';
  for (const c of State.channels) {
    const isActive = State.current.kind === 'channel' && State.current.id === c.id;
    const item = el('div', {
      class: 'nav-item' + (isActive ? ' active' : ''),
      onclick: () => selectChannel(c.id),
    }, [
      el('span',{class:'ic'},'#'),
      el('span',{class:'lbl'}, c.name),
    ]);
    cl.appendChild(item);
  }
}

function renderOnlineList(){
  const box = $('online-list');
  if (!box) return;
  box.innerHTML = '';
  const users = [...State.users].sort((a,b) => {
    const ao = State.onlineUserIds.has(a.id) ? 0 : 1;
    const bo = State.onlineUserIds.has(b.id) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.username||'').localeCompare(b.username||'');
  });
  const meId = State.me && State.me.id;
  let onlineCount = 0;
  for (const u of users) {
    if (u.id === meId) continue;
    const online = State.onlineUserIds.has(u.id);
    if (online) onlineCount++;
    const row = el('div', {
      class:'online-item',
      onclick: () => selectDM(u.id),
    }, [
      (() => {
        const av = el('div',{class:'av'});
        av.style.background = u.avatar_color || colorFor(u.username);
        av.textContent = initial(u.display_name || u.username);
        if (online) av.appendChild(el('div',{class:'dot-on'}));
        return av;
      })(),
      el('div',{}, [
        el('div',{class:'u-name'}, u.display_name || u.username),
        el('div',{class:'u-sub'}, (u.is_admin ? '🛡️ 管理员 · ' : '') + (online ? '在线' : '离线')),
      ]),
    ]);
    box.appendChild(row);
  }
  const c = $('online-count'); if (c) c.textContent = '· ' + onlineCount;
}

// ===== Current channel =====
function selectChannel(id){
  State.current = { kind: 'channel', id };
  renderSidebar();
  const c = State.channels.find(x => x.id === id);
  $('cur-hash').textContent = '#';
  $('cur-ch').textContent = c ? c.name : id;
  $('cur-topic').textContent = c ? (c.description || c.category || '') : '';
  $('input').placeholder = `发消息给 #${c?c.name:id}… Enter 发送, Shift+Enter 换行`;
  loadMessages();
}
function selectDM(userId){
  State.current = { kind: 'dm', id: userId };
  renderSidebar();
  const u = State.users.find(x => x.id === userId);
  $('cur-hash').textContent = '💬 ';
  $('cur-ch').textContent = u ? (u.display_name || u.username) : '私聊';
  $('cur-topic').textContent = u ? `与 @${u.username} 的一对一私聊` : '';
  $('input').placeholder = u ? `发送给 @${u.username}…` : '发消息…';
  loadMessages();
}

// ===== Messages =====
async function loadMessages(){
  const box = $('messages');
  box.innerHTML = '';
  let msgs = [];
  try {
    if (State.current.kind === 'channel') {
      const r = await call(`/api/channels/${encodeURIComponent(State.current.id)}/messages?limit=100`, 'GET');
      msgs = r.messages || [];
    } else {
      const r = await call(`/api/dms/${encodeURIComponent(State.current.id)}/messages?limit=100`, 'GET');
      msgs = r.messages || [];
    }
  } catch (e) {
    box.innerHTML = `<div class="empty"><div class="big">⚠️</div><h4>加载消息失败</h4><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }
  State.messages = msgs;
  setKnownUsers(State.users);

  let lastDay = null;
  for (const m of msgs) {
    const k = dayKey(m.created_at);
    if (k !== lastDay) {
      lastDay = k;
      const sep = el('div',{class:'day-divider'}, dayLabel(m.created_at));
      box.appendChild(sep);
    }
    box.appendChild(buildMessageEl(m));
  }
  box.scrollTop = box.scrollHeight;
}

function appendMessage(m){
  // day divider
  const box = $('messages');
  const last = State.messages[State.messages.length - 1];
  if (!last || dayKey(last.created_at) !== dayKey(m.created_at)) {
    box.appendChild(el('div',{class:'day-divider'}, dayLabel(m.created_at)));
  }
  State.messages.push(m);
  setKnownUsers(State.users);
  box.appendChild(buildMessageEl(m));
  box.scrollTop = box.scrollHeight;
}

function updateMessage(msgId, newMsg){
  const idx = State.messages.findIndex(m => m.id === msgId);
  if (idx < 0) return;
  State.messages[idx] = newMsg;
  const old = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!old) return;
  const fresh = buildMessageEl(newMsg);
  old.replaceWith(fresh);
}
function removeMessage(msgId){
  State.messages = State.messages.filter(m => m.id !== msgId);
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) el.remove();
}

function buildMessageEl(m){
  const meId = State.me && State.me.id;
  const isMe = m.author_id === meId || m.sender_id === meId;
  const author = m.author || (() => {
    const u = State.users.find(x => x.id === (m.sender_id || m.author_id));
    return u ? { username: u.username, display_name: u.display_name, avatar_color: u.avatar_color } : { username:'?', display_name:'未知用户', avatar_color:'#888' };
  })();

  const row = el('div', { class:'msg' + (isMe ? ' me' : ''), 'data-msg-id': m.id });

  const av = el('div', { class:'av' });
  av.style.background = author.avatar_color || colorFor(author.username || '');
  av.textContent = initial(author.display_name || author.username || '?');
  row.appendChild(av);

  const body = el('div',{class:'msg-body'});
  const meta = el('div',{class:'msg-meta'}, [
    el('span',{class:'msg-who'}, author.display_name || author.username || '匿名'),
    el('span',{class:'msg-time'}, fmtTime(m.created_at) + (m.update_time ? ' · 已编辑' : '')),
  ]);
  body.appendChild(meta);

  const bubble = el('div',{class:'msg-bubble'});
  bubble.innerHTML = renderContent(m.content);
  // Code copy buttons -> events
  bubble.querySelectorAll('.code-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = decodeURIComponent(btn.dataset.code || '');
      navigator.clipboard && navigator.clipboard.writeText(code);
      const old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => btn.textContent = old, 1200);
    });
  });
  body.appendChild(bubble);

  // Attachments
  if (m.attachments && m.attachments.length) {
    const ab = el('div',{class:'msg-attachments'});
    for (const a of m.attachments) {
      if (a.type === 'image') {
        const src = `${State.server}/files/${a.key}`;
        const img = el('img',{src, onclick: () => window.open(src, '_blank')});
        ab.appendChild(img);
      }
    }
    body.appendChild(ab);
  }

  // Reactions
  const reactBox = el('div',{class:'msg-reactions'});
  for (const r of (m.reactions || [])) {
    const mine = (r.user_ids || []).includes(meId);
    const b = el('button',{
      class:'react' + (mine ? ' me' : ''),
      onclick: () => toggleReact(m.id, r.emoji),
    }, [r.emoji, ' ', el('span',{class:'c'}, String(r.count))]);
    reactBox.appendChild(b);
  }
  body.appendChild(reactBox);

  // Actions (edit/delete for own messages)
  if (isMe) {
    const acts = el('div',{class:'msg-actions'});
    acts.appendChild(el('button',{class:'msg-act', onclick: () => startEdit(m.id)}, '✏️ 编辑'));
    acts.appendChild(el('button',{class:'msg-act', onclick: () => deleteMsg(m.id)}, '🗑️ 删除'));
    body.appendChild(acts);
  }

  row.appendChild(body);
  return row;
}

// ===== Send message =====
let editingId = null;

function startEdit(msgId){
  const m = State.messages.find(x => x.id === msgId);
  if (!m) return;
  editingId = msgId;
  $('input').value = m.content;
  $('send-btn').textContent = '保存编辑 ⏎';
  $('input').focus();
  showToast('正在编辑消息，按 Enter 保存', 'ok');
}

async function deleteMsg(msgId){
  if (!confirm('确定删除这条消息吗？')) return;
  try {
    await call(`/api/messages/${encodeURIComponent(msgId)}`, 'DELETE');
    showToast('已删除', 'ok');
  } catch (e) { showToast(e.message || '删除失败', 'err'); }
}

window.toggleReact = async function(msgId, emoji){
  try {
    await call(`/api/messages/${encodeURIComponent(msgId)}/reactions`, 'POST', { emoji });
  } catch (e) { showToast(e.message || '操作失败', 'err'); }
};
window.insertCodeBlock = function(){
  const ta = $('input'); const v = ta.value || '';
  const sp = ta.selectionStart; const ep = ta.selectionEnd;
  const ins = '\n```javascript\n// 在这里写代码\n```\n';
  ta.value = v.slice(0, sp) + ins + v.slice(ep);
  ta.focus(); ta.selectionStart = ta.selectionEnd = sp + 18;
  autoResize();
};

function autoResize(){
  const ta = $('input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

async function send(){
  const ta = $('input');
  const text = (ta.value || '').replace(/\s+$/,'');
  if (!text && State.attachments.length === 0) return;

  const btn = $('send-btn'); btn.disabled = true;
  try {
    const attachments = State.attachments.slice();
    if (editingId) {
      await call(`/api/messages/${encodeURIComponent(editingId)}`, 'PUT', { content: text });
      editingId = null;
      btn.textContent = '发送 ⏎';
    } else {
      const body = { content: text, attachments };
      if (State.current.kind === 'channel') {
        await call(`/api/channels/${encodeURIComponent(State.current.id)}/messages`, 'POST', body);
      } else {
        await call(`/api/dms/${encodeURIComponent(State.current.id)}/messages`, 'POST', body);
      }
    }
    ta.value = ''; State.attachments = []; renderPreviews(); autoResize();
  } catch (e) {
    showToast(e.message || '发送失败', 'err');
  } finally { btn.disabled = false; }
}

// ===== Image upload =====
function setupAttach(){
  const input = $('img-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.value = '';
    for (const f of files) {
      if (!f.type.startsWith('image/')) { showToast('只能上传图片', 'err'); continue; }
      if (f.size > 8 << 20) { showToast('图片过大（>8MB）', 'err'); continue; }
      if (State.attachments.length >= 4) { showToast('一次最多 4 张图', 'err'); break; }
      try {
        showToast(`正在上传 ${f.name}…`, 'ok');
        const r = await uploadImage(State.server, State.token, f);
        State.attachments.push({ type:'image', key: r.key, width: r.width||0, height: r.height||0 });
        renderPreviews();
      } catch (e) { showToast('上传失败: ' + e.message, 'err'); }
    }
  });
}
function renderPreviews(){
  const box = $('preview-imgs');
  if (!box) return;
  box.innerHTML = '';
  State.attachments.forEach((a, i) => {
    const src = `${State.server}/files/${a.key}`;
    const wrap = el('div',{class:'prev-img'}, [
      el('img',{src}),
      el('button',{class:'x', title:'移除', onclick: () => { State.attachments.splice(i,1); renderPreviews(); }}, '✕'),
    ]);
    box.appendChild(wrap);
  });
}

// ===== Emoji =====
function setupEmoji(){
  const grid = $('emoji-grid'); if (!grid) return;
  for (const e of EMOJIS) {
    const b = el('button',{onclick: () => {
      const ta = $('input'); const v = ta.value || '';
      const sp = ta.selectionStart; const ep = ta.selectionEnd;
      ta.value = v.slice(0, sp) + e + v.slice(ep);
      ta.focus(); ta.selectionStart = ta.selectionEnd = sp + e.length;
      autoResize();
      $('emoji-panel').classList.remove('show');
    }}, e);
    grid.appendChild(b);
  }
  $('emoji-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('emoji-panel').classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    const p = $('emoji-panel'); if (!p) return;
    if (!p.contains(e.target) && e.target.id !== 'emoji-btn') p.classList.remove('show');
  });
}

// ===== Q&A =====
async function loadTags(){
  try { const r = await call('/api/tags','GET'); State.tags = r.tags || []; } catch {}
  const sel = $('q-tags'); if (!sel) return;
  sel.innerHTML = '';
  for (const t of State.tags) {
    sel.appendChild(el('option',{value:t.id}, t.name));
  }
}
async function loadQuestions(){
  try {
    const r = await call('/api/questions?limit=50','GET');
    State.questions = r.questions || [];
  } catch(e) { State.questions = []; }
  renderQuestionList();
}
function renderQuestionList(){
  const box = $('q-list'); if (!box) return;
  if (!State.questions.length) {
    box.innerHTML = `<div class="empty"><div class="big">📭</div><h4>还没有问题</h4><p>点击右上角「+ 发起提问」来提第一个问题。</p></div>`;
    return;
  }
  box.innerHTML = '';
  for (const q of State.questions) {
    const tags = (q.tags || []).map(t => el('span',{class:'q-tag'}, t.name));
    if (q.accepted_answer_id) tags.push(el('span',{class:'q-tag accepted'}, '✓ 已解决'));
    const author = q.author ? (q.author.display_name || q.author.username) : '匿名';
    const el2 = el('div', {
      class:'q-item' + (State.selectedQid === q.id ? ' active' : ''),
      onclick: () => selectQuestion(q.id),
    }, [
      el('div',{class:'q-title'}, q.title),
      el('div',{class:'q-meta'}, [
        el('span',{}, '👤 ' + author),
        el('span',{}, '💬 ' + (q.answers_count || 0)),
        el('span',{}, fmtTime(q.created_at)),
      ]),
      el('div',{class:'q-meta', style:'margin-top:8px'}, [ el('div',{class:'q-tags'}, tags) ]),
    ]);
    box.appendChild(el2);
  }
}
async function selectQuestion(qid){
  State.selectedQid = qid;
  renderQuestionList();
  const detail = $('q-detail'); if (!detail) return;
  try {
    const r = await call(`/api/questions/${encodeURIComponent(qid)}`,'GET');
    const q = r.question;
    detail.innerHTML = '';
    detail.appendChild(el('h2',{}, q.title));
    const author = q.author ? (q.author.display_name || q.author.username) : '匿名';
    detail.appendChild(el('div',{class:'q-meta',style:'font-size:12px;color:var(--muted);margin-bottom:12px'},
      `👤 ${author} · 💬 ${q.answers_count||0} 回答 · ${fmtTime(q.created_at)}`));
    const tags = (q.tags||[]).map(t => el('span',{class:'q-tag',style:'margin-right:5px'}, t.name));
    if (tags.length) detail.appendChild(el('div',{style:'margin-bottom:14px'}, tags));
    const body = el('div',{class:'q-body'});
    body.innerHTML = renderContent(q.body);
    detail.appendChild(body);

    const answersSec = el('div',{class:'answers'});
    answersSec.appendChild(el('h4',{}, `回答 · ${(q.answers||[]).length}`));
    const sorted = [...(q.answers||[])].sort((a,b) => {
      if ((a.id === q.accepted_answer_id) !== (b.id === q.accepted_answer_id))
        return a.id === q.accepted_answer_id ? -1 : 1;
      return a.created_at - b.created_at;
    });
    for (const a of sorted) {
      const aa = el('div',{class:'answer' + (a.id === q.accepted_answer_id ? ' accepted' : '')});
      const meta = [
        el('span',{}, (a.author?(a.author.display_name||a.author.username):'匿名') + ' · ' + fmtTime(a.created_at)),
      ];
      if (a.id === q.accepted_answer_id) meta.unshift(el('span',{class:'a-accepted-badge'}, '✓ 最佳答案'));
      if (State.me && (q.author_id === State.me.id || State.me.is_admin) && a.id !== q.accepted_answer_id) {
        meta.push(el('button',{
          class:'q-tag',
          style:'margin-left:auto;cursor:pointer;border:0',
          onclick: async () => {
            try { await call(`/api/answers/${encodeURIComponent(a.id)}/accept`,'POST',{}); showToast('已采纳为最佳答案','ok'); selectQuestion(q.id); }
            catch(e){ showToast(e.message||'失败','err'); }
          }
        }, '采纳'));
      }
      const mrow = el('div',{class:'a-meta'}, meta);
      aa.appendChild(mrow);
      const bd = el('div',{style:'font-size:13.5px;line-height:1.7'});
      bd.innerHTML = renderContent(a.body);
      aa.appendChild(bd);
      answersSec.appendChild(aa);
    }
    detail.appendChild(answersSec);

    // Answer composer
    const meId = State.me && State.me.id;
    if (meId) {
      const cpr = el('div',{class:'q-composer'});
      const ta = el('textarea',{placeholder:'写下你的回答（支持 Markdown · ``` 代码块）'});
      const sb = el('button',{class:'btn-send',style:'margin-left:auto;display:block'}, '提交回答');
      sb.addEventListener('click', async () => {
        const content = (ta.value||'').trim();
        if (!content) return showToast('请填写内容','err');
        try {
          await call(`/api/questions/${encodeURIComponent(qid)}/answers`,'POST',{body:content});
          showToast('已提交','ok');
          selectQuestion(qid);
        } catch(e){ showToast(e.message||'失败','err'); }
      });
      cpr.appendChild(ta); cpr.appendChild(sb);
      detail.appendChild(cpr);
    }
  } catch(e){
    detail.innerHTML = `<div class="empty"><div class="big">⚠️</div><h4>加载失败</h4><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function setupQNA(){
  $('new-q-btn')?.addEventListener('click', async () => {
    if (!State.tags.length) await loadTags();
    $('q-title').value = ''; $('q-body').value = '';
    const sel = $('q-tags'); for (const o of sel.options) o.selected = false;
    $('q-mask').classList.add('show');
  });
  $('q-cancel')?.addEventListener('click', () => $('q-mask').classList.remove('show'));
  $('q-mask')?.addEventListener('click', (e) => { if (e.target.id === 'q-mask') $('q-mask').classList.remove('show'); });
  $('q-submit')?.addEventListener('click', async () => {
    const title = ($('q-title').value||'').trim();
    const body = ($('q-body').value||'').trim();
    const tagSel = $('q-tags');
    const tag_ids = [...tagSel.selectedOptions].map(o => Number(o.value)).filter(Boolean);
    if (!title) return showToast('请填写标题','err');
    if (!body) return showToast('请填写问题内容','err');
    try {
      await call('/api/questions','POST',{title,body,tag_ids});
      $('q-mask').classList.remove('show');
      showToast('问题已发布','ok');
      loadQuestions();
    } catch(e){ showToast(e.message||'失败','err'); }
  });
}

// ===== Admin =====
async function loadAdmin(){
  if (!State.me || !State.me.is_admin) return;
  try {
    const r = await call('/api/admin/stats','GET');
    State.adminStats = r;
    const grid = $('admin-stats');
    if (grid) {
      const cards = [
        ['👥','注册用户', r.total_users],
        ['🟢','当前在线', r.online_users],
        ['💬','消息总数', r.total_messages],
        ['❓','问题数', r.total_questions],
        ['💡','回答数', r.total_answers],
        ['🚫','已封禁', r.banned_users],
      ];
      grid.innerHTML = '';
      for (const [ic, l, n] of cards) {
        const c = el('div',{class:'stat-card'}, [
          el('div',{style:'font-size:22px;margin-bottom:6px'}, ic),
          el('div',{class:'n'}, String(n)),
          el('div',{class:'l'}, l),
        ]);
        grid.appendChild(c);
      }
    }
  } catch(e) {}
  try {
    const r = await call('/api/admin/users','GET');
    State.adminUsers = r.users || [];
    renderAdminUsers();
  } catch(e) {}
}
function renderAdminUsers(){
  const tb = $('admin-users'); if (!tb) return;
  tb.innerHTML = '';
  for (const u of State.adminUsers) {
    const tr = el('tr',{}, [
      (() => {
        const td = el('td');
        const wrap = el('div',{style:'display:flex;align-items:center;gap:8px'});
        const av = el('div',{style:'width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700'});
        av.style.background = u.avatar_color || colorFor(u.username);
        av.textContent = initial(u.display_name||u.username);
        wrap.appendChild(av);
        wrap.appendChild(el('span',{}, u.display_name || u.username));
        if (u.is_admin) wrap.appendChild(el('span',{class:'q-tag',style:'margin-left:4px'}, '🛡️'));
        if (u.is_banned) wrap.appendChild(el('span',{class:'q-tag',style:'background:rgba(255,107,107,.15);color:var(--red)'}, '🚫 封禁'));
        td.appendChild(wrap); return td;
      })(),
      el('td',`@${u.username}`),
      el('td', fmtTime(u.created_at)),
      el('td', fmtTime(u.last_login_at) || '—'),
      el('td', u.is_banned ? '封禁' : (State.onlineUserIds.has(u.id) ? '在线' : '离线')),
      (() => {
        const td = el('td');
        const btn = el('button',{
          class:'ban-btn' + (u.is_banned ? ' banned' : ''),
          onclick: async () => {
            try {
              if (u.is_banned) {
                await call(`/api/admin/users/${encodeURIComponent(u.id)}/unban`,'POST');
                showToast('已解封','ok');
              } else {
                if (!confirm(`确定要封禁 @${u.username}？封禁后该用户立即下线并禁言。`)) return;
                await call(`/api/admin/users/${encodeURIComponent(u.id)}/ban`,'POST');
                showToast('已封禁','ok');
              }
              loadAdmin();
            } catch(e){ showToast(e.message||'失败','err'); }
          }
        }, u.is_banned ? '解封' : '封禁');
        td.appendChild(btn); return td;
      })(),
    ]);
    tb.appendChild(tr);
  }
}

// ===== Tab switching =====
function setupNav(){
  document.querySelectorAll('.nav-item[data-nav]').forEach(n => {
    n.addEventListener('click', () => {
      const nav = n.dataset.nav;
      document.querySelectorAll('.nav-item[data-nav]').forEach(x => x.classList.remove('active'));
      n.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const target = document.querySelector(`.tab-panel[data-panel="${nav}"]`);
      if (target) target.classList.add('active');
      if (nav === 'qna') { loadTags(); loadQuestions(); }
      if (nav === 'admin') loadAdmin();
    });
  });
}

// ===== Main boot =====
async function boot(){
  if (!ensureAuth()) return;
  document.getElementById('app').style.display = '';

  // Load initial data
  try {
    const me = await call('/api/me','GET');
    State.me = me;
    setKnownUsers([State.me]);
    renderMe();
  } catch(e) {
    if (e.status === 401) { CH.clearToken(); location.href = 'auth.html'; return; }
    showToast('获取用户信息失败: ' + e.message, 'err');
  }
  try {
    const [chans, cats, users] = await Promise.all([
      call('/api/channels','GET'),
      call('/api/channels/categories','GET'),
      call('/api/users','GET'),
    ]);
    State.channels = chans.channels || chans || [];
    State.categories = cats.categories || cats || [];
    State.users = users.users || users || [];
    setKnownUsers(State.users);
  } catch(e) {
    showToast('加载基础数据失败: ' + e.message, 'err');
  }

  renderSidebar();
  renderOnlineList();

  // Default channel
  const first = State.channels[0];
  if (first) selectChannel(first.id);
  else selectChannel('general');

  // Composer
  const ta = $('input');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  ta.addEventListener('input', autoResize);
  $('send-btn').addEventListener('click', send);
  setupEmoji();
  setupAttach();

  // Nav
  setupNav();
  setupQNA();

  // Logout
  $('logout-btn').addEventListener('click', async () => {
    if (!confirm('退出登录？')) return;
    try { await call('/api/me/logout','POST'); } catch {}
    if (State.ws) { try { State.ws.close(); } catch {} }
    CH.clearToken();
    location.href = 'auth.html';
  });

  // WS
  wsConnect();
  // Ping interval
  setInterval(() => { if (State.ws && State.ws.readyState === 1) State.ws.send(JSON.stringify({type:'ping'})); }, 20000);
}

window.ChatHubApp = { boot };
})();
