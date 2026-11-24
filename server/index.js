'use strict';
// 果果密语 · 服务端
// 架构与「果果五子棋」一致: express 静态托管 + ws + sid 断线重连 + 战绩持久化
// 账号系统复用果果麻将 (只读挂载 accounts.json / secrets.json):
//   - 登录/自动登录: 本地校验 (sha256(salt:pass) / token)
//   - 注册/加好友/推送订阅: WS 中继到麻将执行 (麻将是唯一写入方)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const P = require('./puzzles.js');

const PORT = process.env.PORT || 3002;
const NAME = '果果密语';
const MJ_WS_URL = process.env.MJ_WS_URL || 'ws://127.0.0.1:3000/mj-ws';
// 仅测试环境: 在视图里附带谜底映射, 方便自动化测试一键解题 (生产不开启)
const TEST_MODE = process.env.CIPHER_TEST === '1';

// ================= 果果麻将账号库 (只读) =================
const ACC_PATH = path.join(__dirname, 'accounts.json');
function accounts() {
  try {
    const acc = JSON.parse(fs.readFileSync(ACC_PATH, 'utf8'));
    if (!acc.users) acc.users = {};
    return acc;
  } catch (e) { return { users: {} }; }
}
function hashPass(salt, pass) { return crypto.createHash('sha256').update(salt + ':' + pass).digest('hex'); }

// ================= secrets (VAPID) =================
const SECRETS_PATH = path.join(__dirname, 'secrets.json');
let SECRETS = {};
try { SECRETS = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')); } catch (e) {}
let webpush = null, VAPID = null;
try {
  webpush = require('web-push');
  if (SECRETS.vapid && SECRETS.vapid.pub && SECRETS.vapid.priv) {
    VAPID = SECRETS.vapid;
    webpush.setVapidDetails('mailto:cipher@local', VAPID.pub, VAPID.priv);
  }
} catch (e) { console.error('[push] web-push 不可用', e.message); }

function pushUser(user, title, body) {
  if (!webpush || !VAPID) return;
  const a = accounts().users[user];
  if (!a || !Array.isArray(a.pushSubs) || !a.pushSubs.length) return;
  const payload = JSON.stringify({ title, body });
  a.pushSubs.forEach(s => webpush.sendNotification(s, payload).catch(() => {}));
}

// ================= 战绩 =================
const HIST_PATH = path.join(__dirname, 'history.json');
let history = [];
try { history = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')); if (!Array.isArray(history)) history = []; } catch (e) {}
function saveHist() {
  try { fs.writeFileSync(HIST_PATH, JSON.stringify(history.slice(-2000))); }
  catch (e) { console.error('保存战绩失败', e.message); }
}
function addHistory(rec) { history.push(Object.assign({ ts: Date.now() }, rec)); saveHist(); }

// ================= 麻将中继 =================
function relayMj(token, ops, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let ws, timer, settled = false, opSent = false;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} resolve(r); } };
    timer = setTimeout(() => done({ ok: false, msg: '果果麻将服务无响应, 请稍后再试' }), timeoutMs);
    try { ws = new WebSocket(MJ_WS_URL); } catch (e) { return done({ ok: false, msg: '无法连接果果麻将服务' }); }
    ws.on('error', () => done({ ok: false, msg: '无法连接果果麻将服务' }));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.t === 'auth_ok') {
        if (!opSent && ops.length) { ops.forEach(o => ws.send(JSON.stringify(o))); opSent = true; }
        else if (opSent) done({ ok: true, msg: '成功' });
        else done({ ok: true, msg: '登录成功' });
        return;
      }
      if (m.t === 'error') return done({ ok: false, msg: m.msg });
      if (m.t === 'info') return done({ ok: true, msg: m.msg });
      if (m.t === 'friends' && opSent) return done({ ok: true, msg: '成功' });
    });
    ws.on('open', () => {
      if (token) ws.send(JSON.stringify({ t: 'auto_login', token }));
      else { ops.forEach(o => ws.send(JSON.stringify(o))); opSent = true; }
    });
  });
}

// ================= 在线状态 / 好友 =================
const onlineUsers = new Map(); // user -> Set<ws>
const pendingInvites = new Map(); // user -> [{from, fromName, code, level, ts}]

function touchOnline(user, ws, add) {
  let set = onlineUsers.get(user);
  if (add) {
    if (!set) { set = new Set(); onlineUsers.set(user, set); }
    set.add(ws);
  } else if (set) {
    set.delete(ws);
    if (!set.size) onlineUsers.delete(user);
  }
  pushFriendsAll();
}

