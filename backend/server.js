// server.js — ChatHub 后端：HTTP REST + WebSocket 实时推送
// 模块：用户/鉴权、分类频道聊天、私聊 DM、问答区、防滥用、管理后台、用户设置
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const url = require('node:url');
const { WebSocketServer } = require('ws');
const { db, stmts } = require('./db');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 1 << 20; // 1 MiB

// 防滥用阈值
const RATE = {
  AUTH_PER_MIN: 5,        // 每 IP 每分钟 注册+登录 合计上限
  LOGIN_FAIL_LOCK: 5,     // 连续失败 N 次锁定
  LOGIN_LOCK_MS: 15 * 60 * 1000, // 锁定 15 分钟
  DEL_PER_HOUR: 3,        // 每 IP 每小时注销账号上限
  DEL_COOLDOWN_MS: 60 * 60 * 1000,
};
const ADMIN_BOOTSTRAP = process.env.ADMIN_BOOTSTRAP || 'admin';

// ---------- IP 限流（内存，按窗口） ----------
const authHits = new Map(); // ip -> [ts...]
function rateLimitAuth(ip) {
  const now = Date.now();
  const arr = (authHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE.AUTH_PER_MIN) return false;
  arr.push(now);
  authHits.set(ip, arr);
  return true;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

// ---------- 工具函数 ----------
function nowMs() { return Date.now(); }
function uuid() { return crypto.randomUUID(); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  const [saltB64, hashB64] = (stored || '').split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const hash = Buffer.from(hashB64, 'base64');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, hash);
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }

function colorFor(name) {
  const colors = ['#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB',
    '#1E88E5', '#039BE5', '#00ACC1', '#00897B', '#43A047', '#7CB342',
    '#C0CA33', '#FDD835', '#FB8C00', '#F4511E', '#6D4C41'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    avatar_color: u.avatar_color, is_admin: !!u.is_admin,
    show_online: !!u.show_online, theme: u.theme, notify_sound: !!u.notify_sound,
    created_at: u.created_at, last_login_at: u.last_login_at || null,
  };
}
function toChannelMessage(row) {
  return {
    id: row.id, channel_id: row.channel_id, author_id: row.author_id,
    content: row.content, created_at: row.created_at,
    author: { id: row.author_id, username: row.author_username,
      display_name: row.author_display_name, avatar_color: row.author_avatar_color },
  };
}
function toDMMessage(row) {
  return {
    id: row.id, sender_id: row.sender_id, recipient_id: row.recipient_id,
    content: row.content, created_at: row.created_at, is_outgoing: !!row.is_outgoing,
    author: { id: row.sender_id, username: row.author_username,
      display_name: row.author_display_name, avatar_color: row.author_avatar_color },
  };
}
function toQuestion(row) {
  return {
    id: row.id, title: row.title, body: row.body, author_id: row.author_id,
    answer_count: row.answer_count, accepted_answer_id: row.accepted_answer_id || null,
    views: row.views, created_at: row.created_at,
    author: { id: row.author_id, username: row.author_username,
      display_name: row.author_display_name, avatar_color: row.author_avatar_color },
    tags: [],
  };
}
function toAnswer(row) {
  return {
    id: row.id, question_id: row.question_id, author_id: row.author_id,
    body: row.body, accepted: !!row.accepted, created_at: row.created_at,
    author: { id: row.author_id, username: row.author_username,
      display_name: row.author_display_name, avatar_color: row.author_avatar_color },
  };
}

// ---------- HTTP 工具 ----------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''; let tooBig = false;
    req.on('data', (c) => { if (buf.length + c.length > MAX_BODY) { tooBig = true; req.destroy(); return; } buf += c; });
    req.on('end', () => {
      if (tooBig) return reject(new Error('PAYLOAD_TOO_LARGE'));
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) return null;
  const u = stmts.getUserByToken.get(m[1]);
  if (!u) return null;
  // 封禁用户拒绝
  if (stmts.isBanned.get(u.id)) return null;
  return u;
}
function requireAdmin(user) { return user && !!user.is_admin; }

