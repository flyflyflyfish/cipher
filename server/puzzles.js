'use strict';
// 果果密语 · 出题引擎
// 难度 = 句子长度 × 词汇等级
//   长度: 长句(线索多, 易) / 中句 / 短句(线索少, 难)
//   词汇: 日常词 / 进阶词 / 六级词(生僻, 难)
// 句子由系统随机生成 (语法安全的模板 + 分层词库), 再随机双射替换加密。
const crypto = require('crypto');

// 句子长度档位 (字母数, 不含空格标点)
const LENGTHS = {
  short: { label: '短句 · 一小句', min: 12, max: 26, parts: 1 },
  mid: { label: '中篇 · 两三句', min: 45, max: 95, parts: 3 },
  long: { label: '长文 · 一整篇', min: 150, max: 300, parts: 6 },
};

// 词汇等级
const VOCABS = {
  basic: { label: '日常词', hint: '常见单词, 好认' },
  plus: { label: '进阶词', hint: '稍有难度' },
  cet6: { label: '六级词', hint: '生僻词, 烧脑' },
};

// ---------------- 分层词库 ----------------
const BANK = {
  basic: {
    PERSONS: ['THE OLD MAN', 'MY SISTER', 'MY FRIEND', 'THE BAKER', 'THE BOY', 'THE GIRL',
      'MY UNCLE', 'MY TEACHER', 'THE DOCTOR', 'THE FARMER'],
    PERSON_N: ['MAN', 'WOMAN', 'BOY', 'GIRL', 'FARMER', 'TEACHER', 'DOCTOR', 'BAKER'],
    RELS: ['SISTER', 'BROTHER', 'UNCLE', 'AUNT', 'FRIEND', 'TEACHER', 'NEIGHBOR'],
    PLACES: ['GARDEN', 'MARKET', 'SCHOOL', 'PARK', 'STATION', 'LIBRARY', 'KITCHEN',
      'BEACH', 'HOTEL', 'FARM', 'SHOP', 'HOME'],
    ADJS: ['HAPPY', 'NICE', 'OLD', 'SMALL', 'BIG', 'BRIGHT', 'QUIET', 'WARM', 'COLD',
      'NEW', 'GOOD', 'LATE'],
    OBJS: ['KEY', 'MAP', 'BOOK', 'BOX', 'RING', 'LETTER', 'BAG', 'CUP', 'PHOTO', 'TOY'],
    VERB3: ['WALKS', 'LOOKS', 'WAITS', 'LISTENS', 'RUNS', 'SITS', 'SINGS', 'SMILES'],
    VERB1: ['FIND', 'OPEN', 'CARRY', 'CLEAN', 'READ', 'HIDE', 'COUNT', 'TAKE'],
    VERB1B: ['FIND', 'SEE', 'GET', 'OPEN'],
    ADVS: ['SLOWLY', 'QUICKLY', 'ALWAYS', 'NEVER', 'OFTEN', 'EARLY', 'LATE', 'GENTLY'],
  },
  plus: {
    PERSONS: ['THE WATCHMAN', 'THE PORTER', 'MY COUSIN', 'THE PHOTOGRAPHER', 'THE CLERK',
      'THE SAILOR', 'MY NEIGHBOR', 'THE MUSICIAN', 'THE STRANGER', 'MY GRANDFATHER'],
    PERSON_N: ['WATCHMAN', 'PORTER', 'SAILOR', 'CLERK', 'MUSICIAN', 'PAINTER', 'GARDENER',
      'FISHERMAN'],
    RELS: ['COUSIN', 'NEPHEW', 'NIECE', 'COLLEAGUE', 'CLASSMATE', 'NEIGHBOR'],
    PLACES: ['HARBOR', 'STATION', 'ORCHARD', 'BAKERY', 'LIGHTHOUSE', 'MARKET', 'MUSEUM',
      'COTTAGE', 'BRIDGE', 'TEMPLE', 'RAILWAY', 'CASTLE'],
    ADJS: ['DUSTY', 'RUSTY', 'GOLDEN', 'HIDDEN', 'SECRET', 'GENTLE', 'CLEVER', 'SILENT',
      'WINDY', 'CURIOUS', 'ANCIENT', 'LONELY'],
    OBJS: ['PACKAGE', 'LANTERN', 'PHOTO', 'NOTEBOOK', 'MIRROR', 'LETTER', 'WATCH', 'RING',
      'COMPASS', 'ENVELOPE'],
    VERB3: ['SEARCHES', 'GUARDS', 'FOLLOWS', 'CARRIES', 'COUNTS', 'OPENS', 'HIDES', 'READS',
      'NOTICES', 'WHISPERS'],
    VERB1: ['SEARCH', 'GUARD', 'FOLLOW', 'CARRY', 'COUNT', 'OPEN', 'HIDE', 'READ',
      'NOTICE', 'EXAMINE'],
    VERB1B: ['FIND', 'DISCOVER', 'NOTICE', 'OPEN'],
    ADVS: ['SLOWLY', 'QUIETLY', 'CAREFULLY', 'SUDDENLY', 'GENTLY', 'EARLY', 'LATE', 'OFTEN'],
  },
  cet6: {
    PERSONS: ['THE ARCHIVIST', 'THE CURATOR', 'THE SCHOLAR', 'THE INSPECTOR', 'MY COLLEAGUE',
      'THE LIBRARIAN', 'THE ANTIQUARIAN', 'THE ENVOY', 'THE ORNITHOLOGIST'],
    PERSON_N: ['ARCHIVIST', 'CURATOR', 'SCHOLAR', 'INSPECTOR', 'LIBRARIAN', 'ANTIQUARIAN',
      'JOURNALIST', 'BOTANIST'],
    RELS: ['COLLEAGUE', 'MENTOR', 'ASSOCIATE', 'ACQUAINTANCE', 'SUPERVISOR'],
    PLACES: ['ARCHIVE', 'CORRIDOR', 'ATRIUM', 'TERRACE', 'MANOR', 'CHAPEL', 'OBSERVATORY',
      'DEPOT', 'CONSERVATORY', 'SANCTUARY'],
    ADJS: ['INTRICATE', 'SUBTLE', 'GLOOMY', 'VAGUE', 'ABUNDANT', 'HESITANT', 'SUSPICIOUS',
      'ELEGANT', 'TEDIOUS', 'PECULIAR', 'TRANQUIL', 'VIVID', 'OBSOLETE', 'METICULOUS'],
    OBJS: ['MANUSCRIPT', 'PENDANT', 'ENVELOPE', 'CERAMIC', 'COMPASS', 'TRANSCRIPT', 'LEDGER',
      'EMBLEM', 'DOCUMENT', 'PORTRAIT'],
    VERB3: ['SCRUTINIZES', 'CONCEALS', 'RETRIEVES', 'INSPECTS', 'EXAMINES', 'TRACES',
      'NOTICES', 'UNCOVERS', 'PONDERS'],
    VERB1: ['SCRUTINIZE', 'CONCEAL', 'RETRIEVE', 'INSPECT', 'EXAMINE', 'TRACE', 'UNCOVER',
      'DECIPHER', 'CONTEMPLATE'],
    VERB1B: ['RETRIEVE', 'UNCOVER', 'DISCERN', 'DECIPHER'],
    ADVS: ['SUBTLY', 'RELUCTANTLY', 'DELIBERATELY', 'GRADUALLY', 'CURIOUSLY', 'SILENTLY',
      'CAUTIOUSLY', 'METICULOUSLY'],
  },
};