function userRoomsOf(user) {
  const out = [];
  for (const room of rooms.values()) {
    if (room.players.some(p => p.user === user && p.online)) out.push(room.code);
  }
  return out;
}

function friendsView(user) {
  const meAcc = accounts().users[user];
  if (!meAcc) return { friends: [], requests: [] };
  const view = list => (list || []).map(u => {
    const a = accounts().users[u];
    return a ? { user: u, name: a.name, online: onlineUsers.has(u), room: userRoomsOf(u)[0] || null } : null;
  }).filter(Boolean);
  return { friends: view(meAcc.friends), requests: view(meAcc.requests) };
}

function pushFriendsAll() {
  for (const [u, set] of onlineUsers) {
    const fv = friendsView(u);
    for (const ws of set) if (ws.readyState === 1) send(ws, { t: 'friends', ...fv });
  }
}

// ================= 工具 =================
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
const isLetter = ch => /^[A-Z]$/.test(ch);

// 拼图视图 (不含谜底): 每个词的正确性 / 已确认字母 / 频次
function puzzleView(p, guesses) {
  const g = guesses || {};
  const words = p.tokens.map(w => {
    const letters = w.filter(isLetter);
    const filled = letters.length > 0 && letters.every(c => g[c]);
    const ok = filled && letters.every(c => g[c] === p.solution[c]);
    return { chars: w.map(c => ({ c, g: isLetter(c) ? (g[c] || null) : null })), ok };
  });
  const confirmed = {};
  words.forEach(w => { if (w.ok) w.chars.forEach(x => { if (x.g) confirmed[x.c] = true; }); });
  const solved = p.uniqueCipher.every(c => g[c] === p.solution[c]);
  return {
    words, confirmed, solved,
    freq: p.uniqueCipher.map(c => ({ c, n: p.freq[c] })),
    letters: p.letters,
  };
}

function mySoloView(ws) {
  const s = ws._solo;
  if (!s) return null;
  return Object.assign({
    t: 'puzzle', pid: s.puzzle.id, length: s.puzzle.length, vocab: s.puzzle.vocab, mode: s.mode,
    startedAt: s.startedAt, hints: s.hints, guesses: s.guesses,
    solution: TEST_MODE ? s.puzzle.solution : undefined,
  }, puzzleView(s.puzzle, s.guesses));
}

// ================= 协作房间 =================
const rooms = new Map(); // code -> room
const sidIndex = new Map(); // sid -> { code, idx }

function newCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

function roomView(room) {
  return Object.assign({
    t: 'room', code: room.code, length: room.length, vocab: room.vocab, mode: room.mode,
    players: room.players.map(p => ({ name: p.name, online: !!p.ws, user: p.user || null })),
    startedAt: room.startedAt, hints: room.hints, guesses: room.guesses,
    solved: room.solved, sentence: room.solved ? room.puzzle.sentence : null,
    solution: TEST_MODE ? room.puzzle.solution : undefined,
  }, puzzleView(room.puzzle, room.guesses));
}

function broadcast(room, obj) { for (const p of room.players) if (p.ws) send(p.ws, obj); }
function syncRoom(room) { broadcast(room, roomView(room)); }

const ROOM_TTL = 2 * 60 * 60 * 1000;
function scheduleRoomCleanup(room) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (!room.players.some(x => x.ws)) {
      rooms.delete(room.code);
      room.players.forEach(x => x.sid && sidIndex.delete(x.sid));
      console.log(`房间 ${room.code} 全员离线超过2小时, 已清理`);
    }
  }, ROOM_TTL);
}

