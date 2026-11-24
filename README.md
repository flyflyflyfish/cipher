# 果果密语 🕵️

替换密码破译小游戏。系统给出一封"密信"——每个字母都被换成了图案（或另一个字母），玩家根据符号出现频次、单词长度和语感，把符号还原成字母，全部译对即破译成功。

灵感来自《福尔摩斯探案集 · 跳舞的小人》。

## 玩法

- **密文样式**：🕺 图案（跳舞的小人风格，26 个手绘符号）/ 🔤 字母（打乱的替换字母，入门友好）
- **篇幅**：长文·一整篇 / 中篇·两三句 / 短句·一小句（越短线索越少，越难）
- **词汇**：日常词 / 进阶词 / 六级词🔥（生僻词更难，顺便检验词汇量）
- **题目来源**：🎲 随机小故事 / 📜 名言名篇 / ✍️ 我来出题
- **判定方式**：宽松（每破对一个词整词变绿）/ 严格（不给逐词提示，只能"检查"对了几种符号）
- **线索**：符号出现次数、标点与空格、单词长度、**案情简报**
- **辅助**：草稿纸（自动保存）、密码本（按频次排序）、提示（最多 3 次）、新手引导局

### 案情简报

每道题都包装成一个案件：先给你一段「案情简报」（谁在什么时候收到了这封信、现场有什么异常），破译成功后再给一段「结案报告」（这封信到底意味着什么）。

案情不只是装饰——它会暗示密信的内容领域（是时间？是地点？是某个人？），这本身就是推理线索，就像真实破译里分析员知道报文大致是什么类型。

## 出题引擎（v2）

**不做词槽随机填充**。早期版本用"模板 + 独立词槽"生成，会产出 `WHERE IS THE WARM LETTER` 这种语法正确、语义荒谬的句子——玩家推半天发现是句鬼话，体验极差。

现在改为：

- **18 段手写微型故事**（按词汇难度分 3 档），每段 8 句、有起承转合、代词有先行词
- 出题时随机选场景 + 按篇幅取**从第一句起的连续片段**（单句档则随机取一个能独立成句的句子）
- 每条故事配一份案情简报与结案报告
- **名言名篇库**：36 条（谚语 / 演讲 / 名著开篇 / 福尔摩斯原文），标注出处，破译后揭晓
- 同一段原文每局都会重新生成替换表，所以密文样子完全不同

质量控制靠 `server/lint-content.js`：逐句检查大小写、标点、非法字符、连续重复词、字母种类、长度区间、案情完整性，跑一遍就能发现退化。

```bash
node server/lint-content.js          # 质检报告
node server/lint-content.js --dump   # 连全文一起打印，便于人工通读
```

## 好友出题

自己写一句英文（也可以是想对朋友说的话），系统自动加密成密信，生成 4 位房间号。对方进来只能看到密文，破译完才看到你写了什么；破译成功会通知出题人。

出题者不入房、不能改题，也无法提前看到答案——这一点由服务端保证。

## 联机

- 单人破译，或创建 4 位房间号邀请好友一起推
- 房间内共享同一封密信、共享译码板，可实时讨论
- 支持邀请链接 `?room=1234`、断线重连

## 架构

```
server/index.js         express 静态托管 + ws; 账号只读复用果果麻将, 注册/好友经 WS 中继
server/puzzles.js       场景库 / 名言库 / 案情 / 随机双射加密 / 频次统计
server/lint-content.js  语料质检 (格式 + 长度 + 连贯性)
public/                 前端 (无框架): 信笺渲染 / 密码本 / 草稿纸 / 协作房 / 新手教学
```

- 端口 `3002`，生产反代 `/cipher/` 与 `/cipher-ws`
- 账号与果果麻将、果果五子棋互通（`accounts.json` 只读挂载，写入一律中继给麻将）
- 战绩落盘 `server/history.json`

## 协议（WS）

客户端 → 服务端

| 消息 | 说明 |
|---|---|
| `login` / `auto_login` / `register` / `logout` | 账号 |
| `puzzle_new` `{length,vocab,mode,source,strict}` | 单人开新局（`source`: scene/quote） |
| `guess` `{pid,c,p}` | 单人填一个符号；`p` 为空表示擦掉 |
| `check` `{pid}` | 严格模式验一次，只返回"对了几种符号" |
| `hint` `{pid}` | 揭示一个符号（≤3 次） |
| `custom_create` `{sentence,mode,strict}` | 好友出题，返回房间号 |
| `room_create` `{length,vocab,mode,source,strict,name}` / `room_join` `{code,name}` | 协作房 |
| `room_guess` `{code,c,p}` / `room_hint` `{code}` / `room_new` `{code,...}` | 房间操作 |
| `room_chat` `{code,msg}` / `room_leave` `{code}` | 讨论 / 离开 |
| `invite` `{to,code}` / `resume` `{sid}` | 邀请 / 重连 |

服务端 → 客户端：`puzzle` / `room` / `welcome` / `solved` / `check_result` / `custom_ok` / `custom_solved` / `chat` / `friends` / `auth_ok` 等

视图中的 `brief` 是案情简报（始终下发），`truth` 只在破译成功后才下发。

## 本地运行

```bash
npm install
PORT=3002 node server/index.js
# 测试 (CIPHER_TEST=1 时视图中附带谜底, 供自动化测试一键解题)
PORT=3012 CIPHER_TEST=1 node server/index.js
node server/test.js
node server/lint-content.js
```

## 部署

```bash
docker run -d --name cipher --network games --restart unless-stopped \
  -m 120m -w /app -p 127.0.0.1:3002:3002 \
  -e PORT=3002 -e MJ_WS_URL=ws://mahjong:3000/mj-ws \
  -v /opt/cipher:/app \
  -v /opt/mahjong/server/accounts.json:/app/server/accounts.json:ro \
  -v /opt/mahjong/server/secrets.json:/app/server/secrets.json:ro \
  node:20-alpine node server/index.js
```
