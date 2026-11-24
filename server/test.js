// 果果密语 · 自动化测试 (需以 CIPHER_TEST=1 启动服务, 视图里才会带谜底映射)
'use strict';
const WebSocket = require('ws');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:3012/ws';
let failures = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(name, cond, extra) {
  console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

class Client {
  constructor(tag) {
    this.tag = tag; this.msgs = []; this.waiters = [];
    this.ws = new WebSocket(URL);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', d => {
      const m = JSON.parse(d);
      this.msgs.push(m);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].pred(m)) { this.waiters[i].res(m); this.waiters.splice(i, 1); }
      }
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 6000, label = '') {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`等待超时 ${this.tag} ${label}`)), ms);
      this.waiters.push({ pred, res: m => { clearTimeout(to); res(m); } });
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  const A = new Client('A');
  await A.ready;

  // ---------- 单人: 三个难度都能出题并解出 ----------
  for (const [len, vocab, min, max] of [
    ['short', 'basic', 12, 30], ['mid', 'plus', 45, 100], ['long', 'cet6', 150, 310],
  ]) {
    A.msgs.length = 0; // 清历史消息, 避免命中上一局
    A.send({ t: 'puzzle_new', length: len, vocab, mode: 'symbol' });
    const p = await A.wait(m => m.t === 'puzzle' && m.length === len && m.vocab === vocab, 6000, len);
    check(`${len}/${vocab} 出题成功`, Array.isArray(p.words) && p.words.length > 1, `(${p.letters} 字母)`);
    check(`${len} 长度符合档位(${min}-${max})`, p.letters >= min && p.letters <= max, `实际 ${p.letters}`);
    check(`${len} 难度字段回传`, p.length === len && p.vocab === vocab);
    check(`${len} 带频次表`, Array.isArray(p.freq) && p.freq.length > 0);

    // 按谜底逐一填写 → 应当 solved
    const sol = p.solution;
    const letters = Object.keys(sol);
    const solvedP = A.wait(m => m.t === 'solved', 8000, len + ' solved');
    for (const c of letters) {
      A.send({ t: 'guess', pid: p.pid, c, p: sol[c] });
      await sleep(15);
    }
    const done = await solvedP;
    check(`${len} 全部填对后判定破译成功`, !!done.sentence && done.sentence.endsWith('.'));
    check(`${len} 用时/提示回传`, typeof done.seconds === 'number' && done.hints === 0);
  }

  // ---------- 单人: 提示 ----------
  A.msgs.length = 0;
  A.send({ t: 'puzzle_new', length: 'short', vocab: 'basic', mode: 'letter' });
  const p2 = await A.wait(m => m.t === 'puzzle' && m.mode === 'letter');
  for (let i = 0; i < 3; i++) {
    A.send({ t: 'hint', pid: p2.pid });
    const h = await A.wait(m => m.t === 'puzzle' && (m.hint || m.hints === i + 1));
    check(`第 ${i + 1} 次提示生效`, !!h);
  }
  A.send({ t: 'hint', pid: p2.pid });
  const over = await A.wait(m => m.t === 'error');
  check('提示超过 3 次被拒绝', /提示次数/.test(over.msg));

  // ---------- 协作房 ----------
  A.send({ t: 'room_create', length: 'mid', vocab: 'plus', mode: 'symbol', name: '测试甲' });
  const w = await A.wait(m => m.t === 'welcome');
  check('创建协作房', /^\d{4}$/.test(w.code) && w.words.length > 0);
  check('房间带谜底(测试模式)', !!w.solution);

  const B = new Client('B');
  await B.ready;
  B.send({ t: 'room_join', code: w.code, name: '测试乙' });
  const wb = await B.wait(m => m.t === 'welcome');
  check('第二人加入房间', wb.code === w.code);
  const both = await A.wait(m => m.t === 'room' && m.players.length === 2);
  check('房主看到 2 名成员', both.players.length === 2);

  // B 填一个字母 → A 应收到同步
  const solR = w.solution;
  const firstC = Object.keys(solR)[0];
  B.send({ t: 'room_guess', code: w.code, c: firstC, p: solR[firstC] });
  const sync = await A.wait(m => m.t === 'room' && m.guesses && m.guesses[firstC] === solR[firstC]);
  check('协作译码实时同步', !!sync);

  // 聊天
  B.send({ t: 'room_chat', code: w.code, msg: '这个符号像 E' });
  const chat = await A.wait(m => m.t === 'chat');
  check('房间聊天广播', chat.msg === '这个符号像 E' && typeof chat.from === 'string');

  // A 补完剩余字母 → 双人都收到 solved
  const solvedRoom = B.wait(m => m.t === 'solved', 8000, 'room solved');
  for (const c of Object.keys(solR)) {
    if (c === firstC) continue;
    A.send({ t: 'room_guess', code: w.code, c, p: solR[c] });
    await sleep(15);
  }
  const rs = await solvedRoom;
  check('协作破译成功广播给队友', !!rs.sentence);
  check('结算带成员名单', Array.isArray(rs.players) && rs.players.length === 2);

  // 离房
  B.send({ t: 'room_leave', code: w.code });
  const bye = await B.wait(m => m.t === 'bye');
  check('离开房间', bye.code === w.code);
  const left = await A.wait(m => m.t === 'room' && m.players.length === 1);
  check('房主看到成员减少', left.players.length === 1);

  // ---------- 异常 ----------
  B.send({ t: 'room_join', code: '0000', name: '测试乙' });
  const err = await B.wait(m => m.t === 'error');
  check('加入不存在的房间报错', /不存在|过期/.test(err.msg));

  // ---------- 战绩接口 ----------
  const res = await fetch('http://127.0.0.1:3012/api/history').then(r => r.json());
  check('战绩接口可访问', Array.isArray(res.recent) && res.recent.length >= 3);

  A.close(); B.close();
  console.log(failures ? `\n有 ${failures} 项失败` : '\n全部通过');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