function newRoom(length, vocab, mode) {
  const code = newCode();
  const room = {
    code,
    length: P.LENGTHS[length] ? length : 'mid',
    vocab: P.VOCABS[vocab] ? vocab : 'basic',
    mode: mode === 'letter' ? 'letter' : 'symbol',
    puzzle: P.makePuzzle({ length, vocab }), guesses: {}, hints: 0, solved: false,
    players: [], startedAt: Date.now(), timer: null,
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(room, ws, name, user, resumedSid) {
  if (room.players.length >= 6 && !resumedSid) { send(ws, { t: 'error', msg: '房间已满(6人)' }); return false; }
  let idx, sid;
  if (resumedSid) {
    idx = room.players.findIndex(p => p.sid === resumedSid);
    if (idx < 0) { send(ws, { t: 'resume_fail', sid: resumedSid }); return false; }
    sid = resumedSid;
    room.players[idx].ws = ws; room.players[idx].online = true;
    clearTimeout(room.timer);
  } else {
    sid = crypto.randomBytes(8).toString('hex');
    idx = room.players.length;
    room.players.push({ ws, name, user: user || null, sid, online: true });
  }
  if (!ws._sids) ws._sids = new Set();
  ws._sids.add(sid);
  sidIndex.set(sid, { code: room.code, idx });
  send(ws, Object.assign(roomView(room), { t: 'welcome', sid, resumed: !!resumedSid }));
  if (resumedSid) send(ws, { t: 'info', msg: '已回到房间, 继续破译' });
  syncRoom(room);
  return true;
}

function leaveRoom(room, ws) {
  const i = room.players.findIndex(p => p.ws === ws);
  if (i < 0) return;
  const p = room.players[i];
  room.players.splice(i, 1);
  if (p.sid) { sidIndex.delete(p.sid); ws._sids && ws._sids.delete(p.sid); }
  send(ws, { t: 'bye', code: room.code });
  if (!room.players.length) {
    rooms.delete(room.code);
    clearTimeout(room.timer);
  } else {
    if (!room.players.some(x => x.ws)) scheduleRoomCleanup(room);
    syncRoom(room);
  }
  pushFriendsAll();
}

function finishRoom(room) {
  room.solved = true;
  const seconds = Math.round((Date.now() - room.startedAt) / 1000);
  addHistory({
    kind: 'cipher', code: room.code,
    players: room.players.map(p => p.name),
    sentence: room.puzzle.sentence,
    length: room.length, vocab: room.vocab, mode: room.mode, hints: room.hints, seconds,
  });
  broadcast(room, {
    t: 'solved', code: room.code, sentence: room.puzzle.sentence,
    seconds, hints: room.hints, players: room.players.map(p => p.name),
  });
  console.log(`房间 ${room.code}: 破译成功 (${seconds}s, 提示${room.hints}次)`);
}

// ================= HTTP =================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); },
}));
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, online: onlineUsers.size }));
app.get('/api/history', (req, res) => {
  const mine = history.filter(h => req.query.name ? (h.players || []).includes(String(req.query.name)) : true);
  res.json({ name: NAME, total: mine.length, recent: mine.slice(-100).reverse() });
});
app.post('/api/me', (req, res) => {
  const token = String((req.body && req.body.token) || '');
  const user = token && Object.keys(accounts().users).find(k => accounts().users[k].token === token);
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ user, name: accounts().users[user].name });
});

const server = http.createServer(app);

