'use strict';
// 果果密语 · 出题引擎 v2
// ---------------------------------------------------------------
// 难度 = 篇幅 × 词汇等级, 另有「题目来源」: 随机小故事 / 名言名篇 / 好友出题
//
// v2 的关键改动: 不再用「词槽独立随机填充」(那会产出
// "WHERE IS THE WARM LETTER" 这种语法对、语义荒谬的句子), 而是:
//   每个场景 = 一段 8 句的连贯微型故事 (人手写, 语义自洽)
//   出题时随机抽场景 + 随机取连续片段 → 每局不同, 且必定读得通
// ---------------------------------------------------------------
const crypto = require('crypto');

// 篇幅档位 (字母数, 不含空格标点)
const LENGTHS = {
  short: { label: '短句 · 一小句', min: 10, max: 48, sentences: 1 },
  mid: { label: '中篇 · 两三句', min: 40, max: 140, sentences: 3 },
  long: { label: '长文 · 一整篇', min: 130, max: 330, sentences: 6 },
};

// 词汇等级
const VOCABS = {
  basic: { label: '日常词', hint: '常见单词, 好认' },
  plus: { label: '进阶词', hint: '稍有难度' },
  cet6: { label: '六级词', hint: '生僻词, 烧脑' },
};

// ---------------- 场景库 ----------------
// 每个场景是一段有起承转合的微型故事 (8 句), 抽连续片段即成文
const SCENES = {
  basic: [
    {
      id: 'bakery', title: '面包店的清晨',
      lines: [
        'THE OLD BAKER OPENS THE SHOP AT SIX.',
        'THE OVEN IS STILL WARM FROM THE NIGHT.',
        'HE PUTS THE FRESH BREAD ON THE WOODEN SHELF.',
        'THE SMELL OF BUTTER FILLS THE SMALL STREET.',
        'MY SISTER BUYS A LOAF EVERY MORNING.',
        'SHE SAYS IT IS THE BEST BREAD IN TOWN.',
        'THE BAKER ONLY SMILES AND SAYS NOTHING.',
        'BY NOON THE SHELF IS ALREADY EMPTY.',
      ],
    },
    {
      id: 'garden', title: '邻居的花园',
      lines: [
        'MY NEIGHBOR WATERS THE ROSES EVERY EVENING.',
        'THE SOIL IS DARK AND THE LEAVES ARE WET.',
        'SHE TALKS TO THE FLOWERS IN A LOW VOICE.',
        'NOBODY KNOWS WHY THE ROSES GROW SO WELL.',
        'LAST SPRING A SMALL BIRD BUILT A NEST IN THE HEDGE.',
        'THE BIRD CAME BACK AGAIN THIS YEAR.',
        'NOW THE GARDEN IS FULL OF QUIET SOUNDS.',
        'I OFTEN SIT BY THE FENCE AND LISTEN.',
      ],
    },
    {
      id: 'library', title: '图书馆的下午',
      lines: [
        'THE LIBRARY IS QUIET IN THE AFTERNOON.',
        'A STUDENT READS AN OLD BOOK BY THE WINDOW.',
        'THE PAGES ARE YELLOW AND THE INK IS FADED.',
        'SHE WRITES A NOTE IN HER SMALL BOOK.',
        'THE LIBRARIAN WALKS BETWEEN THE TALL SHELVES.',
        'HE FINDS A MAP INSIDE A BROKEN COVER.',
        'THE MAP SHOWS A ROAD THAT NOBODY USES.',
        'THE STUDENT LOOKS AT IT FOR A LONG TIME.',
      ],
    },
    {
      id: 'station', title: '晚点的火车',
      lines: [
        'THE TRAIN ARRIVES AT THE STATION LATE.',
        'AN OLD MAN WAITS WITH A BROWN BAG.',
        'HE ASKS THE CLERK FOR THE NEXT TRAIN.',
        'THE CLERK SAYS THERE IS ONLY ONE.',
        'THE MAN SITS DOWN AND OPENS HIS BAG.',
        'INSIDE THE BAG THERE IS A LETTER AND A SMALL KEY.',
        'HE READS THE LETTER TWICE AND SAYS NOTHING.',
        'THE TRAIN LEAVES AND HE IS STILL THERE.',
      ],
    },
    {
      id: 'kitchen', title: '周日的厨房',
      lines: [
        'MY BROTHER COOKS SOUP ON SUNDAY.',
        'HE CUTS THE ONIONS AND THE CARROTS SLOWLY.',
        'THE KITCHEN IS FULL OF STEAM AND NOISE.',
        'HE ADDS SALT AND THEN A LITTLE SUGAR.',
        'MY MOTHER SAYS THE SOUP IS TOO HOT.',
        'WE EAT IT ANYWAY AND NOBODY COMPLAINS.',
        'AFTER DINNER HE WASHES EVERY CUP.',
        'THEN HE SITS BY THE WINDOW AND RESTS.',
      ],
    },
    {
      id: 'rain', title: '下雨的窗',
      lines: [
        'IT RAINS ALL DAY AND THE STREET IS EMPTY.',
        'THE BOY WATCHES THE WATER ON THE GLASS.',
        'HIS FRIEND CALLS BUT HE DOES NOT ANSWER.',
        'HE TAKES A PENCIL AND DRAWS A SMALL BOAT.',
        'THE BOAT FLOATS DOWN THE PAPER RIVER.',
        'IN THE EVENING THE RAIN STOPS.',
        'THE STREET IS CLEAN AND THE AIR IS COLD.',
        'THE BOY OPENS THE WINDOW AND SMILES.',
      ],
    },
  ],

  plus: [
    {
      id: 'harbor', title: '黎明前的港口',
      lines: [
        'THE FISHERMAN LEAVES THE HARBOR BEFORE DAWN.',
        'HIS BOAT IS OLD BUT THE ENGINE IS NEW.',
        'THE WATER IS SILENT AND THE SKY IS GREY.',
        'HE COUNTS THE NETS AND CHECKS THE ROPE.',
        'BY NOON THE BOAT RETURNS WITH A SMALL CATCH.',
        'THE PORTER HELPS HIM CARRY THE HEAVY BOXES.',
        'THEY TALK ABOUT THE WIND AND THE WEATHER.',
        'TOMORROW HE WILL GO OUT AGAIN.',
      ],
    },
    {
      id: 'lighthouse', title: '灯塔守夜人',
      lines: [
        'THE WATCHMAN CLIMBS THE STAIRS EVERY NIGHT.',
        'THE LAMP TURNS SLOWLY ABOVE THE SEA.',
        'HE WRITES THE TIME IN A HEAVY LEDGER.',
        'NOTHING HAPPENS ON MOST NIGHTS.',
        'TONIGHT A SHIP WAITS NEAR THE ROCKS.',
        'THE WATCHMAN SEES IT AND LIGHTS THE FIRE.',
        'THE SHIP TURNS AWAY AND DISAPPEARS.',
        'IN THE MORNING HE FINDS A BROKEN BOAT.',
      ],
    },
    {
      id: 'museum', title: '博物馆的速写本',
      lines: [
        'THE CLERK OPENS THE MUSEUM AT NINE.',
        'THE ROOMS ARE COLD AND THE WINDOWS ARE DIRTY.',
        'A VISITOR ASKS ABOUT THE OLD PAINTING.',
        'NOBODY KNOWS WHO PAINTED IT.',
        'THE CLERK SHOWS HER A DUSTY NOTEBOOK.',
        'THE NOTEBOOK BELONGS TO A SAILOR.',
        'INSIDE THERE IS A SKETCH OF THE SAME FACE.',
        'THE VISITOR LOOKS AT IT AND SAYS NOTHING.',
      ],
    },
    {
      id: 'cottage', title: '河边的小屋',
      lines: [
        'MY COUSIN LIVES IN A SMALL COTTAGE.',
        'THE ROOF IS LOW AND THE GARDEN IS WIDE.',
        'SHE GROWS HERBS AND KEEPS TWO HENS.',
        'EVERY MORNING SHE WALKS TO THE BRIDGE.',
        'THE RIVER BELOW IS COLD AND CLEAR.',
        'SHE THROWS BREAD TO THE FISH.',
        'THEN SHE SITS ON THE STONE AND WAITS.',
        'NOBODY KNOWS WHAT SHE IS WAITING FOR.',
      ],
    },
    {
      id: 'orchard', title: '果园的收成',
      lines: [
        'THE FARMER WALKS THROUGH THE ORCHARD AT DAWN.',
        'THE TREES ARE OLD AND THE BRANCHES ARE LOW.',
        'HE PICKS THE APPLES AND PUTS THEM IN A BASKET.',
        'THE AIR SMELLS OF GRASS AND RAIN.',
        'HIS SON CARRIES THE BASKET TO THE BARN.',
        'THEY COUNT THE APPLES AND WRITE THE NUMBER.',
        'THIS YEAR THE HARVEST IS SMALL.',
        'STILL, THE FARMER SAYS IT IS ENOUGH.',
      ],
    },
    {
      id: 'railway', title: '山谷里的车站',
      lines: [
        'THE RAILWAY CROSSES THE VALLEY IN A LONG CURVE.',
        'AN OLD STATION STANDS BESIDE THE BRIDGE.',
        'THE STATION MASTER WAITS ON THE EMPTY PLATFORM.',
        'HE HOLDS A WATCH AND A SMALL FLAG.',
        'THE TRAIN IS ALREADY TWENTY MINUTES LATE.',
        'A PORTER SWEEPS THE FLOOR AND SAYS NOTHING.',
        'FINALLY A LIGHT APPEARS BEYOND THE HILL.',
        'THE MASTER RAISES HIS FLAG AND SMILES.',
      ],
    },
  ],

  cet6: [
    {
      id: 'archive', title: '档案馆的封蜡信封',
      lines: [
        'THE ARCHIVIST UNLOCKS THE ARCHIVE AT DAWN.',
        'THE AIR IS DRY AND THE SHELVES ARE DUSTY.',
        'SHE EXAMINES A LEDGER FROM THE LAST CENTURY.',
        'THE INK IS FADED BUT THE NUMBERS REMAIN CLEAR.',
        'A SINGLE NAME APPEARS ON EVERY PAGE.',
        'THE ARCHIVIST TRACES IT WITH HER FINGER.',
        'SHE RETRIEVES A SEALED ENVELOPE FROM THE BOX.',
        'INSIDE THERE IS A MANUSCRIPT NOBODY HAS READ.',
      ],
    },
    {
      id: 'observatory', title: '天文台的异光',
      lines: [
        'THE SCHOLAR CLIMBS TO THE OBSERVATORY AT NIGHT.',
        'THE DOME IS COLD AND THE STAIRS ARE STEEP.',
        'HE ADJUSTS THE LENS AND WAITS FOR THE SKY.',
        'THE STARS ARE FAINT AND THE WIND IS RISING.',
        'A PECULIAR LIGHT APPEARS IN THE EAST.',
        'HE RECORDS THE POSITION IN A LEDGER.',
        'THE LIGHT MOVES SLOWLY AND THEN STOPS.',
        'IN THE MORNING THE SKY IS EMPTY AGAIN.',
      ],
    },
    {
      id: 'manor', title: '黄昏的庄园',
      lines: [
        'THE ENVOY ARRIVES AT THE MANOR AT DUSK.',
        'THE CORRIDOR IS LONG AND THE LAMPS ARE DIM.',
        'A SERVANT TAKES HIS COAT AND SAYS NOTHING.',
        'THE ENVOY WAITS IN THE ATRIUM FOR AN HOUR.',
        'FINALLY A DOOR OPENS AT THE END OF THE HALL.',
        'AN OLD SCHOLAR GREETS HIM WITH A VAGUE SMILE.',
        'THEY SPEAK ABOUT A DOCUMENT AND A SEAL.',
        'NEITHER MAN MENTIONS THE LETTER.',
      ],
    },
    {
      id: 'conservatory', title: '温室里的标本',
      lines: [
        'THE BOTANIST WORKS IN THE CONSERVATORY ALL DAY.',
        'THE GLASS ROOF IS FOGGED AND THE AIR IS HUMID.',
        'SHE EXAMINES THE LEAVES OF A RARE PLANT.',
        'THE FLOWERS ARE PALE AND THE STEMS ARE THIN.',
        'A JOURNAL LIES OPEN ON THE WOODEN TABLE.',
        'EVERY PAGE CONTAINS A CAREFUL SKETCH.',
        'THE LAST SKETCH SHOWS A PLANT NOBODY RECOGNIZES.',
        'SHE CLOSES THE JOURNAL AND LOCKS THE DOOR.',
      ],
    },
    {
      id: 'chapel', title: '村口的礼拜堂',
      lines: [
        'THE CHAPEL STANDS ALONE AT THE EDGE OF THE VILLAGE.',
        'ITS WALLS ARE OLD AND ITS WINDOWS ARE NARROW.',
        'A SINGLE CANDLE BURNS BESIDE THE DOOR.',
        'THE INSPECTOR ENTERS AND REMOVES HIS HAT.',
        'HE EXAMINES THE STONE FLOOR WITH CARE.',
        'A FAINT MARK APPEARS BENEATH THE DUST.',
        'IT IS THE SAME EMBLEM FROM THE LETTER.',
        'HE LEAVES THE CHAPEL WITHOUT A WORD.',
      ],
    },
    {
      id: 'studio', title: '画室的最后一幅',
      lines: [
        'THE PAINTER HAS WORKED IN THE STUDIO SINCE SPRING.',
        'THE CURATOR VISITS HIM ON A RAINY AFTERNOON.',
        'THE ROOM IS FILLED WITH UNFINISHED PORTRAITS.',
        'ONLY ONE CANVAS IS TURNED TOWARD THE WALL.',
        'THE PAINTER REFUSES TO EXPLAIN WHY.',
        'THE CURATOR ASKS ABOUT THE SUBTLE SIGNATURE.',
        'IT MATCHES A NAME FROM AN OLD LEDGER.',
        'THE PAINTER SETS DOWN HIS BRUSH AND SAYS NOTHING.',
      ],
    },
  ],
};

