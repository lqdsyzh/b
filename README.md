# ChatHub

> 一个为聊天而建的编程社区 —— macOS SwiftUI 桌面客户端 + Node.js 后端。

ChatHub 是一个最小可用的实时聊天社区，专为「聊天」设计，并侧重**编程**：实时群聊频道（按爱好分类，编程为主）、一对一私聊（DM）、问答区（提问/回答/采纳，参考思否），以及完整的安全防滥用与管理后台。桌面端用 SwiftUI 构建，后端用 Node.js（`node:sqlite` + `ws`），零原生依赖，启动即用。

## 功能

### 聊天
- 实时群聊：频道内多人 WebSocket 实时收发，支持 Markdown 代码块（```lang … ```）高亮 + 一键复制
- 私聊 DM：一对一私信
- 历史消息：SQLite 持久化，按时间分页加载（`before` 游标）
- 频道按爱好分类：编程（JavaScript / Python / Swift / Rust / Go / 系统架构 / DevOps）、设计、生活等

### 问答区（编程为主）
- 提问：标题 + Markdown 描述（可贴代码）+ 标签
- 回答：Markdown，可贴代码
- 采纳：问题作者可采纳最佳回答
- 实时：新提问/新回答/采纳 WebSocket 实时推送到所有客户端

### 账号与安全
- 用户名 + 密码注册/登录，scrypt + 随机盐哈希
- 单设备登录：新登录自动踢掉旧 token
- 登录失败锁定：连续 5 次错锁 15 分钟
- IP 限流：注册+登录合计每 IP 每分钟 5 次
- 注销账号：二次确认 + 每 IP 每小时 3 次上限，防刷建刷销
- 改密码：需验证旧密码，改密后强制重登
- 第三方登录：GitHub OAuth 接口已留好（`/api/auth/providers`、`/api/auth/github`），待配置密钥启用

### 管理后台（管理员可见）
- 统计面板：注册数/在线数/频道数/消息数/问题数/回答数/封禁数
- 最近登录：最近登录的 20 个用户
- 用户管理：封禁/解封用户（封禁即下线、禁登录禁言）
- 内容管理：删频道消息 / 删问题 / 删回答
- 管理员角色：用户名注册为 `admin` 即自动成为首任管理员（可被环境变量 `ADMIN_BOOTSTRAP` 覆盖）

### 用户设置
- 昵称、头像色（14 色可选）
- 主题：浅色 / 深色 / 跟随系统
- 新消息提示音开关
- 在线状态显隐（可对他人隐藏自己在线）

## 目录结构

```
chat-hub/
├── README.md
├── backend/               # Node.js 后端
│   ├── package.json
│   ├── db.js              # SQLite 表 + 预编译语句 + 迁移
│   └── server.js          # 路由 / 鉴权 / 限流 / WS / 管理
└── ChatHub/               # macOS SwiftUI 应用（SwiftPM）
    ├── Package.swift
    └── Sources/ChatHub/
        ├── ChatHubApp.swift     # 入口 + 主题
        ├── Models.swift         # 数据模型 + MiniMarkdown 代码块解析
        ├── APIClient.swift     # REST + WebSocket + AppState
        ├── AuthView.swift       # 登录/注册
        ├── ContentView.swift    # 三区导航 + 侧边栏
        ├── SidebarView.swift    # 分类频道 + 成员在线
        ├── ChatView.swift       # 聊天视图
        ├── MessageBubble.swift  # 消息气泡 + 代码块
        ├── QnAView.swift        # 问答区
        ├── SettingsView.swift   # 设置/改密/注销
        └── AdminView.swift      # 管理后台
```

## 快速开始

### 1. 启动后端

```bash
cd backend
npm install        # 只装 ws（纯 JS，无原生编译）
node server.js     # 默认监听 http://localhost:8787
```

自定义端口/数据库/管理员引导用户名：

```bash
PORT=9000 DB_PATH=./data/chat.db ADMIN_BOOTSTRAP=alice node server.js
```

### 2. 构建 / 运行 macOS 客户端

需要 macOS 13+ 与 Swift 5.9+（Xcode 或 SwiftPM 均可）。

