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

Guangdong Poker: Finding Friends 🃏

A multiplayer online version of the classic Guangdong folk card game "Finding Friends". Supports 6-player real-time battles with built-in AI players.

✨ Features

•   6-Player Real-Time Battle: WebSocket-based real-time communication with room code mechanism.

•   Complete Rule Implementation: Supports 3v3, 2v4, and 1v5 modes, including full workflows for declaring trump, contesting trump, and disputes.

•   AI Players: Compatible with major AI APIs including OpenAI, Claude, Gemini, Kimi, Qwen, and DeepSeek.

•   Play History: Enable the history feature to view detailed play records for each round during the game.

•   Ranking System: Complete score calculation and cumulative leaderboards.

•   Mobile First: Responsive design optimized for mobile devices.

🚀 Quick Start

Prerequisites

•   Node.js 16+

Installation & Run

# Clone the repository
git clone https://github.com/your-username/guangdong-poker.git
cd guangdong-poker

# Install dependencies
npm install

# Start the server
node server.js

Open your browser and navigate to http://localhost:3000.

🎮 Multiplayer Guide

1.  One player creates a room and receives a 6-digit room code.
2.  Other players join by entering the room code or using the shared link.
3.  (Optional) The host can toggle "📝 Enable Play History" to view details of each round during the game.
4.  Once 6 players are present, the host clicks "Start Game".

📜 Play History Feature

•   After creating a room, the host can check "📝 Enable Play History".

•   During the game, click the "📝 View History" button in the top-right corner.

•   A modal will display all play records, including:

    ◦   Play order for each round

    ◦   Cards played by each player (card type + specific cards)

    ◦   Pass records

    ◦   Timestamps

•   History is displayed in reverse chronological order (newest first).

🤖 AI Player Configuration

1.  After creating a room, click "🤖 AI Settings".
2.  Check the seats you want to assign to AI.
3.  Select an AI provider and enter the API Key (stored locally in your browser only; not uploaded to the server).
4.  Click "Save Config".
5.  You can configure all 6 seats as AIs to watch a pure AI battle.

Supported AI Providers

Provider Recommended Model

OpenAI gpt-4o

Claude (Anthropic) claude-sonnet-4-5

Gemini (Google) gemini-2.0-flash

Kimi (Moonshot) moonshot-v1-8k

Qwen (Alibaba) qwen-plus

DeepSeek deepseek-chat

📖 Game Rules Overview

•   Players: 6 players, 54 cards (including Jokers), 9 cards dealt per player.

•   Card Ranking: 3 < 4 < ... < A < 2 < Little Joker < Big Joker.

•   Trump Declaration: The declarer selects 2 cards to call trump, determining the team mode based on their hand.

•   Scoring: Rank-based scoring system; a zero-sum game.

•   For detailed rules, see "📖 Game Rules" within the app.

🛠 Tech Stack

•   Backend: Node.js + Express + WebSocket (ws)

•   Frontend: Vanilla HTML / CSS / JavaScript (No framework)

•   AI: OpenAI-compatible interfaces from various vendors (pure frontend calls)

📁 Project Structure


├── server.js          # Main server file (Game logic + WebSocket)

├── public/

│   ├── index.html    # Page structure

│   ├── client.js     # Client-side logic

│   ├── style.css     # Styling

│   └── ai-worker.js  # AI player adapter

├── package.json

└── README.md