// ---------- 种子 ----------
function seedData() {
  if (stmts.listChannels.all().length === 0) {
    const seeds = [
      ['general', '社区大厅', '随便聊聊，新手报到', 'general'],
      ['announcements', '公告', '社区官方公告与更新', 'general'],
      ['javascript', 'JavaScript', '前端 / Node 聊代码', 'programming'],
      ['python', 'Python', '数据 / 后端 / 脚本', 'programming'],
      ['swift', 'Swift', 'iOS / macOS 开发', 'programming'],
      ['rust', 'Rust', '系统编程 / 性能', 'programming'],
      ['go', 'Go', '云原生 / 后端', 'programming'],
      ['systems', '系统与架构', '分布式 / 数据库 / 架构方案', 'programming'],
      ['devops', 'DevOps', 'CI/CD / 容器 / 部署', 'programming'],
      ['design', '设计与 UI', 'UI/UX / 视觉 / 设计稿', 'design'],
      ['life', '生活水区', '工作生活 / 摸鱼 / 灌水', 'life'],
      ['hardware', '硬件数码', '键盘 / 外设 / 装机', 'life'],
    ];
    for (const [id, name, topic, cat] of seeds) stmts.createChannel.run(id, name, topic, cat, nowMs());
  }
  const tagNames = ['javascript', 'python', 'swift', 'rust', 'go', 'react', 'vue', 'node', 'css', '算法', '数据库', '架构', 'macos', 'linux', 'bug', '性能'];
  for (const name of tagNames) if (!stmts.getTagByName.get(name)) stmts.createTag.run(uuid(), name, nowMs());
  // 引导式管理员：启动后若无人是管理员，把指定用户名（默认 admin）在首次注册时提权
}
function maybeBootstrapAdmin(username, userId) {
  if (username !== ADMIN_BOOTSTRAP) return;
  if (stmts.countAdmins.get().n > 0) return;
  stmts.setAdmin.run(1, userId);
}

// ---------- WebSocket ----------
const onlineSockets = new Map(); // userId -> Set<ws>
function visibleOnlineUserIds() {
  const ids = [];
  for (const [uid, set] of onlineSockets) {
    if (set.size > 0) {
      const u = stmts.getUserById.get(uid);
      if (u && u.show_online) ids.push(uid);
    }
  }
  return ids;
}
function broadcastOnline() {
  const payload = JSON.stringify({ type: 'presence', onlineUserIds: visibleOnlineUserIds() });
  for (const set of onlineSockets.values()) for (const ws of set) if (ws.readyState === 1) ws.send(payload);
}
function setOnline(userId, ws) {
  let set = onlineSockets.get(userId);
  if (!set) { set = new Set(); onlineSockets.set(userId, set); }
  const wasEmpty = set.size === 0;
  set.add(ws);
  if (wasEmpty) broadcastOnline();
}
function setOffline(userId, ws) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) { onlineSockets.delete(userId); broadcastOnline(); }
}
function sendToUser(userId, s) { const set = onlineSockets.get(userId); if (!set) return; for (const ws of set) if (ws.readyState === 1) ws.send(s); }
function broadcast(s) { for (const set of onlineSockets.values()) for (const ws of set) if (ws.readyState === 1) ws.send(s); }

