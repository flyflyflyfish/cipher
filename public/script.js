// 果果密语 · 前端
// 单人破译 + 好友协作房 (同一封密信, 共享译码, 聊天)
'use strict';

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'gg_wzq_token';
const NOTE_KEY = 'gg_cipher_note';
const LEN_NAME = { long: '长文 · 一整篇', mid: '中篇 · 两三句', short: '短句 · 一小句' };
const VOC_NAME = { basic: '日常词', plus: '进阶词', cet6: '六级词' };
const SRC_NAME = { scene: '随机小故事', quote: '名言名篇', custom: '好友出的题' };
const labelOf = v => {
  if (!v) return '—';
  if (v.custom || v.length === 'custom' || v.source === 'custom') return '好友出的题';
  return `${LEN_NAME[v.length] || v.length || '—'} · ${VOC_NAME[v.vocab] || v.vocab || '—'}`;
};

const S = {
  me: { user: null, name: null, token: null, friends: [], requests: [] },
  conn: { ws: null, connected: false, timer: null, pending: [] },
  length: 'long',
  vocab: 'basic',
  mode: 'symbol',
  source: 'scene',   // scene | quote | custom
  strict: false,     // 严格模式: 不逐词反馈
  cur: null,        // 当前谜题视图 (solo 或 room)
  room: null,       // 房间视图
  sids: {},         // code -> sid (重连用)
  pickC: null,      // 正在填的密文字母
  startedAt: 0,
  tick: null,
  solvedShown: false,
  guest: null,
  caseCollapsed: false,  // 案情简报是否收起
  tut: null,        // 新手教学状态
};

