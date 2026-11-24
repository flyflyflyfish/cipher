# 果果密语 🕵️

替换密码破译小游戏。系统随机生成一句英文（或一整篇小短文），为 26 个字母生成一张随机替换表把文字加密成"密信"；玩家根据符号出现频次与语感，把符号还原成字母，全部译对即破译成功。

灵感来自《福尔摩斯探案集 · 跳舞的小人》。

## 玩法

- **密文样式**：🕺 图案（跳舞的小人风格，26 个手绘符号）/ 🔤 字母（打乱的替换字母，入门友好）
- **篇幅**：长文·一整篇 / 中篇·两三句 / 短句·一小句（越短线索越少，越难）
- **词汇**：日常词 / 进阶词 / 六级词🔥（生僻词更难，顺便检验词汇量）
- **线索**：每个符号的出现次数、标点与空格、单词长度
- **辅助**：草稿纸（自动保存）、密码本（按频次排序）、提示（最多 3 次，揭示一个符号）

## 联机

- 单人破译，或创建 4 位房间号邀请好友
- 房间内共享同一封密信、共享译码板，可实时讨论
- 支持邀请链接 `?room=1234`、断线重连

## 架构

```
server/index.js    express 静态托管 + ws; 账号只读复用果果麻将, 注册/好友经 WS 中继
server/puzzles.js  句子随机生成 (模板+分层词库) + 随机双射加密 + 频次统计
public/            前端 (无框架): 信笺渲染 / 密码本 / 草稿纸 / 协作房
```

- 端口 `3002`，生产反代 `/cipher/` 与 `/cipher-ws`
- 账号与果果麻将、果果五子棋互通（`accounts.json` 只读挂载，写入一律中继给麻将）
- 战绩落盘 `server/history.json`

## 协议（WS）

客户端 → 服务端

| 消息 | 说明 |
|---|---|
| `login` / `auto_login` / `register` / `logout` | 账号 |
| `puzzle_new` `{length,vocab,mode}` | 单人开新局 |
| `guess` `{pid,c,p}` | 单人填一个符号；`p` 为空表示擦掉 |
| `hint` `{pid}` | 揭示一个符号（≤3 次） |
| `room_create` `{length,vocab,mode,name}` / `room_join` `{code,name}` | 协作房 |
| `room_guess` `{code,c,p}` / `room_hint` `{code}` / `room_new` `{code,...}` | 房间操作 |
| `room_chat` `{code,msg}` / `room_leave` `{code}` | 讨论 / 离开 |
| `invite` `{to,code}` / `resume` `{sid}` | 邀请 / 重连 |

服务端 → 客户端：`puzzle` / `room` / `welcome` / `solved` / `chat` / `friends` / `auth_ok` 等

## 本地运行

```bash
npm install
PORT=3002 node server/index.js
# 测试 (CIPHER_TEST=1 时视图中附带谜底, 供自动化测试一键解题)
PORT=3012 CIPHER_TEST=1 node server/index.js
node server/test.js
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
