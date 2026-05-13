# 找朋友（找伙计）扑克 🃏

广东民间扑克牌游戏「找朋友」的多人在线版本，支持 6 人实时对战，内置 AI 玩家。

## 游戏特色

- **6人实时对战**：WebSocket 实时通信，房间码机制
- **完整规则实现**：3v3 / 2v4 / 1v5 三种模式，叫主、抢主、异议全流程
- **AI 玩家**：支持 OpenAI、Claude、Gemini、Kimi、Qwen、DeepSeek 等主流 AI 接口
- **历史出牌记录**：可开启历史记录功能，游戏中随时查看每轮出牌详情
- **积分系统**：完整的积分计算与累计排行
- **手机端优先**：响应式设计，适配移动端

## 快速开始

### 环境要求

- Node.js 16+

### 安装运行

```bash
# 克隆项目
git clone https://github.com/你的用户名/guangdong-poker.git
cd guangdong-poker

# 安装依赖
npm install

# 启动服务器
node server.js
```

打开浏览器访问 `http://localhost:3000`

### 多人游戏

1. 一人创建房间，获得 6 位房间码
2. 其他玩家输入房间码加入（或分享链接）
3. **（可选）房主勾选「📝 开启历史出牌记录」**，游戏中可查看每轮出牌详情
4. 6 人到齐后房主点击「开始游戏」

### 历史出牌记录功能

1. 创建房间后，房主可勾选「📝 开启历史出牌记录」
2. 游戏进行中，点击右上角「📝 查看历史」按钮
3. 弹窗显示所有轮次的出牌记录，包括：
   - 每轮的出牌顺序
   - 每位玩家的出牌内容（牌型 + 具体牌面）
   - Pass 记录
   - 出牌时间戳
4. 历史记录按轮次倒序显示（最新的在上面）

### AI 玩家配置

1. 创建房间后，点击「🤖 AI玩家设置」
2. 勾选要设为 AI 的座位
3. 选择 AI 提供商，填入 API Key（**仅存储在本地浏览器，不上传服务器**）
4. 点击「保存配置」
5. 可配置全部 6 个座位为 AI，实现纯 AI 对战观战

支持的 AI 提供商：
| 提供商 | 推荐模型 |
|--------|---------|
| OpenAI | gpt-4o |
| Claude (Anthropic) | claude-sonnet-4-5 |
| Gemini (Google) | gemini-2.0-flash |
| Kimi 月之暗面 | moonshot-v1-8k |
| Qwen 通义千问 | qwen-plus |
| DeepSeek | deepseek-chat |

## 游戏规则简介

- 6人游戏，54张牌，每人发9张
- 牌面大小：3 < 4 < ... < A < 2 < 小王 < 大王
- 叫主者选2张牌叫主，根据持牌情况决定队伍模式
- 名次积分制，零和博弈

详细规则见游戏内「📖 游戏规则说明」。

## 技术栈

- **后端**：Node.js + Express + WebSocket (ws)
- **前端**：原生 HTML / CSS / JavaScript（无框架）
- **AI**：各厂商 OpenAI 兼容接口，纯前端调用

## 项目结构

```
├── server.js          # 服务器主文件（游戏逻辑 + WebSocket）
├── public/
│   ├── index.html     # 页面结构
│   ├── client.js      # 客户端逻辑
│   ├── style.css      # 样式
│   └── ai-worker.js   # AI 玩家适配器
├── package.json
└── README.md
```

## License

MIT
