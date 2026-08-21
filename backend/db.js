// db.js — SQLite 数据层（node:sqlite，零原生依赖）
// 表：users / auth_tokens / channels / messages / dm_messages
//      questions / answers / tags / question_tags
//      banned_users / account_deletions（防滥用与管理）
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'chat.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#7B8794',
  is_admin INTEGER NOT NULL DEFAULT 0,
  -- 登录失败锁定
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  -- 用户设置
  show_online INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'system',          -- light | dark | system
  notify_sound INTEGER NOT NULL DEFAULT 1,
  -- 审计
  last_login_at INTEGER,
  last_login_ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dm_pair_time ON dm_messages(sender_id, recipient_id, created_at DESC);

-- 问答区
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  answer_count INTEGER NOT NULL DEFAULT 0,
  accepted_answer_id TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_time ON questions(created_at DESC);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_answers_qid_time ON answers(question_id, created_at);
CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (question_id, tag_id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 封禁：管理员封禁某用户（无法登录、无法发言）
CREATE TABLE IF NOT EXISTS banned_users (
  user_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT NOT NULL,
  banned_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
);

-- 注销冷却：记录近期待注销请求，防止刷建刷销
CREATE TABLE IF NOT EXISTS account_deletions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  requested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_del_ip_time ON account_deletions(ip, requested_at);
CREATE INDEX IF NOT EXISTS idx_del_time ON account_deletions(requested_at);
`);

// 迁移：给已存在的旧库补字段（CREATE TABLE IF NOT EXISTS 不会改已存在表）
function migrate() {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const add = (col, def) => {
    if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  };
  add('is_admin', 'INTEGER NOT NULL DEFAULT 0');
  add('failed_login_count', 'INTEGER NOT NULL DEFAULT 0');
  add('locked_until', 'INTEGER NOT NULL DEFAULT 0');
  add('show_online', 'INTEGER NOT NULL DEFAULT 1');
  add('theme', "TEXT NOT NULL DEFAULT 'system'");
  add('notify_sound', 'INTEGER NOT NULL DEFAULT 1');
  add('last_login_at', 'INTEGER');
  add('last_login_ip', 'TEXT');
}
migrate();

// 预编译语句
const stmts = {
  // —— 用户 ——
  createUser: db.prepare(
    'INSERT INTO users (id, username, password_hash, display_name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  listUsers: db.prepare('SELECT id, username, display_name, avatar_color, created_at, is_admin, last_login_at FROM users ORDER BY created_at DESC'),
  updateUserProfile: db.prepare(
    'UPDATE users SET display_name = ?, avatar_color = ? WHERE id = ?'
  ),
  updateUserSettings: db.prepare(
    'UPDATE users SET show_online = ?, theme = ?, notify_sound = ? WHERE id = ?'
  ),
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  countAdmins: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  updateLoginSuccess: db.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = 0, last_login_at = ?, last_login_ip = ? WHERE id = ?'
  ),
  updateLoginFail: db.prepare(
    'UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = ? WHERE id = ?'
  ),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  getUserForAdmin: db.prepare('SELECT id, username, display_name, avatar_color, created_at, is_admin, failed_login_count, locked_until, last_login_at, last_login_ip FROM users WHERE id = ?'),

  // —— token ——
  createToken: db.prepare('INSERT INTO auth_tokens (token, user_id, created_at) VALUES (?, ?, ?)'),
  deleteToken: db.prepare('DELETE FROM auth_tokens WHERE token = ?'),
  deleteTokensForUser: db.prepare('DELETE FROM auth_tokens WHERE user_id = ?'),
  getUserByToken: db.prepare(
    `SELECT u.* FROM users u JOIN auth_tokens t ON t.user_id = u.id WHERE t.token = ?`
  ),

  // —— 频道 ——
  listChannels: db.prepare('SELECT * FROM channels ORDER BY category, created_at'),
  getChannel: db.prepare('SELECT * FROM channels WHERE id = ?'),
  createChannel: db.prepare(
    'INSERT INTO channels (id, name, topic, category, created_at) VALUES (?, ?, ?, ?, ?)'
  ),

  // —— 频道消息 ——
  listChannelMessages: db.prepare(
    `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
     FROM messages m JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.created_at < ?
     ORDER BY m.created_at DESC LIMIT ?`
  ),
  createMessage: db.prepare(
    'INSERT INTO messages (id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  getMessage: db.prepare(
    `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
     FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`
  ),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),

  // —— DM ——
  listDMMessages: db.prepare(
    `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color,
       (m.sender_id = ?) AS is_outgoing
     FROM dm_messages m JOIN users u ON u.id = m.sender_id
     WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
       AND m.created_at < ?
     ORDER BY m.created_at DESC LIMIT ?`
  ),
  createDM: db.prepare(
    'INSERT INTO dm_messages (id, sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  getDM: db.prepare(
    `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color,
       (m.sender_id = ?) AS is_outgoing
     FROM dm_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
  ),

  // —— 标签 ——
  getTagByName: db.prepare('SELECT * FROM tags WHERE name = ?'),
  createTag: db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)'),
  addQuestionTag: db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)'),
  listTagsForQuestion: db.prepare(
    `SELECT t.id, t.name FROM tags t JOIN question_tags qt ON qt.tag_id = t.id WHERE qt.question_id = ?`
  ),

  // —— 问题/回答 ——
  createQuestion: db.prepare(
    'INSERT INTO questions (id, title, body, author_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  getQuestion: db.prepare('SELECT * FROM questions WHERE id = ?'),
  listQuestions: db.prepare(
    `SELECT q.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
     FROM questions q JOIN users u ON u.id = q.author_id
     ORDER BY q.created_at DESC LIMIT ? OFFSET ?`
  ),
  listQuestionsByTag: db.prepare(
    `SELECT q.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
     FROM questions q
     JOIN users u ON u.id = q.author_id
     JOIN question_tags qt ON qt.question_id = q.id
     JOIN tags t ON t.id = qt.tag_id
     WHERE t.name = ?
     ORDER BY q.created_at DESC LIMIT ? OFFSET ?`
  ),
  incQuestionViews: db.prepare('UPDATE questions SET views = views + 1 WHERE id = ?'),
  setAcceptedAnswer: db.prepare('UPDATE questions SET accepted_answer_id = ? WHERE id = ?'),
  deleteQuestion: db.prepare('DELETE FROM questions WHERE id = ?'),
  createAnswer: db.prepare(
    'INSERT INTO answers (id, question_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  listAnswers: db.prepare(
    `SELECT a.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_color AS author_avatar_color
     FROM answers a JOIN users u ON u.id = a.author_id
     WHERE a.question_id = ?
     ORDER BY a.accepted DESC, a.created_at ASC`
  ),
  getAnswer: db.prepare('SELECT * FROM answers WHERE id = ?'),
  setAnswerAccepted: db.prepare('UPDATE answers SET accepted = ? WHERE id = ?'),
  incAnswerCount: db.prepare('UPDATE questions SET answer_count = answer_count + ? WHERE id = ?'),
  deleteAnswer: db.prepare('DELETE FROM answers WHERE id = ?'),

  // —— 封禁 ——
  banUser: db.prepare('INSERT OR REPLACE INTO banned_users (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)'),
  unbanUser: db.prepare('DELETE FROM banned_users WHERE user_id = ?'),
  isBanned: db.prepare('SELECT 1 FROM banned_users WHERE user_id = ?'),

  // —— 注销冷却 ——
  recordDeletion: db.prepare(
    'INSERT INTO account_deletions (id, username, user_id, ip, requested_at) VALUES (?, ?, ?, ?, ?)'
  ),
  countDeletionsByIp: db.prepare(
    'SELECT COUNT(*) AS n FROM account_deletions WHERE ip = ? AND requested_at > ?'
  ),
};

module.exports = { db, stmts, DB_PATH };