// ================= WebSocket =================
const WS_PATHS = new Set(['/cipher-ws', '/ws']);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  if (!WS_PATHS.has(u.pathname)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function doAuthOk(ws, user) {
  const acc = accounts().users[user];
  if (!acc) return;
  ws._user = user;
  ws._token = acc.token;
  touchOnline(user, ws, true);
  send(ws, { t: 'auth_ok', user, name: acc.name, token: acc.token, vapidPub: VAPID ? VAPID.pub : null, ...friendsView(user) });
  // 送达排队中的邀请 (10 分钟内有效)
  const now = Date.now();
  const pending = (pendingInvites.get(user) || []).filter(iv => now - iv.ts < 10 * 60 * 1000 && rooms.has(iv.code));
  pendingInvites.set(user, []);
  pending.forEach(iv => send(ws, { t: 'invite', from: iv.from, fromName: iv.fromName, code: iv.code }));
}

function handle(ws, msg) {
  if (!msg || typeof msg.t !== 'string') return;
  switch (msg.t) {
    // ---------------- 账号 ----------------
    case 'login': {
      const user = String(msg.user || '').trim();
      const a = accounts().users[user];
      if (!a || a.pass !== hashPass(a.salt, String(msg.pass || ''))) return send(ws, { t: 'error', msg: '账号或密码错误' });
      doAuthOk(ws, user);
      break;
    }
    case 'auto_login': {
      const user = Object.keys(accounts().users).find(k => accounts().users[k].token === msg.token);
      if (user) doAuthOk(ws, user);
      else send(ws, { t: 'auth_fail' });
      break;
    }
    case 'logout': {
      if (ws._user) touchOnline(ws._user, ws, false);
      ws._user = null;
      send(ws, { t: 'logged_out' });
      break;
    }
    case 'register': {
      const user = String(msg.user || '').trim();
      const pass = String(msg.pass || '');
      const name = (String(msg.name || '').trim() || user).slice(0, 8);
      if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,16}$/.test(user)) return send(ws, { t: 'error', msg: '账号需 2-16 位(中文/字母/数字/下划线)' });
      if (pass.length < 4) return send(ws, { t: 'error', msg: '密码至少 4 位' });
      relayMj(null, [{ t: 'register', user, pass, name }]).then(r => {
        if (!r.ok) return send(ws, { t: 'error', msg: r.msg });
        doAuthOk(ws, user);
      });
      break;
    }
    case 'add_friend':
    case 'accept_friend':
    case 'decline_friend': {
      if (!ws._user || !ws._token) return send(ws, { t: 'error', msg: '请先登录' });
      const op = { t: msg.t, user: String(msg.user || '') };
      relayMj(ws._token, [op]).then(r => {
        if (!r.ok) return send(ws, { t: 'error', msg: r.msg });
        send(ws, { t: 'info', msg: r.msg && r.msg !== '成功' ? r.msg : '操作成功' });
        pushFriendsAll();
      });
      break;
    }
    case 'push_sub': {
      if (!ws._user || !ws._token) return;
      const sub = msg.sub;
      if (!sub || !sub.endpoint) return;
      relayMj(ws._token, [{ t: 'push_sub', sub }]).catch(() => {});
      break;
    }
    // ---------------- 单人 ----------------
    case 'puzzle_new': {
      const length = P.LENGTHS[msg.length] ? msg.length : 'mid';
      const vocab = P.VOCABS[msg.vocab] ? msg.vocab : 'basic';
      const mode = msg.mode === 'letter' ? 'letter' : 'symbol';
      ws._solo = { puzzle: P.makePuzzle({ length, vocab }), mode, guesses: {}, hints: 0, startedAt: Date.now() };
      send(ws, mySoloView(ws));
      break;
    }
    case 'guess': {
      const s = ws._solo;
      if (!s || s.puzzle.id !== String(msg.pid || '')) return;
      const c = String(msg.c || ''), p = msg.p ? String(msg.p) : '';
      if (!isLetter(c)) return;
      if (p && !isLetter(p)) return;
      if (p) s.guesses[c] = p; else delete s.guesses[c];
      const view = mySoloView(ws);
      send(ws, view);
      if (view.solved) {
        const seconds = Math.round((Date.now() - s.startedAt) / 1000);
        addHistory({
          kind: 'cipher', players: [ws._user ? accounts().users[ws._user].name : '访客'],
          sentence: s.puzzle.sentence, length: s.puzzle.length, vocab: s.puzzle.vocab, mode: s.mode,
          hints: s.hints, seconds,
        });
        send(ws, { t: 'solved', pid: s.puzzle.id, sentence: s.puzzle.sentence, seconds, hints: s.hints });
      }
      break;
    }
    case 'hint': {
      const s = ws._solo;
      if (!s || s.puzzle.id !== String(msg.pid || '')) return;
      if (s.hints >= 3) return send(ws, { t: 'error', msg: '提示次数已用完(3次)' });
      const c = s.puzzle.uniqueCipher.find(x => s.guesses[x] !== s.puzzle.solution[x]);
      if (!c) return;
      s.guesses[c] = s.puzzle.solution[c];
      s.hints++;
      const view = mySoloView(ws);
      send(ws, Object.assign({ hint: { c, p: s.puzzle.solution[c] } }, view));
      if (view.solved) {
        const seconds = Math.round((Date.now() - s.startedAt) / 1000);
        addHistory({ kind: 'cipher', players: [ws._user ? accounts().users[ws._user].name : '访客'], sentence: s.puzzle.sentence, length: s.puzzle.length, vocab: s.puzzle.vocab, mode: s.mode, hints: s.hints, seconds });
        send(ws, { t: 'solved', pid: s.puzzle.id, sentence: s.puzzle.sentence, seconds, hints: s.hints });
      }
      break;
    }
    // ---------------- 协作房间 ----------------
    case 'room_create': {
      const name = ws._user ? accounts().users[ws._user].name : String(msg.name || '玩家').slice(0, 12);
      const room = newRoom(msg.length, msg.vocab, msg.mode);
      joinRoom(room, ws, name, ws._user);
      break;
    }
    case 'room_join': {
      const code = String(msg.code || '').trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: `房间 ${code} 不存在或已过期` });
      const name = ws._user ? accounts().users[ws._user].name : String(msg.name || '玩家').slice(0, 12);
      joinRoom(room, ws, name, ws._user);
      break;
    }
    case 'resume': {
      const sid = String(msg.sid || '');
      if (!sid) return send(ws, { t: 'resume_fail', sid });
      if (ws._sids && ws._sids.has(sid)) return;
      const ref = sidIndex.get(sid);
      if (!ref) return send(ws, { t: 'resume_fail', sid });
      const room = rooms.get(ref.code);
      if (!room) { sidIndex.delete(sid); return send(ws, { t: 'resume_fail', sid }); }
      joinRoom(room, ws, null, null, sid);
      break;
    }
    case 'room_guess': {
      const room = rooms.get(String(msg.code || ''));
      if (!room || room.solved) return;
      if (!room.players.some(p => p.ws === ws)) return;
      const c = String(msg.c || ''), p = msg.p ? String(msg.p) : '';
      if (!isLetter(c) || (p && !isLetter(p))) return;
      if (p) room.guesses[c] = p; else delete room.guesses[c];
      const view = roomView(room);
      broadcast(room, view);
      if (view.solved) finishRoom(room);
      break;
    }
    case 'room_hint': {
      const room = rooms.get(String(msg.code || ''));
      if (!room || room.solved) return;
      if (!room.players.some(p => p.ws === ws)) return;
      if (room.hints >= 3) return send(ws, { t: 'error', msg: '提示次数已用完(3次)' });
      const c = room.puzzle.uniqueCipher.find(x => room.guesses[x] !== room.puzzle.solution[x]);
      if (!c) return;
      room.guesses[c] = room.puzzle.solution[c];
      room.hints++;
      const by = ws._user ? accounts().users[ws._user].name : '队友';
      broadcast(room, Object.assign(roomView(room), { hint: { c, p: room.puzzle.solution[c], by } }));
      const view = roomView(room);
      if (view.solved) finishRoom(room);
      break;
    }
    case 'room_new': {
      const room = rooms.get(String(msg.code || ''));
      if (!room || !room.players.some(p => p.ws === ws)) return;
      if (P.LENGTHS[msg.length]) room.length = msg.length;
      if (P.VOCABS[msg.vocab]) room.vocab = msg.vocab;
      room.mode = msg.mode === 'letter' ? 'letter' : room.mode;
      room.puzzle = P.makePuzzle({ length: room.length, vocab: room.vocab });
      room.guesses = {}; room.hints = 0; room.solved = false; room.startedAt = Date.now();
      broadcast(room, Object.assign(roomView(room), { renewed: true }));
      break;
    }
    case 'room_chat': {
      const room = rooms.get(String(msg.code || ''));
      if (!room || !room.players.some(p => p.ws === ws)) return;
      const text = String(msg.msg || '').slice(0, 120).trim();
      if (!text) return;
      const from = ws._user ? accounts().users[ws._user].name : '访客';
      broadcast(room, { t: 'chat', code: room.code, from, msg: text });
      break;
    }
    case 'room_leave': {
      const room = rooms.get(String(msg.code || ''));
      if (room) leaveRoom(room, ws);
      break;
    }
    case 'invite': {
      if (!ws._user) return send(ws, { t: 'error', msg: '请先登录' });
      const room = rooms.get(String(msg.code || ''));
      if (!room) return;
      const to = String(msg.to || '');
      const fromName = accounts().users[ws._user].name;
      const payload = { t: 'invite', from: ws._user, fromName, code: room.code, length: room.length, vocab: room.vocab };
      const set = onlineUsers.get(to);
      if (set && set.size) {
        for (const w of set) send(w, payload);
        send(ws, { t: 'info', msg: `已邀请 ${accounts().users[to] ? accounts().users[to].name : to}` });
      } else {
        const list = pendingInvites.get(to) || [];
        list.push({ from: ws._user, fromName, code: room.code, ts: Date.now() });
        pendingInvites.set(to, list.slice(-5));
        pushUser(to, '果果密语', `${fromName} 邀请你一起破译密信`);
        send(ws, { t: 'info', msg: '对方不在线, 已通过通知邀请' });
      }
      break;
    }
  }
}

wss.on('connection', (ws) => {
  ws._solo = null;
  ws._user = null;
  ws._sids = new Set();
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    try { handle(ws, msg); } catch (e) { console.error('处理消息出错', e); }
  });
  ws.on('close', () => {
    if (ws._user) touchOnline(ws._user, ws, false);
    for (const room of rooms.values()) {
      const i = room.players.findIndex(p => p.ws === ws);
      if (i >= 0) {
        room.players[i].ws = null;
        room.players[i].online = false;
        room.players[i].sid = room.players[i].sid; // 保留 sid 供重连
        if (!room.players.some(x => x.ws)) scheduleRoomCleanup(room);
        syncRoom(room);
      }
    }
  });
});

server.listen(PORT, () => console.log(`${NAME} 服务已启动, 端口 ${PORT}, 麻将中继: ${MJ_WS_URL}`));
