// ===== AI 玩家适配器 =====
// 所有 API 调用从浏览器端发出，Key 不经过游戏服务器
// 用 IIFE 包裹，避免与 client.js 的全局变量冲突

(function() {
'use strict';

const AI_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  anthropic: {
    name: 'Claude (Anthropic)',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  gemini: {
    name: 'Gemini (Google)',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
  },
  qwen: {
    name: 'Qwen 通义千问 (阿里)',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  },
  deepseek: {
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
  },
  custom: {
    name: '自定义 API（兼容 OpenAI 格式）',
    models: [],
    endpoint: '', // 用户填写
  },
};

// ===== 游戏状态转自然语言提示词 =====
const RANK_NAMES = { 1:'3',2:'4',3:'5',4:'6',5:'7',6:'8',7:'9',8:'10',9:'J',10:'Q',11:'K',12:'A',13:'2',14:'小王',15:'大王' };
const SUIT_NAMES = { spades:'♠黑桃', hearts:'♥红心', clubs:'♣梅花', diamonds:'♦方块', joker:'王牌' };

function cardToStr(card) {
  if (card.suit === 'joker') return card.rank === 15 ? '大王' : '小王';
  return RANK_NAMES[card.rank] + SUIT_NAMES[card.suit];
}

function cardsToStr(cards) {
  return cards.map(cardToStr).join('、');
}

function playTypeToStr(type) {
  const m = { single:'单张', pair:'对子', triple:'三张', straight:'顺子', flush:'同花',
    flush_straight:'同花顺', full_house:'三带二', four_of_a_kind:'四打一' };
  return m[type] || type;
}

// 构建给 AI 的系统提示词（完整规则 + 策略指导）
function buildSystemPrompt() {
  return `你是一个顶级广东找朋友（找伙计）扑克牌游戏AI，具备深度策略推理能力。

═══ 【基本规则】 ═══
- 6人游戏，54张牌（含大小王），每人发9张
- 牌面大小：3<4<5<6<7<8<9<10<J<Q<K<A<2<小王<大王
- 花色大小：♦方块<♣梅花<♥红心<♠黑桃（同点数时比花色）
- 合法牌型及大小（从小到大）：
  单张 / 对子（含大小王对）/ 三张
  < 顺子（5张连续，A可两端：A-2-3-4-5最小，10-J-Q-K-A最大）
  < 同花（5张同花色非顺子）
  < 三带二（3同点+2同点）
  < 四打一（4同点+任意1张）
  < 同花顺（5张同花色且连续）
- 跟牌必须出同牌型且更大，或Pass；所有人Pass后领先者重新自由出牌
- 下家只剩1张牌时：出单牌必须出手中最大的；有能打过领先单牌的牌则不能Pass

═══ 【积分机制——这是胜负关键】 ═══
名次基础分：第1名=6，第2名=5，第3名=4，第4名=3，第5名=2，第6名=1

▶ 3v3模式：
  A队总分 − B队总分 = diff，A队每人 +diff，B队每人 −diff
  示例：A队(1,3,5名)=12分，B队(2,4,6名)=9分，diff=3，A队每人+3，B队每人-3

▶ 2v4模式（两人组 vs 四人组）：
  两人组最高名次者吃掉连续两个名次积分（占2个位置），另一人占1个位置，共3个位置
  diff = 两人组总分 − 4人组总分，两人组每人 +diff×2，4人组每人 −diff
  提前结算：两人组2人全出完，或4人组3人出完，立即结算
  关键：两人组1、2名 → 两人组每人+18；两人组4、5名 → 两人组每人-18

▶ 1v5模式（单人 vs 五人组）：
  固定差值=9，倍数m（2/3/4倍）
  单人方赢：单人方 +9×m×5，五人组每人 −9×m
  五人组赢：单人方 −9×m×5，五人组每人 +9×m
  提前结算：单人方出完，或五人组任意一人出完，立即结算
  倍数说明：情形D选2倍（不公示）、3倍（公示）；抢1v5固定4倍

═══ 【核心策略原则】 ═══

【1. 积分最大化思维】
- 目标不是"赢牌"，而是"最大化自己的最终总积分"
- 3v3：队伍整体名次差距越大越好，要帮队友出好名次，不只顾自己
- 2v4：两人组要争取1、2名（+18/人），四人组要阻止两人组包揽前两名
- 1v5：单人方要争第1名；五人组只需一人先出完即可触发结算，要协调谁先出完

【2. 队友协作】
- 3v3/2v4：识别队友，主动为队友铺路（出小牌让队友赢轮次，保留大牌压制对手）
- 当队友即将出完时，用大牌帮队友挡住对手的拦截
- 不要浪费大牌去赢一轮对己方无意义的牌局

【3. 名次位置计算】
- 时刻计算：如果现在结算，各方得分是多少？
- 判断当前局势对己方是否有利，决定是加速结算还是拖延
- 2v4中：若两人组已占1、2名，应尽快让第二人出完触发结算

【4. 手牌管理】
- 优先出小牌/废牌，保留大牌控制局面
- 顺子/同花/同花顺是强力牌型，可以打破对手的节奏
- 对子、三张要配合队友节奏出，不要单独浪费

【5. 信息推断】
- 根据各玩家剩余手牌数推断其手牌强弱
- 手牌少的玩家即将出完，要判断其出完对己方是否有利
- 已出过的牌型可以推断其他玩家的手牌构成

你的任务：综合以上策略，做出最优决策。只返回JSON，不要任何其他文字。`;
}

// 构建用户提示词（游戏状态 + 策略分析框架）
function buildUserPrompt(state, myHand, legalPlays) {
  const { trickState, teamConfig, rankings, players, mySeat, handCounts, totalScores, bidCards } = state;
  const leadPlay = trickState?.leadPlay;

  let prompt = `【我的身份】玩家${mySeat + 1}（座位${mySeat + 1}）\n\n`;

  // ── 队伍与模式 ──
  prompt += `【当前模式与阵营】\n`;
  if (teamConfig) {
    if (teamConfig.mode === '3v3') {
      const myTeam = [teamConfig.caller, ...(teamConfig.partners || [])];
      const inTeamA = myTeam.includes(mySeat);
      const myTeamPlayers = myTeam.map(p => `玩家${p+1}`).join('、');
      const oppTeam = [0,1,2,3,4,5].filter(p => !myTeam.includes(p)).map(p => `玩家${p+1}`).join('、');
      prompt += `3v3模式。我方（${inTeamA?'A队':'B队'}）：${myTeamPlayers}；对方：${oppTeam}\n`;
      prompt += `积分规则：我方名次总分 − 对方名次总分 = diff，我方每人 +diff，对方每人 −diff\n`;
    } else if (teamConfig.mode === '2v4') {
      const team2 = [teamConfig.caller, ...(teamConfig.partners || [])];
      const inTeam2 = team2.includes(mySeat);
      const team2Players = team2.map(p => `玩家${p+1}`).join('、');
      const team4Players = [0,1,2,3,4,5].filter(p => !team2.includes(p)).map(p => `玩家${p+1}`).join('、');
      prompt += `2v4模式。两人组：${team2Players}；四人组：${team4Players}\n`;
      prompt += `我在${inTeam2 ? '两人组' : '四人组'}\n`;
      prompt += `积分规则：两人组最高名次者吃掉连续两个名次积分，diff=两人组总分−四人组总分，两人组每人+diff×2，四人组每人−diff\n`;
      prompt += `提前结算条件：两人组2人全出完，或四人组3人出完\n`;
      if (inTeam2) {
        prompt += `⚡ 我方策略重点：争取1、2名（最高+18/人），尽快让两人都出完触发结算\n`;
      } else {
        prompt += `⚡ 我方策略重点：阻止两人组包揽前两名，争取让四人组3人先出完触发结算\n`;
      }
    } else if (teamConfig.mode === '1v5') {
      const solo = teamConfig.grabber !== undefined ? teamConfig.grabber : teamConfig.caller;
      const m = teamConfig.multiplier || 2;
      const isSolo = solo === mySeat;
      prompt += `1v5模式（${m}倍）。单人方：玩家${solo+1}；五人组：其余5人\n`;
      prompt += `我是${isSolo ? '单人方' : '五人组'}\n`;
      prompt += `积分规则：单人方赢 → 单人方+${9*m*5}，五人组每人−${9*m}；五人组赢 → 单人方−${9*m*5}，五人组每人+${9*m}\n`;
      prompt += `提前结算：单人方出完，或五人组任意一人出完，立即结算\n`;
      if (isSolo) {
        prompt += `⚡ 我方策略重点：我必须第一个出完所有牌，要用大牌控制出牌权，快速清空手牌\n`;
      } else {
        prompt += `⚡ 我方策略重点：五人组只需一人先出完即可赢，要协调谁最快出完，其他人帮忙拦截单人方\n`;
      }
    }
  } else {
    prompt += `叫主阶段尚未确定队伍\n`;
  }

  // ── 积分现状 ──
  if (totalScores && totalScores.some(s => s !== 0)) {
    prompt += `\n【当前累计积分】\n`;
    totalScores.forEach((s, i) => {
      if (players[i]) prompt += `  玩家${i+1}：${s > 0 ? '+' : ''}${s}分\n`;
    });
    const myScore = totalScores[mySeat] || 0;
    const maxScore = Math.max(...totalScores.filter((_, i) => players[i]));
    prompt += `我的积分：${myScore > 0 ? '+' : ''}${myScore}，${myScore >= maxScore ? '当前领先' : `落后领先者${maxScore - myScore}分`}\n`;
  }

  // ── 名次现状 ──
  if (rankings.length > 0) {
    prompt += `\n【已出完名次】${rankings.map((p, i) => `第${i+1}名：玩家${p+1}`).join('，')}\n`;
    // 分析当前局势
    if (teamConfig) {
      prompt += `【当前局势分析】`;
      if (teamConfig.mode === '3v3') {
        const myTeam = new Set([teamConfig.caller, ...(teamConfig.partners || [])]);
        let myRankSum = 0, oppRankSum = 0;
        rankings.forEach((p, i) => {
          const score = [6,5,4,3,2,1][i];
          if (myTeam.has(p)) myRankSum += score; else oppRankSum += score;
        });
        const diff = myRankSum - oppRankSum;
        prompt += `已出完玩家中，我方暂得${myRankSum}分，对方暂得${oppRankSum}分，差值${diff > 0 ? '+' : ''}${diff}\n`;
      } else if (teamConfig.mode === '2v4') {
        const team2 = new Set([teamConfig.caller, ...(teamConfig.partners || [])]);
        const team2Finished = rankings.filter(p => team2.has(p)).length;
        const team4Finished = rankings.filter(p => !team2.has(p)).length;
        prompt += `两人组已出完${team2Finished}人，四人组已出完${team4Finished}人（四人组3人出完即触发结算）\n`;
      } else if (teamConfig.mode === '1v5') {
        const solo = teamConfig.grabber !== undefined ? teamConfig.grabber : teamConfig.caller;
        const soloFinished = rankings.includes(solo);
        const fiveFinished = rankings.filter(p => p !== solo).length;
        prompt += `单人方${soloFinished ? '已出完（单人方赢）' : '未出完'}，五人组已出完${fiveFinished}人${fiveFinished > 0 ? '（五人组已赢）' : ''}\n`;
      }
    }
  }

  // ── 手牌态势 ──
  prompt += `\n【各玩家剩余手牌数】\n`;
  handCounts.forEach((n, i) => {
    if (!players[i]) return;
    const tag = n === 0 ? '（已出完）' : n === 1 ? '⚠️（最后1张！）' : n <= 3 ? '（手牌很少）' : '';
    prompt += `  玩家${i+1}：${n}张${tag}\n`;
  });

  // ── 本轮出牌 ──
  prompt += `\n【本轮出牌情况】\n`;
  if (leadPlay) {
    prompt += `当前领先：${playTypeToStr(leadPlay.type)}（${cardsToStr(leadPlay.cards)}）\n`;
    const plays = trickState.plays.filter(p => p.play !== null);
    if (plays.length > 0) {
      prompt += `出牌记录：${plays.map(p => `玩家${p.playerIndex+1}出${cardsToStr(p.play.cards)}`).join(' → ')}\n`;
    }
    const passes = trickState.plays.filter(p => p.play === null);
    if (passes.length > 0) {
      prompt += `已Pass：${passes.map(p => `玩家${p.playerIndex+1}`).join('、')}\n`;
    }
  } else {
    prompt += `新一轮，自由出牌\n`;
  }

  // ── 我的手牌 ──
  prompt += `\n【我的手牌（${myHand.length}张）】${cardsToStr(myHand)}\n`;

  // ── 可选出牌 ──
  prompt += `\n【可选出牌（${legalPlays.length}种）】\n`;
  if (legalPlays.length === 0) {
    prompt += `  只能Pass\n`;
  } else {
    // 按牌型分组展示，优先展示强牌型
    const grouped = {};
    legalPlays.forEach((play, i) => {
      const t = getCardType(play);
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push({ play, idx: i });
    });
    const typeOrder = ['flush_straight','four_of_a_kind','full_house','flush','straight','triple','pair','single'];
    let shown = 0;
    for (const t of typeOrder) {
      if (!grouped[t]) continue;
      grouped[t].forEach(({ play, idx }) => {
        if (shown < 25) {
          prompt += `  ${idx+1}. [${playTypeToStr(t)}] ${cardsToStr(play)}\n`;
          shown++;
        }
      });
    }
    if (legalPlays.length > 25) prompt += `  ...共${legalPlays.length}种可选\n`;
  }

  // ── 最后1张牌特殊提示 ──
  if (myHand.length === 1) {
    prompt += `
⚠️【紧急：我只剩最后1张牌！】
这是最高优先级任务：我必须尽快打出这张牌！
- 如果是自由出牌轮（无领先牌）：直接出这张牌，不要犹豫
- 如果是跟牌轮且这张牌能打过领先牌：立即出，赢得出牌权后就能出完
- 如果这张牌打不过领先牌：Pass，等待下一轮自由出牌机会
- 注意：下家规则——如果我的下家只剩1张牌，当前玩家出单牌必须出最大的，这可能影响我的机会
- 核心原则：出完这张牌就能结算，对我方有利则立即出！\n`;
  }

  // ── 下家只剩1张时的特殊提示 ──
  const nextPlayer = (mySeat + 1) % 6;
  if (handCounts && handCounts[nextPlayer] === 1 && myHand.length > 1) {
    prompt += `
⚠️【特殊规则提醒：我的下家（玩家${nextPlayer+1}）只剩1张牌！】
- 如果我出单牌，必须出手中最大的单牌
- 如果我有能打过当前领先单牌的牌，不能Pass（必须出最大单牌拦截）
- 策略：判断下家出完对我方是否有利——若有利则让其出完，若不利则用大牌拦截\n`;
  }

  // ── 决策指令 ──
  prompt += `
【决策要求】
请先进行简短的策略推理（1-3句），然后给出最终决策。
推理要考虑：
1. 当前出牌对我方积分的影响（帮助队友/阻止对手/加速结算）
2. 手牌管理（是否该保留大牌，还是现在出）
3. 名次位置（当前结算对我方是否有利）
4. 若我只剩1张牌：优先寻找机会打出，尽快出完

返回JSON格式：
- 出牌：{"action":"play","reason":"一句话推理","cards":[{"suit":"spades","rank":12},...]}
- Pass：{"action":"pass","reason":"一句话推理"}
- suit取值：spades/hearts/clubs/diamonds/joker；rank取值：数字1-15`;

  return prompt;
}

// ===== 调用各厂商 API =====
async function callOpenAIFormat(endpoint, apiKey, model, messages, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 500,
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API错误 ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callAnthropic(apiKey, model, messages) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: messages[0].content,
      messages: messages.slice(1),
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API错误 ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

// ===== 解析 AI 返回的 JSON =====
function parseAIResponse(text, legalPlays, myHand) {
  try {
    // 提取 JSON（可能被 markdown 包裹）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('无JSON');
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.action === 'pass') return null;

    if (parsed.action === 'play' && Array.isArray(parsed.cards)) {
      // 验证牌在手牌中
      const chosen = parsed.cards.map(c => {
        const found = myHand.find(h => h.suit === c.suit && h.rank === c.rank);
        return found;
      }).filter(Boolean);

      if (chosen.length === parsed.cards.length && chosen.length > 0) {
        // 验证是合法出牌
        const isLegal = legalPlays.some(lp =>
          lp.length === chosen.length &&
          lp.every(lc => chosen.some(cc => cc.suit === lc.suit && cc.rank === lc.rank))
        );
        if (isLegal) return chosen;
      }
    }
  } catch (e) {
    console.warn('AI响应解析失败:', e.message, text);
  }
  // 解析失败：随机选一个合法出牌
  if (legalPlays.length > 0) {
    return legalPlays[Math.floor(Math.random() * legalPlays.length)];
  }
  return null;
}

// ===== 牌型判断（复制自 server.js 逻辑，供提示词用）=====
function getCardType(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  if (n === 1) return 'single';
  if (n === 2) {
    if (cards[0].rank === cards[1].rank) return 'pair';
    const ranks = [cards[0].rank, cards[1].rank].sort((a,b)=>a-b);
    if (ranks[0]===14 && ranks[1]===15) return 'pair';
    return null;
  }
  if (n === 3) {
    if (cards[0].rank===cards[1].rank && cards[1].rank===cards[2].rank) return 'triple';
    return null;
  }
  if (n === 5) {
    const rc = {};
    for (const c of cards) rc[c.rank] = (rc[c.rank]||0)+1;
    const counts = Object.values(rc).sort((a,b)=>b-a);
    if (counts[0]===4) return 'four_of_a_kind';
    if (counts[0]===3 && counts[1]===2) return 'full_house';
    if (cards.some(c=>c.suit==='joker')) return null;
    const sameSuit = cards.every(c=>c.suit===cards[0].suit);
    const ranks = cards.map(c=>c.rank).sort((a,b)=>a-b);
    const isSeq = new Set(ranks).size===5 && (ranks[4]-ranks[0]===4 ||
      (ranks[0]===1&&ranks[1]===2&&ranks[2]===3&&ranks[3]===12&&ranks[4]===13));
    if (sameSuit && isSeq) return 'flush_straight';
    if (isSeq) return 'straight';
    if (sameSuit) return 'flush';
    return null;
  }
  return null;
}

// ===== 主入口：AI 决策 =====
// config: { provider, model, apiKey, endpoint(custom only) }
// state: 服务器发来的游戏状态
// legalPlays: 合法出牌列表（数组的数组）
// 返回: 选中的牌数组，或 null（Pass）
async function aiDecide(config, state, legalPlays) {
  const { provider, model, apiKey, endpoint } = config;
  const myHand = state.myHand;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(state, myHand, legalPlays);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let responseText;
  try {
    if (provider === 'anthropic') {
      responseText = await callAnthropic(apiKey, model, messages);
    } else if (provider === 'gemini') {
      // Gemini OpenAI 兼容接口：API key 放在 URL query 参数
      const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
      responseText = await callOpenAIFormat(ep + '?key=' + encodeURIComponent(apiKey), '', model, messages);
    } else {
      // OpenAI / DeepSeek / Kimi / Qwen / 自定义（均兼容 OpenAI 格式）
      const ep = provider === 'custom' ? endpoint : AI_PROVIDERS[provider]?.endpoint;
      responseText = await callOpenAIFormat(ep, apiKey, model, messages);
    }
  } catch (e) {
    console.warn('AI API调用失败，使用随机策略:', e.message);
    // fallback：随机出牌
    if (legalPlays.length > 0) return legalPlays[Math.floor(Math.random() * legalPlays.length)];
    return null;
  }

  return parseAIResponse(responseText, legalPlays, myHand);
}

// ===== 叫主阶段 AI 决策 =====
async function aiDecideBid(config, state) {
  const myHand = state.myHand || [];
  const BID_RANKS = [1,2,3,4,5,6,7,8];
  const SUITS = ['spades','hearts','clubs','diamonds'];
  const SUIT_SYM = { spades:'♠', hearts:'♥', clubs:'♣', diamonds:'♦' };

  // 如果没有API Key，用规则策略：选手牌中没有的两张（让别人持有，形成3v3或2v4）
  if (!config || !config.apiKey) {
    const handSet = new Set(myHand.map(c => `${c.suit}_${c.rank}`));
    const candidates = [];
    for (const r of BID_RANKS) {
      for (const s of SUITS) {
        if (!handSet.has(`${s}_${r}`)) candidates.push({ suit:s, rank:r });
      }
    }
    // 优先选两张不同花色的牌（更可能形成3v3）
    let c1 = candidates[Math.floor(Math.random() * candidates.length)];
    let c2 = candidates.filter(c => c.suit !== c1.suit)[0] || candidates[1] || c1;
    const fmt = c => ({ suit:c.suit, rank:c.rank, display: RANK_NAMES[c.rank]+SUIT_SYM[c.suit] });
    return [fmt(c1), fmt(c2)];
  }

  // 有API Key：让AI推理叫牌策略
  const handStr = cardsToStr(myHand);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = `【叫主决策】我是叫主者，需要选2张叫牌（只能从3-10的任意花色中选）。

我的手牌（${myHand.length}张）：${handStr}

叫牌规则：
- 叫牌后，根据其他玩家是否持有这两张牌，决定游戏模式：
  - 情形A：两张分别被两个不同玩家持有 → 3v3（我+两人 vs 其余三人）
  - 情形B：两张被同一玩家持有 → 2v4（我+该玩家 vs 其余四人），对方可提异议
  - 情形C：一张我持有，另一张被某玩家持有 → 2v4（我+该玩家 vs 其余四人）
  - 情形D：两张都被我持有 → 1v5（我单挑五人，选2倍不公示或3倍公示）

策略建议：
- 手牌强（大牌多、对子多）→ 倾向叫出自己没有的牌，争取3v3或2v4，有队友帮助
- 手牌极强（大王小王+多张大牌）→ 可以叫自己持有的牌，走1v5高倍博弈
- 叫牌时优先选低点数（3-6），这样其他玩家持有的概率更高

请分析我的手牌强度，选择最优叫牌策略。
返回JSON：{"action":"bid","reason":"推理","cards":[{"suit":"spades","rank":5},{"suit":"hearts","rank":3}]}
suit取值：spades/hearts/clubs/diamonds；rank取值：1-8（对应3-10）`;

  try {
    const messages = [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }];
    let responseText;
    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(config.apiKey, config.model, messages);
    } else if (config.provider === 'gemini') {
      const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${encodeURIComponent(config.apiKey)}`;
      responseText = await callOpenAIFormat(ep, '', config.model, messages);
    } else {
      const ep = config.provider === 'custom' ? config.endpoint : AI_PROVIDERS[config.provider]?.endpoint;
      responseText = await callOpenAIFormat(ep, config.apiKey, config.model, messages);
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.cards && parsed.cards.length === 2) {
        return parsed.cards.map(c => ({
          suit: c.suit, rank: c.rank,
          display: RANK_NAMES[c.rank] + SUIT_SYM[c.suit]
        }));
      }
    }
  } catch(e) {
    console.warn('AI叫牌决策失败，使用规则策略:', e.message);
  }
  // fallback
  const handSet = new Set(myHand.map(c => `${c.suit}_${c.rank}`));
  const candidates = [];
  for (const r of BID_RANKS) for (const s of SUITS) if (!handSet.has(`${s}_${r}`)) candidates.push({suit:s,rank:r});
  const c1 = candidates[Math.floor(Math.random()*candidates.length)] || {suit:'spades',rank:5};
  const c2 = candidates.filter(c=>c.suit!==c1.suit)[0] || candidates[1] || {suit:'hearts',rank:3};
  return [c1,c2].map(c => ({ suit:c.suit, rank:c.rank, display:RANK_NAMES[c.rank]+SUIT_SYM[c.suit] }));
}

// ===== 抢主阶段 AI 决策 =====
async function aiDecideGrab(config, state) {
  const myHand = state.myHand || [];
  const handCounts = state.handCounts || [];
  const totalScores = state.totalScores || [];
  const mySeat = state.mySeat;

  // 规则策略：评估手牌强度决定是否抢
  function evalHandStrength(hand) {
    let score = 0;
    for (const c of hand) {
      if (c.rank === 15) score += 10; // 大王
      else if (c.rank === 14) score += 8; // 小王
      else if (c.rank === 13) score += 5; // 2
      else if (c.rank === 12) score += 4; // A
      else if (c.rank === 11) score += 3; // K
      else if (c.rank >= 9) score += 2;   // J/Q
    }
    // 对子加分
    const rc = {};
    for (const c of hand) rc[c.rank] = (rc[c.rank]||0)+1;
    for (const cnt of Object.values(rc)) {
      if (cnt >= 2) score += cnt * 3;
    }
    return score;
  }

  const strength = evalHandStrength(myHand);
  const myCurrentScore = totalScores[mySeat] || 0;
  const maxScore = Math.max(...totalScores);
  const needsCatchup = myCurrentScore < maxScore - 20; // 落后较多时更激进

  if (!config || !config.apiKey) {
    // 规则策略：手牌强度>25或落后较多时抢
    const shouldGrab = strength >= 25 || (needsCatchup && strength >= 18);
    return { grab: shouldGrab, multiplier: 4 };
  }

  // AI推理
  const systemPrompt = buildSystemPrompt();
  const userPrompt = `【抢1v5决策】是否要抢1v5单挑？（固定4倍积分）

我的手牌（${myHand.length}张）：${cardsToStr(myHand)}
手牌强度评分：${strength}/50（25+为强手）

各玩家剩余手牌数：${handCounts.map((n,i)=>state.players[i]?`玩家${i+1}:${n}张`:'').filter(Boolean).join('，')}

当前累计积分：${totalScores.map((s,i)=>state.players[i]?`玩家${i+1}:${s>0?'+':''}${s}`:'').filter(Boolean).join('，')}
我的积分：${myCurrentScore > 0 ? '+' : ''}${myCurrentScore}，${needsCatchup ? '落后较多，需要高倍博弈' : '积分尚可'}

抢1v5规则：
- 抢成功后我单挑其余5人，固定4倍积分
- 我赢：我得+${9*4*5}分，其余每人−${9*4}分
- 我输：我得−${9*4*5}分，其余每人+${9*4}分
- 提前结算：我出完，或五人组任意一人出完

策略考量：
- 手牌强（大王小王+多张大牌+对子）→ 抢，高倍赢更多
- 落后较多时 → 可以适当冒险抢高倍翻盘
- 手牌弱 → 不抢，避免大额失分

返回JSON：{"action":"grab_decision","reason":"推理","grab":true或false}`;

  try {
    const messages = [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }];
    let responseText;
    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(config.apiKey, config.model, messages);
    } else if (config.provider === 'gemini') {
      const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${encodeURIComponent(config.apiKey)}`;
      responseText = await callOpenAIFormat(ep, '', config.model, messages);
    } else {
      const ep = config.provider === 'custom' ? config.endpoint : AI_PROVIDERS[config.provider]?.endpoint;
      responseText = await callOpenAIFormat(ep, config.apiKey, config.model, messages);
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.grab === 'boolean') return { grab: parsed.grab, multiplier: 4 };
    }
  } catch(e) {
    console.warn('AI抢主决策失败，使用规则策略:', e.message);
  }
  return { grab: strength >= 25 || (needsCatchup && strength >= 18), multiplier: 4 };
}