// ---------------- 名言名篇库 ----------------
// 按篇幅 × 词汇分档; cite 用于破译成功后显示出处
const QUOTES = {
  short: {
    basic: [
      { text: 'A JOURNEY OF A THOUSAND MILES BEGINS WITH A SINGLE STEP.', cite: '老子' },
      { text: 'EVERY CLOUD HAS A SILVER LINING.', cite: '英语谚语' },
      { text: 'ACTIONS SPEAK LOUDER THAN WORDS.', cite: '英语谚语' },
      { text: 'THE EARLY BIRD CATCHES THE WORM.', cite: '英语谚语' },
      { text: 'WHERE THERE IS A WILL, THERE IS A WAY.', cite: '英语谚语' },
      { text: 'STILL WATERS RUN DEEP.', cite: '英语谚语' },
      { text: 'PRACTICE MAKES PERFECT.', cite: '英语谚语' },
      { text: 'A FRIEND IN NEED IS A FRIEND INDEED.', cite: '英语谚语' },
    ],
    plus: [
      { text: 'THE ONLY THING WE HAVE TO FEAR IS FEAR ITSELF.', cite: '罗斯福' },
      { text: 'NOT ALL THOSE WHO WANDER ARE LOST.', cite: '托尔金' },
      { text: 'THE UNEXAMINED LIFE IS NOT WORTH LIVING.', cite: '苏格拉底' },
      { text: 'CURIOSITY IS THE WICK IN THE CANDLE OF LEARNING.', cite: '威廉·沃德' },
      { text: 'WE ARE WHAT WE REPEATEDLY DO.', cite: '亚里士多德(传)' },
      { text: 'KNOWLEDGE SPEAKS, BUT WISDOM LISTENS.', cite: '吉姆·亨德里克斯' },
    ],
    cet6: [
      { text: 'NOTHING ENDURES BUT CHANGE.', cite: '赫拉克利特' },
      { text: 'THE PAST IS NEVER DEAD. IT IS NOT EVEN PAST.', cite: '福克纳' },
      { text: 'TRUTH IS RARELY PURE AND NEVER SIMPLE.', cite: '王尔德' },
      { text: 'A PRECISE MIND IS A DANGEROUS INSTRUMENT.', cite: '福尔摩斯式箴言' },
    ],
  },
  mid: {
    basic: [
      { text: 'A FOX SAW SOME GRAPES HANGING FROM A HIGH VINE. HE JUMPED AGAIN AND AGAIN BUT COULD NOT REACH THEM. AT LAST HE WALKED AWAY AND SAID THE GRAPES WERE SOUR.', cite: '伊索 · 狐狸与葡萄' },
      { text: 'A HARE LAUGHED AT THE SLOW TORTOISE AND CHALLENGED HIM TO A RACE. THE HARE RAN FAST AND THEN SLEPT BESIDE THE ROAD. THE TORTOISE KEPT WALKING AND PASSED HIM AT THE END.', cite: '伊索 · 龟兔赛跑' },
      { text: 'A LION CAUGHT A MOUSE AND THE MOUSE BEGGED TO BE SET FREE. THE LION LAUGHED BUT LET HIM GO. LATER THE MOUSE CHEWED THROUGH THE ROPE THAT HELD THE LION.', cite: '伊索 · 狮子与老鼠' },
      { text: 'TWO FRIENDS WERE WALKING THROUGH A FOREST. A BEAR RAN AT THEM AND ONE CLIMBED A TREE. THE OTHER LAY STILL ON THE GROUND. THE BEAR SNIFFED HIM AND WALKED AWAY.', cite: '伊索 · 两个朋友与熊' },
    ],
    plus: [
      { text: 'WE SHALL FIGHT ON THE BEACHES, WE SHALL FIGHT ON THE LANDING GROUNDS. WE SHALL NEVER SURRENDER.', cite: '丘吉尔 · 1940' },
      { text: 'FOUR SCORE AND SEVEN YEARS AGO OUR FATHERS BROUGHT FORTH A NEW NATION. IT WAS CONCEIVED IN LIBERTY AND DEDICATED TO A PROPOSITION.', cite: '林肯 · 葛底斯堡演说' },
      { text: 'ASK NOT WHAT YOUR COUNTRY CAN DO FOR YOU. ASK WHAT YOU CAN DO FOR YOUR COUNTRY.', cite: '肯尼迪 · 就职演说' },
    ],
    cet6: [
      { text: 'THE GREATEST ENEMY OF KNOWLEDGE IS NOT IGNORANCE BUT THE ILLUSION OF KNOWLEDGE.', cite: '丹尼尔·布尔斯廷' },
      { text: 'THE PRECISE OBSERVATION OF THE OBVIOUS IS THE MOST NEGLECTED VIRTUE. MOST PEOPLE SEE, BUT FEW OBSERVE.', cite: '福尔摩斯式箴言' },
      { text: 'IT IS A TRUTH UNIVERSALLY ACKNOWLEDGED THAT A SINGLE MAN IN POSSESSION OF A GOOD FORTUNE MUST BE IN WANT OF A WIFE.', cite: '奥斯汀 · 傲慢与偏见' },
      { text: 'CALL ME ISHMAEL. SOME YEARS AGO, HAVING LITTLE MONEY IN MY PURSE, I THOUGHT I WOULD SAIL ABOUT A LITTLE AND SEE THE WATERY PART OF THE WORLD.', cite: '梅尔维尔 · 白鲸' },
      { text: 'I HAD NO DOUBT THAT THE LITTLE FIGURES WERE A MESSAGE. THE TROUBLE WAS THAT NOBODY COULD READ IT.', cite: '柯南·道尔 · 跳舞的小人(仿)' },
    ],
  },
  long: {
    basic: [
      { text: 'THE NORTH WIND AND THE SUN ARGUED ABOUT WHICH OF THEM WAS STRONGER. THEY SAW A TRAVELLER WALKING ALONG THE ROAD. THE WIND SAID THAT HE COULD MAKE THE MAN TAKE OFF HIS COAT. HE BLEW AS HARD AS HE COULD, BUT THE MAN ONLY HELD HIS COAT TIGHTER. THEN THE SUN SHONE WARM AND BRIGHT. THE MAN TOOK OFF HIS COAT AT ONCE. THE WIND HAD TO ADMIT THAT THE SUN WAS THE STRONGER OF THE TWO.', cite: '伊索 · 北风与太阳' },
      { text: 'A POOR WOODCUTTER LOST HIS AXE IN THE RIVER AND SAT DOWN TO WEEP. A GOD APPEARED WITH A GOLDEN AXE AND ASKED IF IT WAS HIS. THE MAN SAID NO. THE GOD BROUGHT A SILVER AXE AND THE MAN SAID NO AGAIN. THEN THE GOD BROUGHT HIS OLD IRON AXE AND THE MAN SMILED. PLEASED WITH HIS HONESTY, THE GOD GAVE HIM ALL THREE.', cite: '伊索 · 金斧与银斧' },
    ],
    plus: [
      { text: 'FOUR SCORE AND SEVEN YEARS AGO OUR FATHERS BROUGHT FORTH ON THIS CONTINENT A NEW NATION, CONCEIVED IN LIBERTY AND DEDICATED TO THE PROPOSITION THAT ALL MEN ARE CREATED EQUAL. NOW WE ARE ENGAGED IN A GREAT CIVIL WAR, TESTING WHETHER THAT NATION, OR ANY NATION SO CONCEIVED AND SO DEDICATED, CAN LONG ENDURE.', cite: '林肯 · 葛底斯堡演说' },
      { text: 'I HAVE NOTHING TO OFFER BUT BLOOD, TOIL, TEARS AND SWEAT. WE HAVE BEFORE US AN ORDEAL OF THE MOST GRIEVOUS KIND. WE HAVE BEFORE US MANY LONG MONTHS OF STRUGGLE AND SUFFERING. YOU ASK, WHAT IS OUR POLICY? I SAY IT IS TO WAGE WAR AGAINST A MONSTROUS TYRANNY.', cite: '丘吉尔 · 1940' },
    ],
    cet6: [
      { text: 'IT IS A CAPITAL MISTAKE TO THEORIZE BEFORE YOU HAVE ALL THE EVIDENCE. IT BIASES THE JUDGMENT. ONE BEGINS TO TWIST FACTS TO SUIT THEORIES, INSTEAD OF THEORIES TO SUIT FACTS. I HAVE SEEN IT AGAIN AND AGAIN IN MY OWN CASE.', cite: '柯南·道尔 · 波希米亚丑闻' },
      { text: 'THE LETTER LAY ON THE TABLE, AND BESIDE IT WERE SIX SMALL DRAWINGS IN RED INK. THEY WERE ROUGHLY MADE, BUT EACH ONE HAD THE SAME SHAPE. THE INSPECTOR STUDIED THEM FOR A LONG TIME AND THEN PUSHED THEM AWAY. HE SAID THAT THEY WERE THE WORK OF A CHILD. I DID NOT AGREE. A CHILD DRAWS WHAT HE SEES, BUT THESE FIGURES WERE ARRANGED WITH CARE. SOMEBODY HAD WRITTEN A MESSAGE AND HIDDEN IT IN PLAIN SIGHT.', cite: '果果密语 · 仿福尔摩斯' },
    ],
  },
};