// 共享词
const TIMES = ['MORNING', 'EVENING', 'NIGHT', 'AFTERNOON', 'SUNDAY', 'MONDAY', 'WINTER',
  'SUMMER', 'SPRING', 'AUTUMN', 'WEEKEND'];
const CONNS = ['BUT', 'AND', 'BECAUSE', 'WHILE', 'UNTIL', 'ALTHOUGH'];
const DAYS = ['SUNDAY', 'MONDAY', 'FRIDAY', 'SATURDAY'];

const pick = a => a[Math.floor(Math.random() * a.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- 句子模板 ----------------
// 全部语法安全: 主语可数单数 → 动词三单; 及物动词带宾语
function templates(B) {
  const P = k => B[k];
  return [
    () => `${pick(P('PERSONS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))} NEAR THE ${pick(P('PLACES'))}`,
    () => `MY ${pick(P('RELS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))} EVERY ${pick(TIMES)}`,
    () => `${pick(P('PERSONS'))} AND I ${pick(P('VERB1'))} TO THE ${pick(P('PLACES'))} ON ${pick(DAYS)}`,
    () => `NOBODY KNOWS WHY ${pick(P('PERSONS'))} ${pick(P('VERB3'))} SO ${pick(P('ADVS'))}`,
    () => `IF YOU ${pick(P('VERB1'))} THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} YOU WILL ${pick(P('VERB1B'))} A ${pick(P('OBJS'))}`,
    () => `SHE SAID THAT THE ${pick(P('OBJS'))} WAS ${pick(P('ADJS'))}, BUT I DID NOT BELIEVE HER`,
    () => `WE ${pick(P('VERB1'))} THE ${pick(P('OBJS'))} ${pick(P('ADVS'))} ${pick(CONNS)} IT WAS ${pick(P('ADJS'))}`,
    () => `THE OLD ${pick(P('PERSON_N'))} TOLD US A ${pick(P('ADJS'))} STORY ABOUT THE ${pick(P('PLACES'))}`,
    () => `EVERY ${pick(TIMES)} I ${pick(P('VERB1'))} THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} WITH MY ${pick(P('RELS'))}`,
    () => `IT IS NOT EASY TO ${pick(P('VERB1'))} A ${pick(P('ADJS'))} ${pick(P('OBJS'))} BEFORE ${pick(TIMES)}`,
    () => `THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} WAS HIDDEN ${pick(P('ADVS'))} IN THE ${pick(P('PLACES'))}`,
    () => `I ${pick(P('VERB1'))} THE ${pick(P('OBJS'))} ${pick(P('ADVS'))} ${pick(CONNS)} THE ${pick(P('PLACES'))} WAS ${pick(P('ADJS'))}`,
    // 长句
    () => `${pick(P('PERSONS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))} THROUGH THE ${pick(P('ADJS'))} ${pick(P('PLACES'))}, AND NOBODY SAID A WORD`,
    () => `WHEN THE ${pick(P('ADJS'))} ${pick(P('PLACES'))} WAS ${pick(P('ADJS'))}, ${pick(P('PERSONS'))} ${pick(P('VERB3'))} WITH A ${pick(P('ADJS'))} ${pick(P('OBJS'))}`,
    () => `I ${pick(P('VERB1'))} THAT THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} WAS HIDDEN IN THE ${pick(P('ADJS'))} ${pick(P('PLACES'))}, BUT I SAID NOTHING`,
    () => `EVERY ${pick(TIMES)} ${pick(P('PERSONS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))} BY THE ${pick(P('PLACES'))}, AND THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} WAS STILL THERE`,
    // 短句
    () => `${pick(P('PERSONS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))}`,
    () => `THE ${pick(P('ADJS'))} ${pick(P('OBJS'))} IS ${pick(P('ADJS'))}`,
    () => `I ${pick(P('VERB1'))} THE ${pick(P('OBJS'))}`,
    () => `WHERE IS THE ${pick(P('ADJS'))} ${pick(P('OBJS'))}`,
    () => `THE ${pick(P('PLACES'))} WAS ${pick(P('ADJS'))} AND ${pick(P('ADJS'))}`,
    () => `${pick(P('PERSONS'))} ${pick(P('VERB3'))} ${pick(P('ADVS'))} TODAY`,
  ];
}

const letterCount = s => (s.match(/[A-Z]/g) || []).length;

// 生成落在长度区间内的随机句子; 多试几次, 极端情况取最接近的
function randomSentence(lengthKey, vocabKey) {
  const cfg = LENGTHS[lengthKey] || LENGTHS.mid;
  const B = BANK[vocabKey] || BANK.basic;
  const T = templates(B);
  let best = null, bestGap = Infinity;

  for (let attempt = 0; attempt < 400; attempt++) {
    const parts = [];
    let letters = 0;
    for (let i = 0; i < cfg.parts; i++) {
      let s = pick(T)() + (Math.random() < 0.07 ? '?' : '.');
      let guard = 0;
      while (parts.length && s === parts[parts.length - 1] && guard++ < 8) s = pick(T)() + '.';
      parts.push(s);
      letters += letterCount(s);
      if (cfg.parts === 1) break;
    }
    const text = parts.join(' ');
    const n = letterCount(text);
    if (n >= cfg.min && n <= cfg.max) return text;
    const gap = n < cfg.min ? cfg.min - n : n - cfg.max;
    if (gap < bestGap) { bestGap = gap; best = text; }
  }
  return best;
}

// ---------------- 加密 ----------------
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function makePuzzle(opts) {
  const o = opts || {};
  const lengthKey = LENGTHS[o.length] ? o.length : 'mid';
  const vocabKey = VOCABS[o.vocab] ? o.vocab : 'basic';
  const sentence = randomSentence(lengthKey, vocabKey);

  // 随机双射: 明文字母 -> 密文字母
  const cipherOf = shuffle(ALPHA.slice());
  const enc = {}, sol = {};
  ALPHA.forEach((p, i) => { enc[p] = cipherOf[i]; sol[cipherOf[i]] = p; });

  // 加密: 非字母原样保留
  const tokens = sentence.split(' ').map(w => w.split('').map(ch => enc[ch] || ch));

  // 频次统计 (推理的核心线索)
  const freq = {};
  for (const w of tokens) for (const ch of w) if (/^[A-Z]$/.test(ch)) freq[ch] = (freq[ch] || 0) + 1;
  const uniqueCipher = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);

  return {
    id: crypto.randomBytes(8).toString('hex'),
    sentence,
    tokens,
    freq,
    uniqueCipher,
    solution: sol,
    length: lengthKey,
    vocab: vocabKey,
    letters: letterCount(sentence),
    createdAt: Date.now(),
  };
}

module.exports = { LENGTHS, VOCABS, makePuzzle, randomSentence, letterCount };