// ===== 情形D倍数选择 =====
async function aiDecideDMultiplier(config, state) {
  const myHand = state.myHand || [];
  const totalScores = state.totalScores || [];
  const mySeat = state.mySeat;

  // 评估手牌强度
  let strength = 0;
  for (const c of myHand) {
    if (c.rank === 15) strength += 10;
    else if (c.rank === 14) strength += 8;
    else if (c.rank === 13) strength += 5;
    else if (c.rank === 12) strength += 4;
    else if (c.rank >= 9) strength += 2;
  }
  const rc = {};
  for (const c of myHand) rc[c.rank] = (rc[c.rank]||0)+1;
  for (const cnt of Object.values(rc)) if (cnt >= 2) strength += cnt * 3;

  const myCurrentScore = totalScores[mySeat] || 0;
  const maxScore = Math.max(...totalScores);
  const needsCatchup = myCurrentScore < maxScore - 30;

  if (!config || !config.apiKey) {
    // 规则策略：手牌强或落后较多选3倍公示，否则选2倍不公示保守
    return (strength >= 28 || needsCatchup) ? 3 : 2;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = `【情形D倍数选择】我持有两张叫牌，需选择1v5的倍数。

我的手牌（${myHand.length}张）：${cardsToStr(myHand)}
手牌强度评分：${strength}/50

当前累计积分：${totalScores.map((s,i)=>state.players[i]?`玩家${i+1}:${s>0?'+':''}${s}`:'').filter(Boolean).join('，')}
我的积分：${myCurrentScore > 0 ? '+' : ''}${myCurrentScore}，${needsCatchup ? '落后较多，需要高倍翻盘' : '积分尚可'}

选项说明：
- 2倍（不公示）：其他人不知道是1v5，可能不会针对我；我赢+90，我输−90，对方每人±18
- 3倍（公示1v5）：所有人知道是1v5，会联合针对我；我赢+135，我输−135，对方每人±27
  注意：选3倍后，其他玩家还有机会抢1v5变成4倍

策略考量：
- 手牌极强（大王小王+多张大牌）→ 选3倍，赢更多；甚至期待别人抢4倍
- 手牌较强但不确定 → 选2倍，低调赢分
- 落后较多需要翻盘 → 选3倍，高风险高回报

返回JSON：{"action":"multiplier","reason":"推理","multiplier":2或3}`;

  try {
    const messages = [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }];
    let responseText;
    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(config.apiKey, config.model, messages);
    } else if (config.provider === 'gemini') {
      const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${encodeURIComponent(config.apiKey)}`;
      responseText = await callOpenAIFormat(ep, '', config.model, messages);
    } else {
      const ep = config.provider === 'custom' ? config.endpoint : AI_PROVIDERS[config.provider]?.endpoint;
      responseText = await callOpenAIFormat(ep, config.apiKey, config.model, messages);
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.multiplier === 2 || parsed.multiplier === 3) return parsed.multiplier;
    }
  } catch(e) {
    console.warn('AI倍数决策失败，使用规则策略:', e.message);
  }
  return (strength >= 28 || needsCatchup) ? 3 : 2;
}

// ===== 异议阶段 AI 决策（情形B：持有两张叫牌时是否提异议）=====
// 情形B：两张叫牌被同一玩家持有 → 2v4（叫主者+该玩家 vs 其余四人）
// 提异议 → 叫主者重叫；不提异议 → 接受2v4
async function aiDecideObjection(config, state) {
  const myHand = state.myHand || [];
  const totalScores = state.totalScores || [];
  const mySeat = state.mySeat;

  // 评估手牌强度（持有两张叫牌意味着是2v4，评估作为两人组的胜率）
  function evalHandStrength(hand) {
    let score = 0;
    const rc = {};
    for (const c of hand) {
      rc[c.rank] = (rc[c.rank] || 0) + 1;
      if (c.rank === 15) score += 10; // 大王
      else if (c.rank === 14) score += 8; // 小王
      else if (c.rank === 13) score += 5; // 2
      else if (c.rank === 12) score += 4; // A
      else if (c.rank === 11) score += 3; // K
      else if (c.rank >= 9) score += 2;   // J/Q
    }
    // 对子/三张加分
    for (const cnt of Object.values(rc)) {
      if (cnt >= 2) score += cnt * 3;
    }
    // 顺子潜力（5张连续）
    const ranks = hand.map(c => c.rank).sort((a, b) => a - b);
    let maxSeq = 1, curSeq = 1;
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] === ranks[i-1] + 1) { curSeq++; maxSeq = Math.max(maxSeq, curSeq); }
      else curSeq = 1;
    }
    if (maxSeq >= 4) score += 5;
    return score;
  }

  const strength = evalHandStrength(myHand);
  const myCurrentScore = totalScores[mySeat] || 0;
  const maxScore = Math.max(...totalScores.filter((_, i) => state.players && state.players[i]));
  const needsCatchup = myCurrentScore < maxScore - 20;

  // 规则策略：
  // 2v4中，持有两张叫牌的玩家是两人组成员，手牌强则接受2v4（不提异议），手牌弱则提异议让重叫
  // 落后较多时：手牌强才接受2v4（高倍博弈），手牌弱则提异议
  if (!config || !config.apiKey) {
    // 手牌强（≥22分）→ 不提异议，接受2v4；手牌弱 → 提异议
    const threshold = needsCatchup ? 20 : 22;
    return { objected: strength < threshold };
  }

  // AI推理
  const systemPrompt = buildSystemPrompt();
  const userPrompt = `【异议决策】情形B：我持有叫主者叫出的两张牌，叫主者想和我组成2v4（我们两人 vs 其余四人）。
我可以选择：
- 不提异议（接受2v4）：我和叫主者组队，两人组 vs 四人组，两人组赢可得高分
- 提异议（让叫主者重叫）：叫主者需要重新选牌，可能形成3v3或其他情形

我的手牌（${myHand.length}张）：${cardsToStr(myHand)}
手牌强度评分：${strength}/50（22+为强手，适合接受2v4）

当前累计积分：${totalScores.map((s,i)=>state.players&&state.players[i]?`玩家${i+1}:${s>0?'+':''}${s}`:'').filter(Boolean).join('，')}
我的积分：${myCurrentScore > 0 ? '+' : ''}${myCurrentScore}，${needsCatchup ? '落后较多，需要高倍博弈' : '积分尚可'}

2v4积分规则：
- 两人组赢（1、2名）：两人组每人 +18
- 两人组输：两人组每人 -18
- 风险较高，但手牌强时收益可观

策略考量：
- 手牌强（大牌多、对子多）→ 不提异议，接受2v4，争取高分
- 手牌弱 → 提异议，让叫主者重叫，避免2v4劣势
- 落后较多时 → 手牌强才接受2v4博弈翻盘，手牌弱则提异议

返回JSON：{"action":"objection","reason":"推理","objected":true或false}
（objected=true表示提异议让重叫，objected=false表示接受2v4）`;

  try {
    const messages = [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }];
    let responseText;
    if (config.provider === 'anthropic') {
      responseText = await callAnthropic(config.apiKey, config.model, messages);
    } else if (config.provider === 'gemini') {
      const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${encodeURIComponent(config.apiKey)}`;
      responseText = await callOpenAIFormat(ep, '', config.model, messages);
    } else {
      const ep = config.provider === 'custom' ? config.endpoint : AI_PROVIDERS[config.provider]?.endpoint;
      responseText = await callOpenAIFormat(ep, config.apiKey, config.model, messages);
    }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.objected === 'boolean') return { objected: parsed.objected };
    }
  } catch(e) {
    console.warn('AI异议决策失败，使用规则策略:', e.message);
  }
  // fallback
  const threshold = needsCatchup ? 20 : 22;
  return { objected: strength < threshold };
}

// ===== 测试 API 连接 =====
async function testConnection(config) {
  const { provider, model, apiKey, endpoint } = config;
  if (!apiKey) throw new Error('请先填写 API Key');
  if (!model) throw new Error('请先填写模型名称');

  const messages = [
    { role: 'system', content: '你是一个助手。' },
    { role: 'user', content: '请回复"OK"两个字。' },
  ];

  let text;
  if (provider === 'anthropic') {
    text = await callAnthropic(apiKey, model, messages);
  } else if (provider === 'gemini') {
    const ep = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${encodeURIComponent(apiKey)}`;
    text = await callOpenAIFormat(ep, '', model, messages);
  } else {
    const ep = provider === 'custom' ? endpoint : AI_PROVIDERS[provider]?.endpoint;
    if (!ep) throw new Error('无效的 API 端点');
    text = await callOpenAIFormat(ep, apiKey, model, messages);
  }
  return text;
}

// 导出
window.AIWorker = {
  AI_PROVIDERS,
  aiDecide,
  aiDecideBid,
  aiDecideGrab,
  aiDecideDMultiplier,
  aiDecideObjection,
  testConnection,
};

})(); // end IIFE