// ---------------- 案情简报 ----------------
// 每道题包装成一个案件: brief 是接案时的情报 (暗示内容领域, 本身也是推理线索),
// truth 是破译后的结案报告。沉浸感与难度调节都靠它。
const BRIEFS = {
  bakery: {
    brief: '清晨六点，面包店的门缝下塞进一张纸。店里什么都没丢，烤箱还热着。店主说他没有仇家 —— 但这纸上不是他认识的字。',
    truth: '纸上是这家店最平常的一个早晨：开门、烤面包、等熟客。写信的人太熟悉这里了，熟悉到能背下老板的每个动作。',
  },
  garden: {
    brief: '隔壁老太太的花园被人翻动过，土是新松的，玫瑰却一朵没少。她递来一张被水泡皱的纸条，说是在花丛里捡的。',
    truth: '纸条上写的是她每天傍晚浇花的习惯。有人一直在看着她，而且看得很仔细。',
  },
  library: {
    brief: '闭馆后，有人在阅览桌上留下一张字条，压在摊开的旧书下面。那本书是本从没人借过的地图册。',
    truth: '字条描述的是那个下午读这本书的人。留下字条的人，当时就坐在她对面。',
  },
  station: {
    brief: '末班车晚点四十分钟。候车的老人在长椅上留下一只布袋，袋里有一张字条和一把小钥匙。人已经不见了。',
    truth: '老人等的不是车。他等的是一个不会来的人，和一句写在纸上的话。',
  },
  kitchen: {
    brief: '一家人在周日晚饭时发现一张折好的纸，夹在汤碗下面。没人承认是自己放的。',
    truth: '纸上是那个做饭的人整整一个周日的流程 —— 切菜、加盐、洗碗。写下这些的人，想让别人看见这些琐事。',
  },
  rain: {
    brief: '雨天，一个男孩一整天没出门。他母亲在他房间找到一张纸，上面画满了看不懂的符号。',
    truth: '他在纸上写了一整个下午：雨、窗、一只纸船。那不是密码，是一个孩子自己发明的语言。',
  },
  harbor: {
    brief: '渔船上搜出一张防水纸，字迹被海水浸过。船主说那是别人塞给他的，"看不懂，就一直带着"。',
    truth: '纸上是这条船一天的航程：出海、数网、回港。写它的人跟过这条船，或者就在船上。',
  },
  lighthouse: {
    brief: '灯塔的值班记录本里夹进了一页不该有的纸。那晚海面平静，没有船，也没有风暴。',
    truth: '那晚确实有一艘船，它没有靠岸。守夜人看见了，并且把它写了下来 —— 用只有他自己能读的方式。',
  },
  museum: {
    brief: '闭馆清点，发现一本不属于馆藏的速写本，夹在旧画框背后。里面全是密码一样的符号。',
    truth: '速写本属于一个早已离港的水手。他画下的那张脸，和墙上那幅无名肖像一模一样。',
  },
  cottage: {
    brief: '河边小屋的主人每天清晨都去桥上站一会儿，风雨无阻。有人在她信箱里塞进一张纸，她看完就烧了 —— 灰烬被我们拼了回来。',
    truth: '纸上写的是她每天做的事：喂鱼、坐着、等。等什么，纸上没写。',
  },
  orchard: {
    brief: '果园今年歉收，农场主却笑着把一张纸条钉在谷仓门上，说"看得懂的人自然懂"。',
    truth: '他写的是这一年的收成：少，但够了。那不是抱怨，是给某个人的答复。',
  },
  railway: {
    brief: '山间小站的站台上，有人用粉笔写了一行符号，被雨冲掉了一半。站长说他看见了写的人，但不想说。',
    truth: '那行字在说：车会晚点，但我还在等。站长知道写给谁，他只是不肯讲。',
  },
  archive: {
    brief: '整理十九世纪卷宗时，发现一只从未登记的封蜡信封。封蜡完好，里面只有一页手稿 —— 字母全被换过。',
    truth: '那页手稿反复写着一个名字，这个名字在每一本账册上都出现过。写信的人想留下证据，又不敢让人轻易读到。',
  },
  observatory: {
    brief: '天文台的值班日志缺了十月的三页。同一晚，观测员在私人笔记里画下了一串符号。',
    truth: '那晚东边确实有光，它移动、停顿、然后消失。观测员没有上报，只把它写成了别人看不懂的样子。',
  },
  manor: {
    brief: '黄昏，一位信使抵达庄园，留下一封没有署名的信。管家说他等了整整一小时，最后什么也没说就走了。',
    truth: '信里提到一份文件和一枚印章。两个人都懂，谁都没说出口 —— 真正的内容不在字面上，在字缝里。',
  },
  conservatory: {
    brief: '植物学家去世后，温室被查封。她的日志里有一页夹着干枯的花瓣，页面上全是符号。',
    truth: '那页记录了一株没人认得的植物。她给它起了名字，用的是只有她自己知道的写法。',
  },
  chapel: {
    brief: '村口礼拜堂的守门人说，前夜有人进去过，只点了一支蜡烛，在石地上留下一枚陌生的徽记。',
    truth: '徽记和一封旧信上的图案是同一个。有人在找一件被藏起来很久的东西。',
  },
  studio: {
    brief: '画室主人多年不肯展出的那幅画被翻了过来。背面写满了符号，笔迹和他早年的账本一致。',
    truth: '那串符号是一个名字 —— 一个他画了三十年、从不肯说出口的人。',
  },
};