```bash
cd ChatHub
swift run          # SwiftPM 直接运行
# 或在 Xcode 中打开 Package.swift，选 ChatHub scheme 运行
```

> 默认连接 `http://localhost:8787` 与 `ws://localhost:8787/ws`。
> 启动后在登录界面注册一个账号即可进入聊天。

### 3. 成为管理员

用用户名 `admin` 注册，即自动成为首任管理员，登录后侧边栏会出现「管理后台」入口。

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/register` | - | 注册，返回 token |
| POST | `/api/login` | - | 登录，返回 token |
| GET  | `/api/me` | Bearer | 当前用户 |
| PUT  | `/api/me/profile` | Bearer | 改昵称/头像色 |
| PUT  | `/api/me/settings` | Bearer | 改主题/在线显隐/提示音 |
| PUT  | `/api/me/password` | Bearer | 改密码（需旧密码） |
| DELETE | `/api/me` | Bearer | 注销账号（confirm:true） |
| POST | `/api/me/logout` | Bearer | 退出登录 |
| GET  | `/api/channels` | Bearer | 频道列表 |
| GET  | `/api/channels/:id/messages` | Bearer | 频道历史消息（`?before=ts&limit=50`） |
| POST | `/api/channels/:id/messages` | Bearer | 发频道消息 |
| GET  | `/api/users` | Bearer | 用户列表（含在线状态） |
| GET  | `/api/dms/:userId/messages` | Bearer | 私聊历史消息 |
| POST | `/api/dms/:userId/messages` | Bearer | 发私聊消息 |
| GET  | `/api/questions` | Bearer | 问题列表（`?tag=&page=`） |
| POST | `/api/questions` | Bearer | 提问 |
| GET  | `/api/questions/:id` | Bearer | 问题详情 + 回答 |
| POST | `/api/questions/:id/answers` | Bearer | 回答 |
| POST | `/api/answers/:id/accept` | Bearer | 采纳回答（仅作者） |
| GET  | `/api/admin/stats` | 管理员 | 统计面板 |
| GET  | `/api/admin/users` | 管理员 | 用户列表 |
| POST | `/api/admin/users/:id/ban` | 管理员 | 封禁用户 |
| POST | `/api/admin/users/:id/unban` | 管理员 | 解封 |
| DELETE | `/api/admin/messages/:id` | 管理员 | 删频道消息 |
| DELETE | `/api/admin/questions/:id` | 管理员 | 删问题 |
| DELETE | `/api/admin/answers/:id` | 管理员 | 删回答 |
| GET  | `/api/auth/providers` | - | 第三方登录提供方（暂空） |
| WS   | `/ws?token=...` | token | 实时推送 |

WebSocket 推送消息示例：

```json
{ "type": "message", "scope": "channel", "channelId": "swift", "message": { ... } }
{ "type": "message", "scope": "dm", "message": { ... }, "withUserId": "..." }
{ "type": "presence", "onlineUserIds": ["..."] }
{ "type": "question", "question": { ... } }
{ "type": "answer", "questionId": "...", "answer": { ... } }
{ "type": "answer_accepted", "questionId": "...", "answerId": "...", "answer": { ... } }
{ "type": "message_deleted", "channelId": "...", "messageId": "..." }
```

## 部署到自己的服务器

代码写好后，把 `backend/` 上传到你的服务器（VPS / 云主机，或保持开机不休眠的自家电脑），执行：

```bash
cd backend && npm install && node server.js
# 推荐用 pm2 守护：pm2 start server.js --name chathub
# 推荐 Nginx 反向代理 + HTTPS（ws 走 wss）
```

把客户端 `APIClient` 默认 `baseURL` 改成你的服务器地址即可。SQLite 文件 `backend/data/chat.db` 即持久存储，重启不丢。

## 技术选型

- 后端：`node:http` + `node:sqlite` + `node:crypto` + `ws`，避免原生编译依赖
- 鉴权：scrypt 口令哈希 + 256 位随机 token
- 客户端：SwiftUI `NavigationSplitView` + `URLSession` + `URLSessionWebSocketTask`，`async/await` 网络层
- 防滥用：内存级 IP 限流 + 登录锁定 + 注销冷却 + 单设备登录

## 许可

MIT。
