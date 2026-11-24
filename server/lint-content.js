'use strict';
// 语料质检: 把所有场景/名言逐句扫一遍, 标出可疑项供人工判断
// 用法: node server/lint-content.js [--dump]
const P = require('./puzzles.js');

const PRONOUN_START = /^(HE|SHE|THEY|HIS|HER|THEIR|THEM|IT|ITS|HIM)\b/;
const issues = [];
const rows = [];

function checkSentence(s, where) {
  const letters = (s.match(/[A-Z]/g) || []).length;
  const words = s.split(/\s+/);
  const add = (sev, msg) => issues.push({ sev, where, text: s, msg });

  if (!/^[A-Z]/.test(s)) add('ERR', '不是大写字母开头');
  if (!/[.!?]$/.test(s)) add('ERR', '结尾没有标点');
  if (/  /.test(s)) add('ERR', '有连续空格');
  if (/[^A-Z0-9 ,.!?;:'"()-]/.test(s)) add('ERR', '含非法字符');
  if (letters < 5) add('ERR', `太短(${letters} 字母)`);
  if (!where.startsWith('quote/') && letters > 70) add('WARN', `单句偏长(${letters} 字母)`);
  if (!where.startsWith('quote/') && words.length === 1 && letters > 4) add('WARN', '只有一个词');
  if (!/[A-Z]{2}/.test(s)) add('ERR', '没有完整单词');

  const distinct = new Set(s.match(/[A-Z]/g) || []).size;
  if (distinct < 4) add('WARN', `字母种类太少(${distinct} 种)`);

  // 重复词: 同一个词连续出现两次以上 (THE THE / AND AND)
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[^A-Z]/g, '');
    const prev = words[i - 1].replace(/[^A-Z]/g, '');
    if (w && prev && w === prev) add('ERR', `连续重复词 ${w}`);
  }

  // 代词开头: 单独一句没问题, 但连续片段里若是第二句起头可能悬空
  if (PRONOUN_START.test(s)) add('INFO', '以代词开头(检查是否有先行词)');

  rows.push({ where, letters, words: words.length, distinct, text: s });
}

// ---- 场景 ----
let sceneCount = 0, lineCount = 0;
for (const [vocab, list] of Object.entries(P.SCENES)) {
  for (const sc of list) {
    sceneCount++;
    if (sc.lines.length !== 8) issues.push({ sev: 'ERR', where: `${vocab}/${sc.id}`, text: '', msg: `句数 ${sc.lines.length}, 应为 8` });
    if (!sc.title) issues.push({ sev: 'WARN', where: `${vocab}/${sc.id}`, text: '', msg: '缺标题' });
    const bf = (P.BRIEFS || {})[sc.id];
    if (!bf || !bf.brief) issues.push({ sev: 'ERR', where: `${vocab}/${sc.id}`, text: '', msg: '缺案情简报' });
    if (!bf || !bf.truth) issues.push({ sev: 'ERR', where: `${vocab}/${sc.id}`, text: '', msg: '缺结案报告' });
    if (bf && bf.brief && bf.brief.length < 25) issues.push({ sev: 'WARN', where: `${vocab}/${sc.id}`, text: '', msg: '案情过短' });
    sc.lines.forEach((s, i) => { lineCount++; checkSentence(s, `${vocab}/${sc.id}#${i + 1}`); });
  }
}

// ---- 名言 ----
let quoteCount = 0;
for (const [len, byVocab] of Object.entries(P.QUOTES)) {
  for (const [vocab, list] of Object.entries(byVocab)) {
    list.forEach((q, i) => {
      quoteCount++;
      checkSentence(q.text, `quote/${len}/${vocab}#${i + 1}`);
      if (!q.cite) issues.push({ sev: 'WARN', where: `quote/${len}/${vocab}#${i + 1}`, text: q.text, msg: '缺出处' });
      const n = (q.text.match(/[A-Z]/g) || []).length;
      const cfg = P.LENGTHS[len];
      if (n < cfg.min || n > cfg.max) {
        issues.push({ sev: 'WARN', where: `quote/${len}/${vocab}#${i + 1}`, text: q.text, msg: `长度 ${n} 不在 ${cfg.min}-${cfg.max}` });
      }
    });
  }
}

// ---- 报告 ----
console.log('================ 语料统计 ================');
console.log(`场景 ${sceneCount} 段 / ${lineCount} 句   名言 ${quoteCount} 条`);
for (const [k, cfg] of Object.entries(P.LENGTHS)) {
  const cfgLen = rows.filter(r => r.where.includes('/' + k + '/'));
  console.log(`  ${k}: ${cfg.min}-${cfg.max} 字母 / ${cfg.sentences} 句`);
}

// 场景长度分布
const byScene = new Map();
for (const r of rows) {
  if (r.where.startsWith('quote/')) continue;
  const k = r.where.split('#')[0];
  if (!byScene.has(k)) byScene.set(k, []);
  byScene.get(k).push(r);
}
const bad = [];
for (const [k, rs] of byScene) {
  const total = rs.reduce((a, b) => a + b.letters, 0);
  const nMin = rs[0].letters + rs[1].letters + rs[2].letters;
  const nLong = rs.slice(0, 6).reduce((a, b) => a + b.letters, 0);
  const tag = [];
  if (nLong < P.LENGTHS.long.min) tag.push(`长文偏短(${nLong})`);
  if (nLong > P.LENGTHS.long.max) tag.push(`长文偏长(${nLong})`);
  if (nMin < P.LENGTHS.mid.min) tag.push(`中篇偏短(${nMin})`);
  if (tag.length) bad.push(`${k}: ${tag.join(', ')}`);
}
if (bad.length) {
  console.log('\n-- 场景长度越界 --');
  bad.forEach(x => console.log('  ' + x));
}

const ERR = issues.filter(i => i.sev === 'ERR');
const WARN = issues.filter(i => i.sev === 'WARN');
const INFO = issues.filter(i => i.sev === 'INFO');

console.log('\n================ 问题 ================');
console.log(`错误 ${ERR.length} / 警告 ${WARN.length} / 提示 ${INFO.length}`);
const show = (list, name) => {
  if (!list.length) return;
  console.log(`\n-- ${name} --`);
  list.forEach(i => console.log(`[${i.sev}] ${i.where}: ${i.msg}${i.text ? '  → ' + i.text : ''}`));
};
show(ERR, '错误(必须修)');
show(WARN, '警告(建议看)');
if (process.argv.includes('--dump')) {
  console.log('\n-- 以代词开头的句子(确认先行词) --');
  INFO.forEach(i => console.log(`  ${i.where}: ${i.text}`));
  console.log('\n================ 全量语料 ================');
  for (const r of rows) console.log(`${r.where} (${r.letters}字母/${r.words}词/${r.distinct}种)\n  ${r.text}`);
}

process.exitCode = ERR.length ? 1 : 0;