// ---------- 路由 ----------
async function handleApi(req, res, parsed) {
  const pathname = parsed.pathname;
  const method = req.method;
  const ip = clientIp(req);

  // /api/register
  if (pathname === '/api/register' && method === 'POST') {
    if (!rateLimitAuth(ip)) return sendJSON(res, 429, { error: 'RATE_LIMITED' });
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const display_name = String(body.display_name || username).trim();
    if (!username || !password) return sendJSON(res, 400, { error: 'USERNAME_AND_PASSWORD_REQUIRED' });
    if (username.length < 2 || username.length > 24) return sendJSON(res, 400, { error: 'USERNAME_LENGTH_2_24' });
    if (password.length < 6) return sendJSON(res, 400, { error: 'PASSWORD_MIN_6' });
    if (stmts.getUserByName.get(username)) return sendJSON(res, 409, { error: 'USERNAME_TAKEN' });
    const id = uuid();
    stmts.createUser.run(id, username, hashPassword(password), display_name, colorFor(username), nowMs());
    maybeBootstrapAdmin(username, id);
    // 单设备登录：删该用户旧 token 再发新 token
    stmts.deleteTokensForUser.run(id);
    const token = newToken();
    stmts.createToken.run(token, id, nowMs());
    stmts.updateLoginSuccess.run(nowMs(), ip, id);
    return sendJSON(res, 201, { token, user: publicUser(stmts.getUserById.get(id)) });
  }

  // /api/login
  if (pathname === '/api/login' && method === 'POST') {
    if (!rateLimitAuth(ip)) return sendJSON(res, 429, { error: 'RATE_LIMITED' });
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const u = stmts.getUserByName.get(username);
    if (!u) return sendJSON(res, 401, { error: 'INVALID_CREDENTIALS' });
    if (stmts.isBanned.get(u.id)) return sendJSON(res, 403, { error: 'BANNED' });
    // 锁定检查
    if (u.locked_until && u.locked_until > nowMs()) {
      const wait = Math.ceil((u.locked_until - nowMs()) / 1000);
      return sendJSON(res, 423, { error: 'LOCKED', retry_after: wait });
    }
    if (!verifyPassword(password, u.password_hash)) {
      const fails = (u.failed_login_count || 0) + 1;
      const lockUntil = fails >= RATE.LOGIN_FAIL_LOCK ? nowMs() + RATE.LOGIN_LOCK_MS : 0;
      stmts.updateLoginFail.run(lockUntil, u.id);
      if (lockUntil) return sendJSON(res, 423, { error: 'LOCKED', retry_after: Math.round(RATE.LOGIN_LOCK_MS / 1000) });
      return sendJSON(res, 401, { error: 'INVALID_CREDENTIALS', attempts_left: RATE.LOGIN_FAIL_LOCK - fails });
    }
    // 单设备登录：删旧 token，只保留本次
    stmts.deleteTokensForUser.run(u.id);
    const token = newToken();
    stmts.createToken.run(token, u.id, nowMs());
    stmts.updateLoginSuccess.run(nowMs(), ip, u.id);
    return sendJSON(res, 200, { token, user: publicUser(u) });
  }

  // OAuth 占位（留接口以后做）
  if (pathname === '/api/auth/providers' && method === 'GET') {
    return sendJSON(res, 200, { providers: [] });
  }
  if (pathname === '/api/auth/github' && method === 'GET') {
    return sendJSON(res, 501, { error: 'NOT_IMPLEMENTED', hint: 'GitHub OAuth 待接入：配置 client_id/secret 后启用' });
  }

  // 以下需鉴权
  const user = authUser(req);
  if (!user) return sendJSON(res, 401, { error: 'UNAUTHORIZED' });

  if (pathname === '/api/me' && method === 'GET') {
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  // —— 用户资料 / 设置 ——
  if (pathname === '/api/me/profile' && method === 'PUT') {
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    const name = String(body.display_name || '').trim().slice(0, 24);
    const color = String(body.avatar_color || user.avatar_color).trim();
    if (name.length < 1) return sendJSON(res, 400, { error: 'DISPLAY_NAME_REQUIRED' });
    stmts.updateUserProfile.run(name, color, user.id);
    return sendJSON(res, 200, { user: publicUser(stmts.getUserById.get(user.id)) });
  }
  if (pathname === '/api/me/settings' && method === 'PUT') {
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    const theme = ['light', 'dark', 'system'].includes(body.theme) ? body.theme : 'system';
    const showOnline = body.show_online === undefined ? !!user.show_online : !!body.show_online;
    const notifySound = body.notify_sound === undefined ? !!user.notify_sound : !!body.notify_sound;
    stmts.updateUserSettings.run(showOnline ? 1 : 0, theme, notifySound ? 1 : 0, user.id);
    const fresh = stmts.getUserById.get(user.id);
    // 在线状态可见性变化时重广播
    broadcastOnline();
    return sendJSON(res, 200, { user: publicUser(fresh) });
  }
  if (pathname === '/api/me/password' && method === 'PUT') {
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    if (!verifyPassword(String(body.current_password || ''), user.password_hash))
      return sendJSON(res, 401, { error: 'CURRENT_PASSWORD_WRONG' });
    const np = String(body.new_password || '');
    if (np.length < 6) return sendJSON(res, 400, { error: 'PASSWORD_MIN_6' });
    stmts.updateUserPassword.run(hashPassword(np), user.id);
    stmts.deleteTokensForUser.run(user.id); // 改密后强制重新登录
    const token = newToken(); stmts.createToken.run(token, user.id, nowMs());
    return sendJSON(res, 200, { token, user: publicUser(stmts.getUserById.get(user.id)) });
  }
  // 注销账号（二次确认 + 冷却）
  if (pathname === '/api/me' && method === 'DELETE') {
    let body; try { body = await readJSONBody(req); } catch { body = {}; }
    if (body.confirm !== true) return sendJSON(res, 400, { error: 'CONFIRM_REQUIRED', hint: '需传 confirm:true 二次确认' });
    // 冷却：每 IP 每小时上限
    const recent = stmts.countDeletionsByIp.get(ip, nowMs() - RATE.DEL_COOLDOWN_MS).n;
    if (recent >= RATE.DEL_PER_HOUR) return sendJSON(res, 429, { error: 'DELETE_RATE_LIMITED', retry_after: 3600 });
    stmts.recordDeletion.run(uuid(), user.username, user.id, ip, nowMs());
    stmts.deleteTokensForUser.run(user.id);
    stmts.deleteUser.run(user.id);
    return sendJSON(res, 200, { ok: true });
  }
  // 退出登录（吊销当前 token）
  if (pathname === '/api/me/logout' && method === 'POST') {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer (.+)$/.exec(h);
    if (m) stmts.deleteToken.run(m[1]);
    return sendJSON(res, 200, { ok: true });
  }

  // —— 频道 ——
  if (pathname === '/api/channels' && method === 'GET') {
    return sendJSON(res, 200, { channels: stmts.listChannels.all() });
  }
  if (pathname === '/api/channels/categories' && method === 'GET') {
    const rows = stmts.listChannels.all();
    const byCat = {};
    for (const r of rows) (byCat[r.category] = byCat[r.category] || []).push(r);
    return sendJSON(res, 200, { categories: byCat });
  }
  if (pathname === '/api/users' && method === 'GET') {
    return sendJSON(res, 200, {
      users: stmts.listUsers.all().map((u) => ({ ...u, online: onlineSockets.has(u.id) && (() => {
        const full = stmts.getUserById.get(u.id); return full ? !!full.show_online : false;
      })() })),
    });
  }

  // —— 频道消息 ——
  let m = /^\/api\/channels\/([^/]+)\/messages$/.exec(pathname);
  if (m) {
    const channelId = decodeURIComponent(m[1]);
    if (!stmts.getChannel.get(channelId)) return sendJSON(res, 404, { error: 'CHANNEL_NOT_FOUND' });
    if (method === 'GET') {
      const before = Number(parsed.query.before) || Date.now() + 1;
      const limit = Math.min(Number(parsed.query.limit) || 50, 100);
      return sendJSON(res, 200, { messages: stmts.listChannelMessages.all(channelId, before, limit).map(toChannelMessage).reverse() });
    }
    if (method === 'POST') {
      let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
      const content = String(body.content || '').trim();
      if (!content) return sendJSON(res, 400, { error: 'EMPTY_CONTENT' });
      if (content.length > 8000) return sendJSON(res, 400, { error: 'MESSAGE_TOO_LONG' });
      const id = uuid(); const ts = nowMs();
      stmts.createMessage.run(id, channelId, user.id, content, ts);
      const msg = toChannelMessage(stmts.getMessage.get(id));
      broadcast(JSON.stringify({ type: 'message', scope: 'channel', channelId, message: msg }));
      return sendJSON(res, 201, { message: msg });
    }
  }

  // —— DM ——
  m = /^\/api\/dms\/([^/]+)\/messages$/.exec(pathname);
  if (m) {
    const otherId = decodeURIComponent(m[1]);
    if (otherId === user.id) return sendJSON(res, 400, { error: 'CANNOT_DM_SELF' });
    const other = stmts.getUserById.get(otherId);
    if (!other) return sendJSON(res, 404, { error: 'USER_NOT_FOUND' });
    if (method === 'GET') {
      const before = Number(parsed.query.before) || Date.now() + 1;
      const limit = Math.min(Number(parsed.query.limit) || 50, 100);
      return sendJSON(res, 200, { messages: stmts.listDMMessages.all(user.id, user.id, otherId, otherId, user.id, before, limit).map(toDMMessage).reverse() });
    }
    if (method === 'POST') {
      let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
      const content = String(body.content || '').trim();
      if (!content) return sendJSON(res, 400, { error: 'EMPTY_CONTENT' });
      const id = uuid(); const ts = nowMs();
      stmts.createDM.run(id, user.id, otherId, content, ts);
      const msg = toDMMessage(stmts.getDM.get(user.id, id));
      const payload = JSON.stringify({ type: 'message', scope: 'dm', message: msg, withUserId: otherId });
      sendToUser(user.id, payload); sendToUser(otherId, payload);
      return sendJSON(res, 201, { message: msg });
    }
  }

  // ========== 问答区 ==========
  if (pathname === '/api/tags' && method === 'GET') return sendJSON(res, 200, { tags: db.prepare('SELECT * FROM tags ORDER BY name').all() });

  if (pathname === '/api/questions' && method === 'GET') {
    const page = Math.max(0, Number(parsed.query.page) || 0);
    const limit = Math.min(Number(parsed.query.limit) || 30, 100);
    const offset = page * limit;
    const rows = parsed.query.tag ? stmts.listQuestionsByTag.all(String(parsed.query.tag), limit, offset) : stmts.listQuestions.all(limit, offset);
    const questions = rows.map(toQuestion);
    for (const q of questions) q.tags = stmts.listTagsForQuestion.all(q.id).map((t) => t.name);
    return sendJSON(res, 200, { questions });
  }
  if (pathname === '/api/questions' && method === 'POST') {
    let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
    const title = String(body.title || '').trim();
    const bodyMd = String(body.body || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5) : [];
    if (title.length < 5) return sendJSON(res, 400, { error: 'TITLE_MIN_5' });
    if (title.length > 120) return sendJSON(res, 400, { error: 'TITLE_MAX_120' });
    if (bodyMd.length > 20000) return sendJSON(res, 400, { error: 'BODY_TOO_LONG' });
    const id = uuid(); const ts = nowMs();
    stmts.createQuestion.run(id, title, bodyMd, user.id, ts);
    for (const name of tags) {
      let tag = stmts.getTagByName.get(name);
      if (!tag) { stmts.createTag.run(uuid(), name, ts); tag = stmts.getTagByName.get(name); }
      stmts.addQuestionTag.run(id, tag.id);
    }
    const q = toQuestion(stmts.getQuestion.get(id));
    q.tags = stmts.listTagsForQuestion.all(id).map((t) => t.name);
    broadcast(JSON.stringify({ type: 'question', question: q }));
    return sendJSON(res, 201, { question: q });
  }
  m = /^\/api\/questions\/([^/]+)$/.exec(pathname);
  if (m && method === 'GET') {
    const id = decodeURIComponent(m[1]);
    const row = stmts.getQuestion.get(id);
    if (!row) return sendJSON(res, 404, { error: 'QUESTION_NOT_FOUND' });
    stmts.incQuestionViews.run(id);
    const q = toQuestion(stmts.getQuestion.get(id));
    q.tags = stmts.listTagsForQuestion.all(id).map((t) => t.name);
    return sendJSON(res, 200, { question: q, answers: stmts.listAnswers.all(id).map(toAnswer) });
  }
  m = /^\/api\/questions\/([^/]+)\/answers$/.exec(pathname);
  if (m) {
    const qid = decodeURIComponent(m[1]);
    const q = stmts.getQuestion.get(qid);
    if (!q) return sendJSON(res, 404, { error: 'QUESTION_NOT_FOUND' });
    if (method === 'POST') {
      let body; try { body = await readJSONBody(req); } catch { return sendJSON(res, 400, { error: 'INVALID_BODY' }); }
      const bodyMd = String(body.body || '').trim();
      if (!bodyMd) return sendJSON(res, 400, { error: 'EMPTY_CONTENT' });
      if (bodyMd.length > 20000) return sendJSON(res, 400, { error: 'BODY_TOO_LONG' });
      const id = uuid(); const ts = nowMs();
      stmts.createAnswer.run(id, qid, user.id, bodyMd, ts);
      stmts.incAnswerCount.run(1, qid);
      const ans = toAnswer(stmts.getAnswer.get(id));
      broadcast(JSON.stringify({ type: 'answer', questionId: qid, answer: ans }));
      return sendJSON(res, 201, { answer: ans });
    }
  }
  m = /^\/api\/answers\/([^/]+)\/accept$/.exec(pathname);
  if (m && method === 'POST') {
    const aid = decodeURIComponent(m[1]);
    const ans = stmts.getAnswer.get(aid);
    if (!ans) return sendJSON(res, 404, { error: 'ANSWER_NOT_FOUND' });
    const q = stmts.getQuestion.get(ans.question_id);
    if (!q) return sendJSON(res, 404, { error: 'QUESTION_NOT_FOUND' });
    if (q.author_id !== user.id) return sendJSON(res, 403, { error: 'NOT_QUESTION_AUTHOR' });
    db.prepare('UPDATE answers SET accepted = 0 WHERE question_id = ?').run(q.id);
    stmts.setAnswerAccepted.run(1, aid);
    stmts.setAcceptedAnswer.run(aid, q.id);
    const updated = toAnswer(stmts.getAnswer.get(aid));
    broadcast(JSON.stringify({ type: 'answer_accepted', questionId: q.id, answerId: aid, answer: updated }));
    return sendJSON(res, 200, { answer: updated });
  }

  // ========== 管理后台 ==========
  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(user)) return sendJSON(res, 403, { error: 'ADMIN_REQUIRED' });
    if (pathname === '/api/admin/stats' && method === 'GET') {
      const stats = {
        users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        online: visibleOnlineUserIds().length,
        channels: db.prepare('SELECT COUNT(*) AS n FROM channels').get().n,
        channel_messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
        dm_messages: db.prepare('SELECT COUNT(*) AS n FROM dm_messages').get().n,
        questions: db.prepare('SELECT COUNT(*) AS n FROM questions').get().n,
        answers: db.prepare('SELECT COUNT(*) AS n FROM answers').get().n,
        banned: db.prepare('SELECT COUNT(*) AS n FROM banned_users').get().n,
        recent_logins: stmts.listUsers.all().filter((u) => u.last_login_at).slice(0, 20),
      };
      return sendJSON(res, 200, { stats });
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      return sendJSON(res, 200, { users: stmts.listUsers.all() });
    }
    // 封禁/解封
    m = /^\/api\/admin\/users\/([^/]+)\/ban$/.exec(pathname);
    if (m && method === 'POST') {
      let body = {}; try { body = await readJSONBody(req); } catch {}
      const targetId = decodeURIComponent(m[1]);
      const target = stmts.getUserById.get(targetId);
      if (!target) return sendJSON(res, 404, { error: 'USER_NOT_FOUND' });
      if (target.is_admin) return sendJSON(res, 400, { error: 'CANNOT_BAN_ADMIN' });
      stmts.banUser.run(targetId, String(body.reason || ''), user.id, nowMs());
      stmts.deleteTokensForUser.run(targetId); // 踢下线
      return sendJSON(res, 200, { ok: true });
    }
    m = /^\/api\/admin\/users\/([^/]+)\/unban$/.exec(pathname);
    if (m && method === 'POST') {
      stmts.unbanUser.run(decodeURIComponent(m[1]));
      return sendJSON(res, 200, { ok: true });
    }
    // 删频道消息
    m = /^\/api\/admin\/messages\/([^/]+)$/.exec(pathname);
    if (m && method === 'DELETE') {
      const id = decodeURIComponent(m[1]);
      const row = stmts.getMessage.get(id);
      if (!row) return sendJSON(res, 404, { error: 'NOT_FOUND' });
      stmts.deleteMessage.run(id);
      broadcast(JSON.stringify({ type: 'message_deleted', scope: 'channel', channelId: row.channel_id, messageId: id }));
      return sendJSON(res, 200, { ok: true });
    }
    // 删问题/回答
    m = /^\/api\/admin\/questions\/([^/]+)$/.exec(pathname);
    if (m && method === 'DELETE') { stmts.deleteQuestion.run(decodeURIComponent(m[1])); return sendJSON(res, 200, { ok: true }); }
    m = /^\/api\/admin\/answers\/([^/]+)$/.exec(pathname);
    if (m && method === 'DELETE') { stmts.deleteAnswer.run(decodeURIComponent(m[1])); return sendJSON(res, 200, { ok: true }); }
  }

  return sendJSON(res, 404, { error: 'NOT_FOUND', path: pathname });
}