// 名言名篇档: 不剧透作者 (作者是破译后的奖励), 只给类型暗示
const QUOTE_BRIEFS = {
  short: {
    brief: '截获一张只有一句话的字条。笔迹沉稳，不像普通人写的 —— 破译它，看看这人到底想说什么。',
    truth: '一句话，说尽了说话人的世界观。',
  },
  mid: {
    brief: '档案馆送来一页加密的残稿，据说是从某本被查禁的书里撕下来的。先还原文字，再判断它出自谁手。',
    truth: '这段文字曾在别处被反复引用，但很少有人读过它的原文。',
  },
  long: {
    brief: '从一册旧书里掉出整页密文。篇幅不短，看结构是一段完整的论述 —— 破译它，读读它究竟在讲什么。',
    truth: '这不是随手写的句子，是一段对着众人说的话。',
  },
};

const pick = a => a[Math.floor(Math.random() * a.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const letterCount = s => (s.match(/[A-Z]/g) || []).length;

// 从场景里取连续 N 句 (保证前后照应), 返回 { text, cite }
function fromScene(lengthKey, vocabKey) {
  const cfg = LENGTHS[lengthKey] || LENGTHS.mid;
  const pool = SCENES[vocabKey] || SCENES.basic;
  const sc = pick(pool);
  const bf = BRIEFS[sc.id] || {};
  const extra = { brief: bf.brief || null, truth: bf.truth || null, title: sc.title };
  const n = Math.min(cfg.sentences, sc.lines.length);
  // 多句一律从第 1 句起 —— 保证"他/她"总有先行词, 叙事有开头
  if (n > 1) {
    return Object.assign({ text: sc.lines.slice(0, n).join(' '), cite: '原创场景 · ' + sc.title, origin: 'scene' }, extra);
  }
  // 单句要能独立成句: 排除以代词开头的 (IT 除外, "IT RAINS" 是无主语句)
  const standalone = sc.lines.filter(l => !/^(HE|SHE|HIS|HER|THEY|THEIR|THEM|HIM)\b/.test(l));
  const pool2 = standalone.length >= 3 ? standalone : sc.lines;
  return Object.assign({ text: pick(pool2), cite: '原创场景 · ' + sc.title, origin: 'scene' }, extra);
}

function fromQuote(lengthKey, vocabKey) {
  const byLen = QUOTES[lengthKey];
  if (!byLen) return null;
  const list = byLen[vocabKey];
  if (!list || !list.length) return null;
  const q = pick(list);
  const qb = QUOTE_BRIEFS[lengthKey] || QUOTE_BRIEFS.short;
  return { text: q.text, cite: q.cite, brief: qb.brief, truth: qb.truth, origin: 'quote' };
}

// 生成一句/一段文本; 名言档若缺该组合则回落场景, 并尽量贴合目标长度
function randomSentence(lengthKey, vocabKey, source) {
  const cfg = LENGTHS[lengthKey] || LENGTHS.mid;
  const attempts = [];
  if (source === 'quote') {
    for (let i = 0; i < 12; i++) {
      const q = fromQuote(lengthKey, vocabKey) || fromQuote(lengthKey, 'basic');
      if (!q) break;
      const n = letterCount(q.text);
      if (n >= cfg.min && n <= cfg.max) return q;
      attempts.push(q);
    }
    if (attempts.length) return attempts[0];
  }
  // 场景: 长度天然贴合 (单句/3句/6句), 极端情况取最接近的
  let best = null, bestGap = Infinity;
  for (let i = 0; i < 30; i++) {
    const s = fromScene(lengthKey, vocabKey);
    const n = letterCount(s.text);
    const gap = n < cfg.min ? cfg.min - n : n > cfg.max ? n - cfg.max : 0;
    if (gap === 0) return s;
    if (gap < bestGap) { bestGap = gap; best = s; }
  }
  return best;
}

// 好友出题: 规范化并校验玩家输入的句子
const ALLOWED = /^[A-Z0-9 ,.!?;:'"()-]+$/;
function normalizeCustom(raw) {
  let s = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  s = s.replace(/[^A-Z0-9 ,.!?;:'"()-]/g, '');
  if (!ALLOWED.test(s)) return { ok: false, msg: '只支持英文字母、数字和常见标点' };
  const n = letterCount(s);
  if (n < 6) return { ok: false, msg: '太短了, 至少 6 个字母' };
  if (n > 400) return { ok: false, msg: '太长了, 最多 400 个字母' };
  if (!/[A-Z]{2}/.test(s)) return { ok: false, msg: '至少要有一个完整的英文单词' };
  const distinct = new Set((s.match(/[A-Z]/g) || [])).size;
  if (distinct < 4) return { ok: false, msg: '字母太单一, 换一句更有意思的' };
  if (!/[.!?]$/.test(s)) s += '.';
  return { ok: true, text: s };
}

// ---------------- 加密 ----------------
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function makePuzzle(opts) {
  const o = opts || {};
  const lengthKey = LENGTHS[o.length] ? o.length : 'mid';
  const vocabKey = VOCABS[o.vocab] ? o.vocab : 'basic';

  let sentence, cite, origin, brief = null, truth = null;
  if (o.sentence) {
    const norm = normalizeCustom(o.sentence);
    if (!norm.ok) throw new Error(norm.msg);
    sentence = norm.text;
    cite = o.cite || null;
    origin = 'custom';
    brief = '有人把这封密信留在了门口。没有署名，没有说明 —— 只有一堆被换过脸的字母。';
  } else {
    const s = randomSentence(lengthKey, vocabKey, o.source);
    sentence = s.text; cite = s.cite; origin = s.origin;
    brief = s.brief || null; truth = s.truth || null;
  }

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

  const n = letterCount(sentence);
  return {
    id: crypto.randomBytes(8).toString('hex'),
    sentence, cite, origin, brief, truth,
    tokens, freq, uniqueCipher,
    solution: sol,
    length: lengthKey,
    vocab: vocabKey,
    letters: n,
    createdAt: Date.now(),
  };
}

module.exports = {
  LENGTHS, VOCABS, SCENES, QUOTES, BRIEFS, QUOTE_BRIEFS,
  makePuzzle, randomSentence, normalizeCustom, letterCount,
};