// ---------------- 基础工具 ----------------
function guestName() {
  if (!S.guest) {
    S.guest = sessionStorage.getItem('gg_cipher_nick');
    if (!S.guest) {
      S.guest = '访客' + Math.floor(10 + Math.random() * 90);
      sessionStorage.setItem('gg_cipher_nick', S.guest);
    }
  }
  return S.guest;
}
function setErr(t) {
  $('msgErr').textContent = t || '';
  if (t) setTimeout(() => { if ($('msgErr').textContent === t) $('msgErr').textContent = ''; }, 4000);
}
const fmtTime = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------------- 全屏 ----------------
$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// ---------------- WebSocket ----------------
function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${proto}${location.host}/cipher-ws`;
}
function oSend(obj) {
  if (S.conn.ws && S.conn.ws.readyState === 1) S.conn.ws.send(JSON.stringify(obj));
  else S.conn.pending.push(obj);
}
function oConnect() {
  clearTimeout(S.conn.timer);
  try { S.conn.ws = new WebSocket(wsUrl()); } catch (e) { return scheduleReconnect(); }
  S.conn.ws.onopen = () => {
    S.conn.connected = true;
    if (S.me.token) oSend({ t: 'auto_login', token: S.me.token });
    const queue = S.conn.pending.splice(0);
    for (const code of Object.keys(S.sids)) oSend({ t: 'resume', sid: S.sids[code] });
    queue.forEach(m => oSend(m));
  };
  S.conn.ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    handleMsg(m);
  };
  S.conn.ws.onclose = () => {
    S.conn.connected = false;
    if (S.room) setErr('⚠ 连接断开, 正在重连…');
    scheduleReconnect();
  };
}
function scheduleReconnect() {
  clearTimeout(S.conn.timer);
  S.conn.timer = setTimeout(oConnect, 2000);
}

// ---------------- 消息处理 ----------------
function handleMsg(m) {
  switch (m.t) {
    case 'auth_ok':
      S.me.user = m.user; S.me.name = m.name; S.me.token = m.token;
      S.me.friends = m.friends || []; S.me.requests = m.requests || [];
      localStorage.setItem(TOKEN_KEY, m.token);
      renderUser(); renderFriends(); applyPendingRoom();
      break;
    case 'auth_fail':
      localStorage.removeItem(TOKEN_KEY);
      S.me.token = null; renderUser();
      break;
    case 'friends':
      S.me.friends = m.friends || []; S.me.requests = m.requests || [];
      renderFriends();
      break;
    case 'puzzle':
      S.room = null;
      stateEnterGame();
      S.startedAt = m.startedAt;
      renderPuzzle(m);
      break;
    case 'welcome': { // 进入协作房
      S.room = m;
      S.sids[m.code] = m.sid;
      stateEnterGame();
      S.startedAt = m.startedAt;
      renderPuzzle(m);
      $('chatCard').classList.remove('hidden');
      $('inviteBtn').classList.remove('hidden');
      $('copyBtn').classList.remove('hidden');
      addChat(null, `进入房间 ${m.code}, 把房间号或邀请链接发给朋友吧`);
      pushFriendsToRoomBroadcast();
      break;
    }
    case 'room':
      if (!S.room || S.room.code !== m.code) return;
      S.room = m;
      renderPuzzle(m);
      break;
    case 'solved':
      showWin(m);
      renderFriends();
      break;
    case 'custom_ok':
      showShare(m);
      break;
    case 'check_result': {
      const msg = m.right === m.total
        ? `全对！${m.total} 种符号一个不差`
        : `共 ${m.total} 种符号，你对了 ${m.right} 种${m.right === 0 ? '，再想想' : ''}`;
      setErr('🔎 ' + msg);
      break;
    }
    case 'custom_solved':
      setErr(`✅ ${m.by} 解开了你出的密信：${m.sentence}`);
      break;
    case 'chat': addChat(m.from, m.msg); break;
    case 'info': setErr('✅ ' + m.msg); break;
    case 'error': setErr('⚠ ' + m.msg); break;
    case 'bye':
      if (S.room && S.room.code === m.code) {
        delete S.sids[m.code];
        S.room = null;
        leaveToLobby();
        setErr('已离开房间');
      }
      break;
    case 'resume_fail':
      for (const k of Object.keys(S.sids)) if (S.sids[k] === m.sid) delete S.sids[k];
      break;
    case 'invite': {
      const ok = confirm(`${m.fromName} 邀请你一起破译一封密信 (房间 ${m.code}), 现在加入?`);
      if (ok) oSend({ t: 'room_join', code: m.code, name: guestName() });
      break;
    }
    case 'logged_out':
      S.me.user = null; S.me.name = null; S.me.token = null;
      renderUser();
      break;
  }
}

// ---------------- 大厅交互 ----------------
$('lenChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  S.length = b.dataset.len;
  [...$('lenChips').children].forEach(x => x.classList.toggle('active', x === b));
});
$('vocabChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  S.vocab = b.dataset.vocab;
  [...$('vocabChips').children].forEach(x => x.classList.toggle('active', x === b));
});
$('modeChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  S.mode = b.dataset.mode;
  [...$('modeChips').children].forEach(x => x.classList.toggle('active', x === b));
});
$('judgeChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  S.strict = b.dataset.strict === '1';
  [...$('judgeChips').children].forEach(x => x.classList.toggle('active', x === b));
});

// 题目来源: 随机 / 名言 / 自己出题
$('srcChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  S.source = b.dataset.src;
  [...$('srcChips').children].forEach(x => x.classList.toggle('active', x === b));
  const isCustom = S.source === 'custom';
  $('customBox').classList.toggle('hidden', !isCustom);
  $('soloBtn').classList.toggle('hidden', isCustom);
  $('roomCreateBtn').classList.toggle('hidden', isCustom);
  $('tutorialBtn').classList.toggle('hidden', isCustom);
  if (isCustom) {
    // 自定义题由玩家决定样式, 篇幅/词汇无意义
    $('lenChips').closest('.opt-group').classList.add('dim');
    $('vocabChips').closest('.opt-group').classList.add('dim');
    $('customText').focus();
  } else {
    $('lenChips').closest('.opt-group').classList.remove('dim');
    $('vocabChips').closest('.opt-group').classList.remove('dim');
  }
});

$('customText').addEventListener('input', () => {
  $('customCount').textContent = $('customText').value.length;
});
$('customCreateBtn').addEventListener('click', () => {
  const text = $('customText').value.trim();
  if (!text) return setErr('先写一句英文吧');
  oSend({ t: 'custom_create', sentence: text, mode: S.mode, strict: S.strict, name: guestName() });
});

$('soloBtn').addEventListener('click', () => {
  oSend({ t: 'puzzle_new', length: S.length, vocab: S.vocab, mode: S.mode, source: S.source, strict: S.strict });
});
$('roomCreateBtn').addEventListener('click', () => {
  oSend({ t: 'room_create', length: S.length, vocab: S.vocab, mode: S.mode, source: S.source, strict: S.strict, name: guestName() });
});
$('joinBtn').addEventListener('click', () => {
  const code = $('joinCode').value.trim();
  if (!/^\d{4}$/.test(code)) return setErr('请输入 4 位房间号');
  oSend({ t: 'room_join', code, name: guestName() });
});
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });

// 邀请链接 ?room=1234
let pendingRoom = new URLSearchParams(location.search).get('room');
function applyPendingRoom() {
  if (pendingRoom) {
    const code = pendingRoom; pendingRoom = null;
    oSend({ t: 'room_join', code, name: guestName() });
  }
}

// ---------------- 登录 ----------------
function renderUser() {
  const loginBtn = $('showLoginBtn'), menu = $('userMenu'), drop = $('userDrop');
  const fCard = $('friendsCard'), lobbyLogin = $('lobbyLoginBtn');
  drop.classList.add('hidden');
  if (S.me.user) {
    $('userBtn').textContent = '👤 ' + S.me.name;
    loginBtn.classList.add('hidden');
    menu.classList.remove('hidden');
    $('loginBox').classList.add('hidden');
    lobbyLogin.classList.add('hidden');
    fCard.classList.remove('hidden');
    $('recordBtn').classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
    loginBtn.classList.remove('hidden');
    $('loginBox').classList.add('hidden');
    lobbyLogin.classList.remove('hidden');
    fCard.classList.add('hidden');
    $('recordBtn').classList.add('hidden');
  }
}
$('userBtn').addEventListener('click', e => { e.stopPropagation(); $('userDrop').classList.toggle('hidden'); });
document.addEventListener('click', e => {
  if (!$('userMenu').contains(e.target)) $('userDrop').classList.add('hidden');
});

function expandLoginBox() {
  $('lobbyLoginBtn').classList.add('hidden');
  $('loginBox').classList.remove('hidden');
  $('loginUser').focus();
  $('loginBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('showLoginBtn').addEventListener('click', expandLoginBox);
$('lobbyLoginBtn').addEventListener('click', expandLoginBox);
$('loginBtn').addEventListener('click', () => {
  const user = $('loginUser').value.trim(), pass = $('loginPass').value;
  if (!user || !pass) return setErr('请输入账号和密码');
  oSend({ t: 'login', user, pass });
});
$('regBtn').addEventListener('click', () => {
  const btn = $('regBtn');
  if ($('regName').classList.contains('hidden')) {
    $('regName').classList.remove('hidden');
    btn.textContent = '确认注册';
    return;
  }
  const user = $('loginUser').value.trim(), pass = $('loginPass').value;
  const name = $('regName').value.trim();
  if (!user || !pass) return setErr('请输入账号和密码');
  oSend({ t: 'register', user, pass, name });
});
$('skipBtn').addEventListener('click', () => $('loginBox').classList.add('hidden'));
$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  S.me.user = null; S.me.name = null; S.me.token = null;
  S.me.friends = []; S.me.requests = [];
  renderUser(); renderFriends();
  oSend({ t: 'logout' });
});

// ---------------- 好友 ----------------
function renderFriends() {
  const reqEl = $('friendReq'), listEl = $('friendList');
  reqEl.innerHTML = ''; listEl.innerHTML = '';
  (S.me.requests || []).forEach(r => {
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.innerHTML = `<span class="name">🙋 ${r.name} 请求加你为好友</span>`;
    const ok = document.createElement('button'); ok.textContent = '同意'; ok.className = 'primary';
    ok.onclick = () => oSend({ t: 'accept_friend', user: r.user });
    const no = document.createElement('button'); no.textContent = '拒绝';
    no.onclick = () => oSend({ t: 'decline_friend', user: r.user });
    div.appendChild(ok); div.appendChild(no);
    reqEl.appendChild(div);
  });
  (S.me.friends || []).forEach(f => {
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.innerHTML = `<span class="dot ${f.online ? 'on' : ''}"></span><span class="name">${f.name}${f.online ? '' : ' (离线)'}</span>`;
    const inv = document.createElement('button');
    inv.textContent = '邀请';
    inv.disabled = !S.room;
    inv.title = S.room ? '邀请一起破译' : '先进房间再邀请';
    inv.onclick = () => oSend({ t: 'invite', to: f.user, code: S.room.code });
    div.appendChild(inv);
    listEl.appendChild(div);
  });
  if (!S.me.friends.length && !S.me.requests.length) {
    listEl.innerHTML = '<p class="record-empty">还没有好友, 输入对方账号加一个吧</p>';
  }
}
$('addFriendBtn').addEventListener('click', () => {
  const u = $('addFriendInput').value.trim();
  if (!u) return;
  oSend({ t: 'add_friend', user: u });
  $('addFriendInput').value = '';
});
$('inviteBtn').addEventListener('click', () => {
  if (!S.room) return;
  if (!S.me.user) return setErr('登录后才能邀请好友');
  const list = $('inviteList');
  list.innerHTML = '';
  if (!S.me.friends.length) list.innerHTML = '<p class="record-empty">还没有好友, 先去大厅加好友吧</p>';
  S.me.friends.forEach(f => {
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.innerHTML = `<span class="dot ${f.online ? 'on' : ''}"></span><span class="name">${f.name}</span>`;
    const b = document.createElement('button'); b.textContent = '邀请';
    b.onclick = () => { oSend({ t: 'invite', to: f.user, code: S.room.code }); b.disabled = true; b.textContent = '已邀请'; };
    div.appendChild(b);
    list.appendChild(div);
  });
  $('inviteModal').classList.remove('hidden');
});
$('inviteClose').addEventListener('click', () => $('inviteModal').classList.add('hidden'));
$('inviteModal').addEventListener('click', e => { if (e.target === $('inviteModal')) $('inviteModal').classList.add('hidden'); });

$('copyBtn').addEventListener('click', () => {
  if (!S.room) return;
  const url = `${location.origin}/cipher/?room=${S.room.code}`;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => setErr('✅ 邀请链接已复制'))
    .catch(() => { prompt('复制这个邀请链接:', url); });
});

function pushFriendsToRoomBroadcast() { renderFriends(); }

// ---------------- 对局界面 ----------------
function stateEnterGame() {
  $('lobby').classList.add('hidden');
  $('gamePanel').classList.remove('hidden');
  S.solvedShown = false;
  startTick();
}
function leaveToLobby() {
  $('gamePanel').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('chatCard').classList.add('hidden');
  $('inviteBtn').classList.add('hidden');
  $('copyBtn').classList.add('hidden');
  $('gRoom').classList.add('hidden');
  stopTick();
  S.room = null;
  renderUser(); renderFriends();
}
$('leaveBtn').addEventListener('click', () => {
  if (S.room) oSend({ t: 'room_leave', code: S.room.code });
  else leaveToLobby();
});
$('newBtn').addEventListener('click', () => {
  const opts = { length: S.length, vocab: S.vocab, mode: S.mode, source: S.source, strict: S.strict };
  if (S.room) oSend(Object.assign({ t: 'room_new', code: S.room.code }, opts));
  else oSend(Object.assign({ t: 'puzzle_new' }, opts));
});
$('hintBtn').addEventListener('click', () => {
  if (!S.cur || S.tut) return;
  if (S.room) oSend({ t: 'room_hint', code: S.room.code });
  else oSend({ t: 'hint', pid: S.cur.pid });
});
$('caseToggle').addEventListener('click', () => {
  S.caseCollapsed = !S.caseCollapsed;
  $('caseCard').classList.toggle('collapsed', S.caseCollapsed);
  $('caseToggle').textContent = S.caseCollapsed ? '展开' : '收起';
});
$('checkBtn').addEventListener('click', () => {
  if (!S.cur || S.tut || S.room) return;   // 严格模式的验算只支持单人局
  oSend({ t: 'check', pid: S.cur.pid });
});

function startTick() {
  stopTick();
  S.tick = setInterval(() => {
    if (S.startedAt) $('gTimer').textContent = '⏱ ' + fmtTime(Date.now() - S.startedAt);
  }, 500);
}
function stopTick() { clearInterval(S.tick); S.tick = null; }

function glyphHtml(c, cls) {
  if (S.cur && S.cur.mode === 'letter') return `<span class="gl letter ${cls || ''}">${c}</span>`;
  return `<span class="gl ${cls || ''}">${window.CipherGlyphs.glyphOf(c)}</span>`;
}

function renderPuzzle(v) {
  S.cur = v;
  if (v.code) {
    S.room = v;
    $('gRoom').classList.remove('hidden');
    $('gCode').textContent = v.code;
  } else {
    $('gRoom').classList.add('hidden');
  }
  $('gLevel').textContent = v.custom || v.authorName ? `好友出的题${v.authorName ? ' · ' + v.authorName : ''}` : labelOf(v);
  $('gHints').textContent = `💡 ${v.hints || 0}/3`;
  const strict = !!v.strict;
  // 案情简报: 教学局不显示
  const cc = $('caseCard');
  if (S.tut || !v.brief) {
    cc.classList.add('hidden');
  } else {
    cc.classList.remove('hidden');
    $('caseBrief').textContent = v.brief;
    cc.classList.toggle('collapsed', !!S.caseCollapsed);
    $('caseToggle').textContent = S.caseCollapsed ? '展开' : '收起';
  }
  $('gStrict').classList.toggle('hidden', !strict);
  $('checkBtn').classList.toggle('hidden', !strict || !!S.tut);

  // ---- 密信 ----
  const letter = $('letter');
  const nL = v.letters || 0;
  letter.className = 'letter' + (nL > 200 ? ' dense' : nL > 120 ? ' compact' : '');
  letter.innerHTML = '';
  v.words.forEach((w, wi) => {
    const wd = document.createElement('span');
    wd.className = 'word' + (w.ok ? ' ok' : '');
    wd.dataset.i = wi;
    w.chars.forEach(ch => {
      const t = ch.c;
      if (/^[A-Z]$/.test(t)) {
        const sym = document.createElement('span');
        sym.className = 'sym' + (ch.g ? ' filled' : '') + (v.confirmed[t] ? ' confirmed' : '');
        sym.dataset.c = t;
        sym.innerHTML = glyphHtml(t) + `<span class="slot">${ch.g || '·'}</span>`;
        sym.addEventListener('click', () => openPicker(t));
        wd.appendChild(sym);
      } else {
        const p = document.createElement('span');
        p.className = 'punc';
        p.textContent = t;
        wd.appendChild(p);
      }
    });
    letter.appendChild(wd);
  });

  // ---- 密码本 ----
  const box = $('codeList');
  box.innerHTML = '';
  const conf = v.confirmed || {};
  (v.freq || []).forEach(({ c, n }) => {
    const item = document.createElement('div');
    item.className = 'code-item' + (conf[c] ? ' confirmed' : '');
    item.dataset.c = c;
    const val = (v.guesses && v.guesses[c]) || '·';
    item.innerHTML = glyphHtml(c) + `<span class="cnt">${n} 次</span><span class="val">${val}</span>`;
    item.addEventListener('click', () => openPicker(c));
    box.appendChild(item);
  });

  // ---- 页脚 ----
  const total = v.letters || 0, unique = (v.freq || []).length, confirmedN = Object.keys(conf).length;
  const filledN = (v.freq || []).filter(({ c }) => v.guesses && v.guesses[c]).length;
  $('fLetters').textContent = total;
  $('fUnique').textContent = unique;
  if (strict) {
    $('fProgress').textContent = filledN
      ? `已填 ${filledN}/${unique} 种符号 · 点「检查」验一次`
      : '严格模式: 不给逐词提示, 填完点「检查」';
  } else {
    $('fProgress').textContent = confirmedN
      ? `已确认 ${confirmedN}/${unique} 种符号`
      : '尚未确认, 先从最高频的符号下手';
  }

  S.startedAt = v.startedAt || S.startedAt;
  if (S.startedAt) $('gTimer').textContent = '⏱ ' + fmtTime(Date.now() - S.startedAt);
  if (!S.tick) startTick();
}

// ---------------- 填字母弹层 ----------------
function openPicker(c) {
  S.pickC = c;
  const cur = (S.cur && S.cur.guesses && S.cur.guesses[c]) || '';
  $('pickerPreview').innerHTML = glyphHtml(c) + `<span>已填: <b>${cur || '·'}</b></span>`;
  const grid = $('pickerGrid');
  grid.innerHTML = '';
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(ch => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ch;
    if (ch === cur) b.classList.add('cur');
    b.addEventListener('click', () => { assign(c, ch); closePicker(); });
    grid.appendChild(b);
  });
  $('picker').classList.remove('hidden');
}
function closePicker() { $('picker').classList.add('hidden'); S.pickC = null; }
$('pickerClose').addEventListener('click', closePicker);
$('pickerClear').addEventListener('click', () => { if (S.pickC) assign(S.pickC, null); closePicker(); });
$('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });

function assign(c, p) {
  if (!S.cur) return;
  if (S.tut) {              // 教学局: 纯本地, 允许随便试
    if (p) S.tut.guesses[c] = p; else delete S.tut.guesses[c];
    drawTut();
    return;
  }
  if (S.room) oSend({ t: 'room_guess', code: S.room.code, c, p });
  else oSend({ t: 'guess', pid: S.cur.pid, c, p });
}

// ---------------- 聊天 ----------------
function addChat(from, text) {
  const p = document.createElement('p');
  if (from) p.innerHTML = `<span class="who">${from}</span>: ${text.replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]))}`;
  else { p.className = 'sys'; p.textContent = text; }
  const log = $('chatLog');
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text || !S.room) return;
  oSend({ t: 'room_chat', code: S.room.code, msg: text });
  $('chatInput').value = '';
});

// ---------------- 胜利 ----------------
function showWin(m) {
  S.solvedShown = true;
  $('winSentence').textContent = m.sentence || '';
  const truth = m.truth || (S.cur && S.cur.truth) || '';
  $('winTruth').textContent = truth;
  $('winTruth').classList.toggle('hidden', !truth);
  let cite = '';
  if (m.custom && m.authorName) cite = `这封密信是 ${m.authorName} 出的题` + (m.cite ? ' · ' + m.cite : '');
  else if (m.cite) cite = '出处 · ' + m.cite;
  $('winCite').textContent = cite;
  $('winCite').classList.toggle('hidden', !cite);
  const who = (m.players && m.players.length > 1) ? ` · ${m.players.join('、')} 一起完成` : '';
  $('winMeta').textContent = `用时 ${fmtTime((m.seconds || 0) * 1000)} · 提示 ${m.hints || 0} 次${who}`;
  $('winModal').classList.remove('hidden');
  stopTick();
}
$('winAgain').addEventListener('click', () => {
  $('winModal').classList.add('hidden');
  S.solvedShown = false;
  // 好友出的题没法"再来一封", 直接回大厅
  if (S.room && S.room.custom) { oSend({ t: 'room_leave', code: S.room.code }); return; }
  const opts = { length: S.length, vocab: S.vocab, mode: S.mode, source: S.source, strict: S.strict };
  if (S.room) oSend(Object.assign({ t: 'room_new', code: S.room.code }, opts));
  else oSend(Object.assign({ t: 'puzzle_new' }, opts));
});
$('winBack').addEventListener('click', () => {
  $('winModal').classList.add('hidden');
  if (S.room) oSend({ t: 'room_leave', code: S.room.code });
  else leaveToLobby();
});

// ---------------- 出题成功: 分享密信 ----------------
function showShare(m) {
  $('shareCode').textContent = m.code;
  $('shareMeta').textContent = `${m.letters} 个字母 · ${m.unique} 种符号 · ${m.mode === 'letter' ? '字母' : '图案'}密文${m.strict ? ' · 严格模式' : ''}`;
  $('shareModal').dataset.code = m.code;
  $('shareModal').classList.remove('hidden');
  $('customText').value = '';
  $('customCount').textContent = '0';
}
$('shareCopy').addEventListener('click', () => {
  const code = $('shareModal').dataset.code;
  const url = `${location.origin}/cipher/?room=${code}`;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => setErr('✅ 邀请链接已复制'))
    .catch(() => { prompt('复制这个邀请链接:', url); });
});
$('shareClose').addEventListener('click', () => $('shareModal').classList.add('hidden'));
$('shareModal').addEventListener('click', e => { if (e.target === $('shareModal')) $('shareModal').classList.add('hidden'); });

// ================= 新手教学 =================
// 固定谜题: I SEE THE CAT AND THE DOG.
// 密文用固定替换表, 推理链是设计过的: 重复整词 → THE → E → SEE 交叉验证 → 收尾
const TUT_ENC = { I: 'Q', S: 'R', E: 'C', T: 'X', H: 'J', C: 'Z', A: 'F', N: 'M', D: 'K', O: 'W', G: 'L' };

function buildTutPuzzle() {
  const tokens = 'I SEE THE CAT AND THE DOG.'.split(' ').map(w => w.split('').map(ch => TUT_ENC[ch] || ch));
  const sol = {};
  Object.keys(TUT_ENC).forEach(p => { sol[TUT_ENC[p]] = p; });
  const freq = {};
  tokens.forEach(w => w.forEach(c => { if (/^[A-Z]$/.test(c)) freq[c] = (freq[c] || 0) + 1; }));
  return {
    tokens, sol, freq,
    uniqueCipher: Object.keys(freq).sort((a, b) => freq[b] - freq[a]),
    letters: 19,
  };
}

const TUT_STEPS = [
  {
    text: '先看右下角的<b>密码本</b>。它按「出现次数」从高到低排好了 —— 英文里最常见的字母是 E、T、A。<br />这封信里 <b>C</b> 出现了 4 次，是最多的那个，先盯住它。',
    syms: ['C'],
  },
  {
    text: '再扫一眼信：有两个词长得一模一样，都是 <b>X J C</b>。<br />英文里最常被反复使用的三字母词是什么？<b>THE</b>。',
    words: [2, 5],
  },
  {
    text: '假设 XJC 就是 THE，那 <b>X=T、J=H、C=E</b>。已经填好了 —— 注意 C 变成了 E，它正好是出现最多的符号。<br />两条线索对上了，这个假设基本可以信。',
    fill: { X: 'T', J: 'H', C: 'E' },
  },
  {
    text: '现在看 <b>R C C</b>。C 已经是 E 了，所以它是 <b>_ E E</b>。<br />哪个动词长这样？<b>SEE</b>。它中间那个字母也是 E —— 和上一步完全吻合，推理自洽了。',
    fill: { R: 'S' },
    syms: ['R', 'C'],
  },
  {
    text: '剩下的交给你：<b>Z F X</b> 结尾是 T，是 CAT；<b>F M K</b> 是 AND；<b>K W L</b> 是 DOG；句首那个单独的 <b>Q</b> 只能是 I 或 A，这里读作 I。<br />整封信读出来了：I SEE THE CAT AND THE DOG.',
    fill: { Q: 'I', Z: 'C', F: 'A', M: 'N', K: 'D', W: 'O', L: 'G' },
  },
  {
    text: '刚才你做的事，就是密码破译的全部套路：<br /><b>① 数频次</b> 找最像 E/T/A 的符号 → <b>② 找重复的整词</b> 锁定 THE → <b>③ 用已知的字母反推</b>剩下的词。<br />字母越多越好推，短句最难。去开一局真的吧。',
  },
];

function tutView() {
  const p = S.tut.puzzle, g = S.tut.guesses;
  const words = p.tokens.map(w => {
    const letters = w.filter(c => /^[A-Z]$/.test(c));
    const filled = letters.length > 0 && letters.every(c => g[c]);
    const ok = filled && letters.every(c => g[c] === p.sol[c]);
    return { chars: w.map(c => ({ c, g: /^[A-Z]$/.test(c) ? (g[c] || null) : null })), ok };
  });
  const confirmed = {};
  words.forEach(w => { if (w.ok) w.chars.forEach(x => { if (x.g) confirmed[x.c] = true; }); });
  return {
    t: 'puzzle', pid: 'tutorial', mode: 'letter', letters: p.letters,
    words, confirmed, solved: false, strict: false, hints: 0, guesses: g,
    freq: p.uniqueCipher.map(c => ({ c, n: p.freq[c] })), startedAt: 0,
  };
}

function tutHighlight(step) {
  document.querySelectorAll('#letter .tut-hi, #letter .tut-hi-word, #codeList .tut-hi').forEach(el => el.classList.remove('tut-hi', 'tut-hi-word'));
  if (step.syms) {
    document.querySelectorAll('#letter .sym').forEach(el => { if (step.syms.includes(el.dataset.c)) el.classList.add('tut-hi'); });
  }
  if (step.words) {
    document.querySelectorAll('#letter .word').forEach(el => { if (step.words.includes(+el.dataset.i)) el.classList.add('tut-hi-word'); });
  }
}

function drawTut() {
  const st = S.tut.step, step = TUT_STEPS[st];
  if (step.fill && !S.tut.applied[st]) { Object.assign(S.tut.guesses, step.fill); S.tut.applied[st] = true; }
  renderPuzzle(tutView());
  $('gTimer').textContent = '🎓 教学';
  $('tutStep').textContent = `第 ${st + 1} 步 / 共 ${TUT_STEPS.length} 步`;
  $('tutText').innerHTML = step.text;
  $('tutNext').textContent = st >= TUT_STEPS.length - 1 ? '去开一局真的' : '下一步';
  tutHighlight(step);
}

function startTutorial() {
  stopTick();
  S.room = null;
  S.tut = { puzzle: buildTutPuzzle(), guesses: {}, step: 0, applied: [] };
  S.startedAt = 0;
  $('lobby').classList.add('hidden');
  $('gamePanel').classList.remove('hidden');
  ['chatCard', 'inviteBtn', 'copyBtn', 'newBtn', 'hintBtn', 'leaveBtn', 'gHints', 'gRoom'].forEach(id => $(id).classList.add('hidden'));
  $('tutBar').classList.remove('hidden');
  S.solvedShown = false;
  drawTut();
  window.scrollTo(0, 0);
}

function endTutorial() {
  S.tut = null;
  $('tutBar').classList.add('hidden');
  ['newBtn', 'hintBtn', 'gHints', 'leaveBtn'].forEach(id => $(id).classList.remove('hidden'));
  $('checkBtn').classList.add('hidden');
  leaveToLobby();
  setErr('🎓 教学完成, 试试开一局真的');
}

$('tutorialBtn').addEventListener('click', startTutorial);
$('tutNext').addEventListener('click', () => {
  if (!S.tut) return;
  if (S.tut.step >= TUT_STEPS.length - 1) { endTutorial(); return; }
  S.tut.step++;
  drawTut();
});
$('tutExit').addEventListener('click', endTutorial);

// ---------------- 破译记录 ----------------
$('recordBtn').addEventListener('click', () => { renderRecord(); $('recordModal').classList.remove('hidden'); });
$('recordClose').addEventListener('click', () => $('recordModal').classList.add('hidden'));
$('recordModal').addEventListener('click', e => { if (e.target === $('recordModal')) $('recordModal').classList.add('hidden'); });

function renderRecord() {
  if (!S.me.user) return;
  fetch(`api/history?name=${encodeURIComponent(S.me.name)}`)
    .then(r => r.json())
    .then(d => {
      const list = d.recent || [];
      const totalLetters = list.reduce((s, h) => s + (h.sentence ? h.sentence.replace(/[^A-Z]/g, '').length : 0), 0);
      const avg = list.length ? Math.round(list.reduce((s, h) => s + (h.seconds || 0), 0) / list.length) : 0;
      $('recordSummary').textContent = `共破译 ${list.length} 封 · 累计 ${totalLetters} 个字母 · 平均用时 ${fmtTime(avg * 1000)}`;
      const box = $('recordList');
      box.innerHTML = '';
      list.slice(0, 30).forEach(h => {
        const div = document.createElement('div');
        div.className = 'record-item';
        const time = new Date(h.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `<span>🔓 ${labelOf(h)}</span>` +
          `<span style="color:#8d7a5c">${(h.sentence || '').slice(0, 26)}…</span>` +
          `<span style="color:#a3906f">${fmtTime((h.seconds || 0) * 1000)} · 💡${h.hints || 0}</span>` +
          `<span class="time">${time}</span>`;
        box.appendChild(div);
      });
      if (!list.length) box.innerHTML = '<p class="record-empty">还没有记录, 去破译第一封吧!</p>';
    })
    .catch(() => { $('recordSummary').textContent = '记录加载失败, 请稍后再试'; });
}

// ---------------- 草稿纸 ----------------
const scratch = $('scratch');
scratch.value = localStorage.getItem(NOTE_KEY) || '';
let noteTimer = null;
scratch.addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => localStorage.setItem(NOTE_KEY, scratch.value), 400);
});

// 手机浏览器 bfcache 恢复时重建
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

// ---------------- 启动 ----------------
(function boot() {
  S.me.token = localStorage.getItem(TOKEN_KEY);
  renderUser();
  oConnect();
  if (pendingRoom) $('joinCode').value = pendingRoom;
})();