// ---------- HTTP server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const parsed = url.parse(req.url, true);
  if (parsed.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, parsed); }
    catch (err) { console.error('API error:', err); sendJSON(res, 500, { error: 'INTERNAL', message: String(err && err.message || err) }); }
    return;
  }
  if (parsed.pathname === '/' || parsed.pathname === '/health') return sendJSON(res, 200, { ok: true, service: 'chathub', ts: nowMs() });
  sendJSON(res, 404, { error: 'NOT_FOUND' });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const u = parsed.query.token ? stmts.getUserByToken.get(String(parsed.query.token)) : null;
  if (!u || stmts.isBanned.get(u.id)) { ws.close(4001, 'UNAUTHORIZED'); return; }
  setOnline(u.id, ws);
  ws.send(JSON.stringify({ type: 'hello', user: publicUser(u), onlineUserIds: visibleOnlineUserIds() }));
  ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m && m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: nowMs() })); } catch {} });
  const leave = () => setOffline(u.id, ws);
  ws.on('close', leave); ws.on('error', leave);
});

seedData();
server.listen(PORT, HOST, () => {
  console.log(`ChatHub backend listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket:              ws://${HOST}:${PORT}/ws`);
  console.log(`Admin bootstrap user:  ${ADMIN_BOOTSTRAP} (首次以该用户名注册即自动成为管理员)`);
});
