/**
 * 找朋友扑克 - 广东/广西6人玩法
 * 纯 HTML5 + CSS3 + Vanilla JavaScript
 */

'use strict';

// ===== 游戏阶段枚举 =====
const GamePhase = {
  SETUP: 'setup',
  DEALING: 'dealing',
  BIDDING: 'bidding',
  PLAYING: 'playing',
  RESULT: 'result',
  LEADERBOARD: 'leaderboard',
  HISTORY: 'history'
};

// ===== 牌型枚举 =====
const CardType = {
  SINGLE: 'single',               // 单张（1张）
  PAIR: 'pair',                   // 对子（2张同rank，或大王+小王）
  TRIPLE: 'triple',               // 三张（3张同rank）
  STRAIGHT: 'straight',           // 顺子（5张连续，3~A，不含2和王）
  FLUSH: 'flush',                 // 同花式（5张同花，不要求连续）
  FULL_HOUSE: 'full_house',       // 三带二（3同rank + 2同rank）
  FOUR_OF_A_KIND: 'four_of_a_kind', // 四打一（4同rank + 1任意）
  FLUSH_STRAIGHT: 'flush_straight'  // 同花顺（5张同花连续，最强5张牌型）
};

// ===== 牌面大小映射 =====
// 顺序：3<4<5<6<7<8<9<10<J<Q<K<A<2<小王<大王
const RANK_MAP = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6,
  '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11,
  'A': 12, '2': 13, '小王': 14, '大王': 15
};

// ===== 花色权重映射 =====
// 方块(♦) < 梅花(♣) < 红心(♥) < 黑桃(♠)，王牌花色权重最高
const SUIT_RANK = { diamonds: 1, clubs: 2, hearts: 3, spades: 4, joker: 5 };

// ===== 名次基础分 =====
const BASE_SCORES = [6, 5, 4, 3, 2, 1];

// ===== 工具函数 =====
/**
 * HTML转义，防止XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

// ===== DeckManager 牌组管理 =====
const DeckManager = {
  /**
   * 创建54张完整牌组
   * @returns {Card[]}
   */
  createDeck() {
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const suitSymbols = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
    const rankNames = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    const deck = [];

    for (const suit of suits) {
      for (let i = 0; i < rankNames.length; i++) {
        const rankName = rankNames[i];
        deck.push({
          suit,
          rank: RANK_MAP[rankName],
          display: rankName + suitSymbols[suit]
        });
      }
    }

    // 小王
    deck.push({ suit: 'joker', rank: 14, display: '小王' });
    // 大王
    deck.push({ suit: 'joker', rank: 15, display: '大王' });

    return deck;
  },

  /**
   * Fisher-Yates 洗牌
   * @param {Card[]} deck
   * @returns {Card[]}
   */
  shuffle(deck) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  },

  /**
   * 发牌
   * @param {Card[]} deck
   * @param {number} playerCount
   * @param {number} cardsPerPlayer
   * @returns {Card[][]}
   */
  deal(deck, playerCount, cardsPerPlayer) {
    const hands = [];
    for (let i = 0; i < playerCount; i++) {
      hands.push(deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer));
    }
    return hands;
  }
};

// ===== CardValidator 牌型验证 =====
const CardValidator = {
  /**
   * 识别牌型
   * @param {Card[]} cards
   * @returns {string|null} CardType 或 null
   */
  getCardType(cards) {
    if (!cards || cards.length === 0) return null;
    const n = cards.length;

    if (n === 1) return CardType.SINGLE;

    if (n === 2) {
      // 普通对子：同rank
      if (cards[0].rank === cards[1].rank) return CardType.PAIR;
      // 王对：大王+小王
      const ranks = [cards[0].rank, cards[1].rank].sort((a, b) => a - b);
      if (ranks[0] === 14 && ranks[1] === 15) return CardType.PAIR;
      return null;
    }

    if (n === 3) {
      // 三张：3张同rank
      if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) return CardType.TRIPLE;
      return null;
    }

    if (n === 5) {
      // 统计每个rank的数量
      const rankCount = {};
      for (const c of cards) rankCount[c.rank] = (rankCount[c.rank] || 0) + 1;
      const counts = Object.values(rankCount).sort((a, b) => b - a);

      // 四打一：4+1
      if (counts[0] === 4 && counts[1] === 1) return CardType.FOUR_OF_A_KIND;

      // 三带二：3+2
      if (counts[0] === 3 && counts[1] === 2) return CardType.FULL_HOUSE;

      // 以下牌型不含大小王
      const hasJoker = cards.some(c => c.suit === 'joker');
      if (hasJoker) return null;

      const sameSuit = cards.every(c => c.suit === cards[0].suit);

      // 判断是否5张连续（支持A-high和A-low）
      const isConsecutive = this._isStraight(cards);

      // 同花顺：同花 + 连续（最优先）
      if (sameSuit && isConsecutive) return CardType.FLUSH_STRAIGHT;

      // 顺子：连续但不同花
      if (isConsecutive) return CardType.STRAIGHT;

      // 同花式：同花但不连续
      if (sameSuit) return CardType.FLUSH;

      return null;
    }

    return null;
  },

  /**
   * 判断5张牌是否构成顺子（支持A-high和A-low）
   * A-high: 10-J-Q-K-A (rank 8,9,10,11,12)
   * A-low:  A-2-3-4-5  (rank 12,13,1,2,3) — A和2都可作低牌
   * @param {Card[]} cards 5张牌（已排除王）
   * @returns {boolean}
   */
  _isStraight(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
    // 5张rank必须各不相同
    if (new Set(ranks).size !== 5) return false;

    // 普通连续：最大-最小 = 4
    if (ranks[4] - ranks[0] === 4) return true;

    // A-low 特殊情形：A(12) + 2(13) + 3(1) + 4(2) + 5(3)
    // 排序后 ranks = [1,2,3,12,13]
    if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3 &&
        ranks[3] === 12 && ranks[4] === 13) return true;

    return false;
  },

  /**
   * 获取顺子/同花顺的比较用最大rank
   * A-low(A2345) 最大牌是5(rank=3)；其他取正常最大rank
   * @param {Card[]} cards
   * @returns {number} rank值
   */
  _straightTopRank(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
    // A-low: [1,2,3,12,13] → 最大是5(rank=3)
    if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3 &&
        ranks[3] === 12 && ranks[4] === 13) return 3;
    return ranks[4];
  },

  /**
   * 计算单张牌的复合分数（点数优先，花色次之）
   * @param {Card} card
   * @returns {number}
   */
  getCardScore(card) {
    return card.rank * 10 + (SUIT_RANK[card.suit] || 0);
  },

  /**
   * 获取一组牌中分数最高的牌
   * @param {Card[]} cards
   * @returns {Card}
   */
  getTopCard(cards) {
    return cards.reduce((best, c) =>
      this.getCardScore(c) > this.getCardScore(best) ? c : best
    );
  },

  /**
   * 获取Play的比较值（最大牌的复合分数：rank*10 + suitRank）
   * 三带二：取三张部分最大牌；四打一：取四张部分最大牌；其他：取整体最大牌
   * @param {Card[]} cards
   * @param {string} [type] 牌型（可选，不传则自动识别）
   * @returns {number}
   */
  getPlayValue(cards, type) {
    const t = type || this.getCardType(cards);

    if (t === CardType.STRAIGHT || t === CardType.FLUSH_STRAIGHT) {
      // 顺子/同花顺：用顺子专用最大rank（处理A-low情形），再加最大牌花色
      const topRank = this._straightTopRank(cards);
      // 取该rank中花色最大的牌
      const topCards = cards.filter(c => c.rank === topRank);
      const topCard = topCards.length > 0 ? this.getTopCard(topCards) : this.getTopCard(cards);
      return this.getCardScore(topCard);
    }

    if (t === CardType.FULL_HOUSE) {
      // 三带二：比三张部分，取三张中最大牌
      const rankCount = {};
      for (const c of cards) rankCount[c.rank] = (rankCount[c.rank] || 0) + 1;
      const tripleRank = Number(Object.keys(rankCount).find(r => rankCount[r] === 3));
      const tripleCards = cards.filter(c => c.rank === tripleRank);
      return this.getCardScore(this.getTopCard(tripleCards));
    }

    if (t === CardType.FOUR_OF_A_KIND) {
      // 四打一：比四张部分，取四张中最大牌
      const rankCount = {};
      for (const c of cards) rankCount[c.rank] = (rankCount[c.rank] || 0) + 1;
      const quadRank = Number(Object.keys(rankCount).find(r => rankCount[r] === 4));
      const quadCards = cards.filter(c => c.rank === quadRank);
      return this.getCardScore(this.getTopCard(quadCards));
    }

    return this.getCardScore(this.getTopCard(cards));
  },

  /**
   * 比较两个Play大小
   * 5张牌型强度（从弱到强）：顺子 < 同花式 < 三带二 < 四打一 < 同花顺
   * 强牌型可以压弱牌型；同牌型比value大小
   * @param {Play} a
   * @param {Play} b
   * @returns {number} >0 a更大, <0 b更大, 0 不可比
   */
  comparePlay(a, b) {
    // 1~3张牌型：只能同牌型比大小
    const smallTypes = new Set([CardType.SINGLE, CardType.PAIR, CardType.TRIPLE]);
    if (smallTypes.has(a.type) || smallTypes.has(b.type)) {
      if (a.type !== b.type) return 0;
      return a.value - b.value;
    }

    // 5张牌型强度排序
    const level = {
      [CardType.STRAIGHT]: 1,
      [CardType.FLUSH]: 2,
      [CardType.FULL_HOUSE]: 3,
      [CardType.FOUR_OF_A_KIND]: 4,
      [CardType.FLUSH_STRAIGHT]: 5
    };

    const la = level[a.type] ?? 0;
    const lb = level[b.type] ?? 0;

    if (la !== lb) return la - lb;
    // 同牌型比value
    return a.value - b.value;
  },

  /**
   * 验证是否可以跟牌
   * @param {Card[]} cards
   * @param {Play} leadPlay
   * @returns {boolean}
   */
  canFollow(cards, leadPlay) {
    const play = this.buildPlay(cards);
    if (!play) return false;
    return this.comparePlay(play, leadPlay) > 0;
  },

  /**
   * 构建Play对象
   * @param {Card[]} cards
   * @returns {Play|null}
   */
  buildPlay(cards) {
    const type = this.getCardType(cards);
    if (!type) return null;
    return { cards: cards.slice(), type, value: this.getPlayValue(cards, type) };
  }
};

// ===== RoundManager 出牌轮次管理 =====
const RoundManager = {
  /** @type {Card[][]} */
  hands: [],
  /** @type {TrickState} */
  trickState: null,
  /** @type {number[]} 按名次排列的玩家索引 */
  rankings: [],
  /** @type {boolean} */
  gameOver: false,

  /**
   * 开始游戏
   * @param {Card[][]} hands
   * @param {number} firstPlayer
   */
  startGame(hands, firstPlayer) {
    this.hands = hands.map(h => h.slice());
    this.rankings = [];
    this.gameOver = false;
    this.trickState = {
      leadPlay: null,
      plays: [],
      currentPlayer: firstPlayer,
      passCount: 0
    };
  },

  /**
   * 获取当前玩家
   * @returns {number}
   */
  getCurrentPlayer() {
    return this.trickState.currentPlayer;
  },

  /**
   * 出牌
   * @param {number} playerIndex
   * @param {Card[]} cards
   * @returns {PlayResult}
   */
  playCards(playerIndex, cards) {
    if (playerIndex !== this.trickState.currentPlayer) {
      return { success: false, error: '不是你的回合' };
    }

    // 验证牌属于该玩家手牌
    const hand = this.hands[playerIndex];
    for (const card of cards) {
      const idx = hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
      if (idx === -1) {
        return { success: false, error: '出的牌不在手牌中' };
      }
    }

    // 验证牌型
    const play = CardValidator.buildPlay(cards);
    if (!play) {
      return { success: false, error: '非法牌型，请重新选择' };
    }

    // 验证跟牌
    if (this.trickState.leadPlay !== null) {
      if (!CardValidator.canFollow(cards, this.trickState.leadPlay)) {
        return { success: false, error: '必须出比当前领先牌更大的同牌型，或选择Pass' };
      }
    }

    // 从手牌移除
    const newHand = hand.slice();
    for (const card of cards) {
      const idx = newHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
      newHand.splice(idx, 1);
    }
    this.hands[playerIndex] = newHand;

    // 更新轮次状态
    this.trickState.plays.push({ playerIndex, play });
    this.trickState.leadPlay = play;
    this.trickState.passCount = 0;

    // 检查是否出完手牌
    if (newHand.length === 0) {
      this.rankings.push(playerIndex);
    }

    // 检查游戏是否结束（所有人都出完）
    if (this.rankings.length >= 6) {
      this.gameOver = true;
      return { success: true, gameOver: true };
    }

    // 检查某队是否全员出完（队伍胜利）
    if (newHand.length === 0 && this._checkTeamWin()) {
      return { success: true, gameOver: true };
    }

    // 若只剩1人有手牌，自动记录最后名次，游戏结束
    const remaining = this.hands.filter(h => h.length > 0);
    if (remaining.length === 1) {
      const lastIdx = this.hands.findIndex(h => h.length > 0);
      this.rankings.push(lastIdx);
      this.gameOver = true;
      return { success: true, gameOver: true };
    }

    // 推进到下一个有手牌的玩家
    this._advanceToNextPlayer(playerIndex);

    return { success: true };
  },

  /**
   * Pass
   * @param {number} playerIndex
   * @returns {PlayResult}
   */
  pass(playerIndex) {
    if (playerIndex !== this.trickState.currentPlayer) {
      return { success: false, error: '不是你的回合' };
    }
    if (this.trickState.leadPlay === null) {
      return { success: false, error: '本轮第一个出牌不能Pass' };
    }

    this.trickState.plays.push({ playerIndex, play: null });
    this.trickState.passCount++;

    const leadPlayerIndex = this._getLeadPlayerIndex();

    // 有手牌且不是领先者的玩家数（这些人才需要 pass）
    const activePlayers = this.hands.filter((h, i) => h.length > 0 && i !== leadPlayerIndex).length;

    if (this.trickState.passCount >= activePlayers) {
      // 本轮结束，领先者赢得本轮

      // 领先者已出完手牌（出完后继续领先），找下一个有手牌的玩家开新轮
      const winnerHasCards = this.hands[leadPlayerIndex].length > 0;

      // 检查剩余有手牌的玩家数
      const playersWithCards = this.hands.filter(h => h.length > 0).length;

      if (playersWithCards === 0) {
        // 所有人都出完了，游戏结束
        this.gameOver = true;
        return { success: true, trickWinner: leadPlayerIndex, gameOver: true };
      }

      if (playersWithCards === 1 && winnerHasCards) {
        // 只剩领先者一人有牌，自动记录最后名次
        this.rankings.push(leadPlayerIndex);
        this.gameOver = true;
        return { success: true, trickWinner: leadPlayerIndex, gameOver: true };
      }

      // 检查某队是否全员出完（队伍胜利）
      if (this._checkTeamWin()) {
        return { success: true, trickWinner: leadPlayerIndex, gameOver: true };
      }

      // 确定新一轮的出牌者：
      // 若领先者还有手牌，由他开新轮；否则跳到他之后第一个有手牌的玩家
      let nextPlayer = leadPlayerIndex;
      if (!winnerHasCards) {
        nextPlayer = (leadPlayerIndex + 1) % 6;
        let count = 0;
        while (this.hands[nextPlayer].length === 0 && count < 6) {
          nextPlayer = (nextPlayer + 1) % 6;
          count++;
        }
      }

      this.trickState = {
        leadPlay: null,
        plays: [],
        currentPlayer: nextPlayer,
        passCount: 0
      };
      return { success: true, trickWinner: leadPlayerIndex };
    }

    // 推进到下一个有手牌的玩家
    this._advanceToNextPlayer(playerIndex);
    return { success: true };
  },

  /**
   * 获取领先者玩家索引
   * @returns {number}
   */
  _getLeadPlayerIndex() {
    for (let i = this.trickState.plays.length - 1; i >= 0; i--) {
      if (this.trickState.plays[i].play !== null) {
        return this.trickState.plays[i].playerIndex;
      }
    }
    return -1;
  },

  /**
   * 推进到下一个有手牌的玩家
   * @param {number} currentPlayer
   */
  _advanceToNextPlayer(currentPlayer) {
    let next = (currentPlayer + 1) % 6;
    let count = 0;
    while (this.hands[next].length === 0 && count < 6) {
      next = (next + 1) % 6;
      count++;
    }
    this.trickState.currentPlayer = next;
  },

  /**
   * 获取名次列表
   * @returns {number[]}
   */
  getRankings() {
    return this.rankings.slice();
  },

  /**
   * 检查是否某队全员已出完牌，若是则将另一队剩余玩家按手牌数从少到多填入名次
   * @returns {boolean} 是否触发了队伍胜利结束
   */
  _checkTeamWin() {
    const config = TeamManager.getConfig();
    if (!config) return false;

    const teamA = new Set([config.caller, ...config.partners]);
    const teamB = new Set();
    for (let i = 0; i < 6; i++) {
      if (!teamA.has(i)) teamB.add(i);
    }

    const finishedSet = new Set(this.rankings);

    // 1v5模式：五人组只需有一人出完即触发结算
    if (config.mode === '1v5') {
      const soloFinished = finishedSet.has(config.caller);
      const fiveTeamAnyFinished = [...teamB].some(p => finishedSet.has(p));
      if (!soloFinished && !fiveTeamAnyFinished) return false;
      const remaining = Array.from({length:6}, (_, i) => i)
        .filter(p => !finishedSet.has(p))
        .sort((a, b) => this.hands[a].length - this.hands[b].length);
      for (const p of remaining) this.rankings.push(p);
      this.gameOver = true;
      return true;
    }

    // 其他模式：某队全员出完才结算
    const teamADone = [...teamA].every(p => finishedSet.has(p));
    const teamBDone = [...teamB].every(p => finishedSet.has(p));

    if (!teamADone && !teamBDone) return false;

    const losingTeam = teamADone ? teamB : teamA;
    const remaining = [...losingTeam]
      .filter(p => !finishedSet.has(p))
      .sort((a, b) => this.hands[a].length - this.hands[b].length);

    for (const p of remaining) {
      this.rankings.push(p);
    }

    this.gameOver = true;
    return true;
  }
};

// ===== TeamManager 组队管理 =====
const TeamManager = {
  /** @type {TeamConfig|null} */
  config: null,

  /**
   * 根据叫牌自动判定组队模式（情形A-F）
   * @param {number} callerIndex 叫主者索引
   * @param {Card[]} bidCards 叫主者选的两张叫牌（suit+rank标识）
   * @param {Card[][]} hands 所有玩家手牌
   * @returns {{ situation: string, config: TeamConfig, objectionPlayer: number|null }}
   */
  resolveBid(callerIndex, bidCards, hands) {
    const card1 = bidCards[0];
    const card2 = bidCards[1];

    // 找持有每张叫牌的玩家（排除叫主者自己）
    const holders1 = []; // 持有card1的玩家
    const holders2 = []; // 持有card2的玩家
    let callerHas1 = false;
    let callerHas2 = false;

    for (let i = 0; i < hands.length; i++) {
      const hasCard1 = hands[i].some(c => c.suit === card1.suit && c.rank === card1.rank);
      const hasCard2 = hands[i].some(c => c.suit === card2.suit && c.rank === card2.rank);
      if (i === callerIndex) {
        callerHas1 = hasCard1;
        callerHas2 = hasCard2;
      } else {
        if (hasCard1) holders1.push(i);
        if (hasCard2) holders2.push(i);
      }
    }

    // 情形D/E：叫主者持有两张叫牌（1v5，倍数2）
    if (callerHas1 && callerHas2) {
      return {
        situation: 'D',
        config: { mode: '1v5', caller: callerIndex, partners: [], multiplier: 2 },
        objectionPlayer: null
      };
    }

    // 情形C：叫主者持有其中一张，另一张在某玩家手中
    if (callerHas1 && holders2.length > 0) {
      const partner = holders2[0];
      return {
        situation: 'C',
        config: { mode: '2v4', caller: callerIndex, partners: [partner], multiplier: undefined },
        objectionPlayer: null
      };
    }
    if (callerHas2 && holders1.length > 0) {
      const partner = holders1[0];
      return {
        situation: 'C',
        config: { mode: '2v4', caller: callerIndex, partners: [partner], multiplier: undefined },
        objectionPlayer: null
      };
    }

    // 情形B：某玩家同时持有两张叫牌
    const bothHolder = holders1.find(p => holders2.includes(p));
    if (bothHolder !== undefined) {
      return {
        situation: 'B',
        config: { mode: '2v4', caller: callerIndex, partners: [bothHolder], multiplier: undefined },
        objectionPlayer: bothHolder
      };
    }

    // 情形A：两张叫牌分别在两个不同玩家手中
    if (holders1.length > 0 && holders2.length > 0) {
      const partner1 = holders1[0];
      const partner2 = holders2[0];
      return {
        situation: 'A',
        config: { mode: '3v3', caller: callerIndex, partners: [partner1, partner2], multiplier: undefined },
        objectionPlayer: null
      };
    }

    // 兜底：叫主者持一张，另一张无人持有（不应发生，但防御性处理）
    // 或两张都在叫主者手中但只有一张（不可能）
    // 默认1v5
    return {
      situation: 'D',
      config: { mode: '1v5', caller: callerIndex, partners: [], multiplier: 2 },
      objectionPlayer: null
    };
  },

  /**
   * 直接设置配置（用于情形F：非叫主者宣布单挑）
   * @param {TeamConfig} config
   */
  setConfig(config) {
    this.config = config;
  },

  /**
   * 设置模式和叫主者
   * @param {string} mode
   * @param {number} callerIndex
   */
  setMode(mode, callerIndex) {
    this.config = {
      mode,
      caller: callerIndex,
      partners: [],
      multiplier: mode === '1v5' ? 2 : undefined
    };
  },

  /**
   * 设置伙伴
   * @param {number[]} partnerIndices
   */
  setPartners(partnerIndices) {
    if (!this.config) return;
    this.config.partners = partnerIndices.slice();
  },

  /**
   * 设置倍数（1v5模式）
   * @param {number} multiplier
   */
  setMultiplier(multiplier) {
    if (!this.config) return;
    this.config.multiplier = multiplier;
  },

  /**
   * 获取玩家所属队伍
   * @param {number} playerIndex
   * @returns {'A'|'B'}
   */
  getTeam(playerIndex) {
    if (!this.config) return 'B';
    const teamA = [this.config.caller, ...this.config.partners];
    return teamA.includes(playerIndex) ? 'A' : 'B';
  },

  /**
   * 获取配置
   * @returns {TeamConfig|null}
   */
  getConfig() {
    return this.config;
  },

  /**
   * 验证配置完整性
   * @returns {boolean}
   */
  isConfigComplete() {
    if (!this.config) return false;
    const { mode, partners, multiplier } = this.config;
    if (mode === '3v3') return partners.length === 2;
    if (mode === '2v4') return partners.length === 1;
    if (mode === '1v5') return multiplier != null && [2, 3, 4].includes(multiplier);
    return false;
  },

  /**
   * 重置
   */
  reset() {
    this.config = null;
  }
};

// ===== ScoreCalculator 积分计算 =====
const ScoreCalculator = {
  /**
   * 3v3 积分计算
   * @param {number[]} rankings
   * @param {TeamConfig} teamConfig
   * @returns {number[]}
   */
  calculate3v3(rankings, teamConfig) {
    const teamA = new Set([teamConfig.caller, ...teamConfig.partners]);
    let scoreA = 0, scoreB = 0;
    for (let i = 0; i < 6; i++) {
      const player = rankings[i];
      if (teamA.has(player)) scoreA += BASE_SCORES[i];
      else scoreB += BASE_SCORES[i];
    }
    const diff = scoreA - scoreB;
    const deltas = new Array(6).fill(0);
    for (let p = 0; p < 6; p++) {
      deltas[p] = teamA.has(p) ? diff : -diff;
    }
    return deltas;
  },

  /**
   * 2v4 积分计算
   * 两人组：名次最高者取连续两个积分（rank_i + rank_{i+1}），另一人取自己名次分
   * 四人组：只取前三名的积分求和
   * diff = score2 - score4，两人组每人 +diff×2，四人组每人 -diff×1
   * @param {number[]} rankings
   * @param {TeamConfig} teamConfig
   * @returns {number[]}
   */
  calculate2v4(rankings, teamConfig) {
    const team2 = new Set([teamConfig.caller, ...teamConfig.partners]);
    const team4 = [];
    for (let p = 0; p < 6; p++) {
      if (!team2.has(p)) team4.push(p);
    }

    // 找两人组中名次最高者
    let topPos = -1, topPlayer = -1;
    for (let i = 0; i < 6; i++) {
      if (team2.has(rankings[i])) { topPos = i; topPlayer = rankings[i]; break; }
    }

    // 两人组最高者取连续两个积分
    const topScore = topPos >= 5 ? BASE_SCORES[5] : BASE_SCORES[topPos] + BASE_SCORES[topPos + 1];

    // 顺移积分序列：跳过 topPos+1 位置（被吃掉的积分）
    const shiftedScores = [];
    for (let i = 0; i < 6; i++) {
      if (i !== (topPos < 5 ? topPos + 1 : -1)) shiftedScores.push(BASE_SCORES[i]);
    }

    // 其余5人从 shiftedScores[1] 开始依次取分
    const remainingPlayers = rankings.filter(p => p !== topPlayer);
    const playerScore = {};
    playerScore[topPlayer] = topScore;
    for (let i = 0; i < remainingPlayers.length; i++) {
      playerScore[remainingPlayers[i]] = shiftedScores[i + 1] || 0;
    }

    // 两人组总分
    let score2 = 0;
    for (const p of team2) score2 += playerScore[p] || 0;

    // 四人组：按名次排序，只取前三名积分
    const team4Sorted = team4.slice().sort((a, b) => rankings.indexOf(a) - rankings.indexOf(b));
    let score4 = 0;
    for (let i = 0; i < Math.min(3, team4Sorted.length); i++) {
      score4 += playerScore[team4Sorted[i]] || 0;
    }

    const diff = score2 - score4;
    const deltas = new Array(6).fill(0);
    for (let p = 0; p < 6; p++) {
      deltas[p] = team2.has(p) ? diff * 2 : -diff;
    }
    return deltas;
  },

  /**
   * 1v5 积分计算
   * solo为叫主者（出牌者），grabber若存在则为抢主者（积分计算以grabber为单人方）
   * 单人胜出：solo/grabber得 9×m×5，五人组每人 -9×m
   * 五人组胜出：solo/grabber得 -9×m×5，五人组每人 +9×m
   * @param {number[]} rankings
   * @param {TeamConfig} teamConfig
   * @returns {number[]}
   */
  calculate1v5(rankings, teamConfig) {
    const m = teamConfig.multiplier || 2;
    const solo = teamConfig.caller;
    const scorePlayer = teamConfig.grabber !== undefined ? teamConfig.grabber : solo;
    const diff = 9; // 15-6=9 固定差值
    const deltas = new Array(6).fill(0);
    if (rankings[0] === solo) {
      deltas[scorePlayer] = diff * m * 5;
      for (let p = 0; p < 6; p++) {
        if (p !== scorePlayer) deltas[p] = -(diff * m);
      }
    } else {
      deltas[scorePlayer] = -(diff * m * 5);
      for (let p = 0; p < 6; p++) {
        if (p !== scorePlayer) deltas[p] = diff * m;
      }
    }
    return deltas;
  },

  /**
   * 统一入口
   * @param {number[]} rankings
   * @param {TeamConfig} config
   * @returns {number[]}
   */
  calculate(rankings, config) {
    if (config.mode === '3v3') return this.calculate3v3(rankings, config);
    if (config.mode === '2v4') return this.calculate2v4(rankings, config);
    if (config.mode === '1v5') return this.calculate1v5(rankings, config);
    return new Array(6).fill(0);
  }
};

// ===== StorageManager 持久化管理 =====
const StorageManager = {
  KEYS: {
    PLAYERS: 'fpk_players',
    HISTORY: 'fpk_history'
  },

  savePlayers(players) {
    try {
      localStorage.setItem(this.KEYS.PLAYERS, JSON.stringify(players));
    } catch (e) {
      console.warn('存储玩家信息失败', e);
    }
  },

  loadPlayers() {
    try {
      const data = localStorage.getItem(this.KEYS.PLAYERS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveGameResult(result) {
    try {
      const history = this.loadHistory();
      history.push(result);
      if (history.length > 50) history.splice(0, history.length - 50);
      localStorage.setItem(this.KEYS.HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn('存储游戏结果失败', e);
      alert('存储失败，请检查浏览器存储空间。游戏仍可继续。');
    }
  },

  loadHistory() {
    try {
      const data = localStorage.getItem(this.KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  getTotalScores() {
    const history = this.loadHistory();
    const totals = {};
    for (const result of history) {
      for (let i = 0; i < result.players.length; i++) {
        const name = result.players[i];
        totals[name] = (totals[name] || 0) + (result.scoreDeltas[i] || 0);
      }
    }
    return Object.entries(totals).map(([name, totalScore]) => ({ name, totalScore }));
  },

  clearAll() {
    try {
      localStorage.removeItem(this.KEYS.PLAYERS);
      localStorage.removeItem(this.KEYS.HISTORY);
    } catch (e) {
      console.warn('清除数据失败', e);
    }
  }
};

// ===== 手牌排序工具 =====
function sortHand(cards) {
  return cards.slice().sort((a, b) => b.rank - a.rank);
}

// ===== 牌面渲染 =====
function renderCard(card, small = false) {
  const div = document.createElement('div');
  div.className = 'card' + (small ? ' card-sm' : '');

  if (card.suit === 'joker') {
    if (card.rank === 15) {
      div.classList.add('joker-big');
      div.innerHTML = '<span class="card-joker-text">大<br>王</span>';
    } else {
      div.classList.add('joker-small');
      div.innerHTML = '<span class="card-joker-text">小<br>王</span>';
    }
  } else {
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    div.classList.add(isRed ? 'red' : 'black');
    const suitSymbols = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
    const rankNames = { 1:'3',2:'4',3:'5',4:'6',5:'7',6:'8',7:'9',8:'10',9:'J',10:'Q',11:'K',12:'A',13:'2' };
    const rankStr = rankNames[card.rank] || card.rank;
    div.innerHTML = `<span class="card-suit">${suitSymbols[card.suit]}</span><span class="card-rank">${rankStr}</span>`;
  }

  return div;
}

// ===== SetupView 设置界面 =====
const SetupView = {
  init() {
    const form = document.getElementById('setup-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    document.getElementById('btn-leaderboard').addEventListener('click', () => {
      GameApp.showView(GamePhase.LEADERBOARD);
    });
    document.getElementById('btn-history').addEventListener('click', () => {
      GameApp.showView(GamePhase.HISTORY);
    });
  },

  show() {
    // 预填充上次保存的玩家名称
    const saved = StorageManager.loadPlayers();
    const inputs = document.querySelectorAll('.player-name-input');
    inputs.forEach((input, i) => {
      if (saved[i]) input.value = saved[i].name || '';
    });
    this.clearError();
  },

  handleSubmit() {
    const inputs = document.querySelectorAll('.player-name-input');
    const names = [];
    for (const input of inputs) {
      const name = input.value.trim();
      if (!name) {
        this.showError('请填写所有玩家名称');
        return;
      }
      if (name.length > 10) {
        this.showError('玩家名称不能超过10个字符');
        return;
      }
      names.push(name);
    }

    const players = names.map(name => ({ name, totalScore: 0 }));
    StorageManager.savePlayers(players);
    GameApp.startGame(names);
  },

  showError(msg) {
    const el = document.getElementById('setup-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  clearError() {
    document.getElementById('setup-error').classList.add('hidden');
  }
};

// ===== BidView 叫主界面 =====
// 叫主流程：
// 1. 叫主者从任意四花色3-10中选2张牌
// 2. 系统扫描所有手牌，自动判定情形，决定组队模式
// 3. 情形B时向持牌者展示异议选项
// 4. 非主叫者可抢1v5（出牌者仍为叫主者）
const BidView = {
  selectedBidCards: [],
  pendingConfig: null,
  pendingSituation: null,
  grabPlayerIndex: null, // 抢1v5的玩家索引（null表示无人抢）

  BID_RANKS: [
    { name: '3', rank: 1 }, { name: '4', rank: 2 }, { name: '5', rank: 3 },
    { name: '6', rank: 4 }, { name: '7', rank: 5 }, { name: '8', rank: 6 },
    { name: '9', rank: 7 }, { name: '10', rank: 8 }
  ],
  SUITS: [
    { suit: 'spades', symbol: '♠', label: '黑桃' },
    { suit: 'hearts', symbol: '♥', label: '红心' },
    { suit: 'clubs', symbol: '♣', label: '梅花' },
    { suit: 'diamonds', symbol: '♦', label: '方块' }
  ],

  init() {
    document.getElementById('btn-bid-confirm').addEventListener('click', () => this.handleConfirm());
    document.getElementById('btn-bid-objection-yes').addEventListener('click', () => this.handleObjection(true));
    document.getElementById('btn-bid-objection-no').addEventListener('click', () => this.handleObjection(false));
    document.getElementById('btn-bid-grab-confirm').addEventListener('click', () => this.handleGrabConfirm());
    document.getElementById('btn-bid-grab-skip').addEventListener('click', () => this.handleGrabSkip());

    // 抢1v5倍数选择
    document.querySelectorAll('#bid-grab-multiplier-group .btn-multiplier').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#bid-grab-multiplier-group .btn-multiplier').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  },

  show(callerIndex, playerNames) {
    this.selectedBidCards = [];
    this.pendingConfig = null;
    this.pendingSituation = null;
    this.grabPlayerIndex = null;

    this._showStep('select');
    document.getElementById('bid-caller-name').textContent = '叫主者：' + escapeHtml(playerNames[callerIndex]);
    this._renderCallerHand(callerIndex);
    this._renderBidPicker();
    this._updateSelectedInfo();
    this.clearError();
  },

  _renderCallerHand(callerIndex) {
    const container = document.getElementById('bid-caller-hand');
    if (!container) return;
    container.innerHTML = '';
    const hand = sortHand(GameApp.state.hands[callerIndex]);
    for (const card of hand) {
      container.appendChild(renderCard(card, true));
    }
  },

  _showStep(step) {
    document.getElementById('bid-step-select').classList.toggle('hidden', step !== 'select');
    document.getElementById('bid-step-objection').classList.toggle('hidden', step !== 'objection');
    document.getElementById('bid-step-grab').classList.toggle('hidden', step !== 'grab');
  },

  // 渲染叫牌选择器：点数行 × 花色列 的网格
  _renderBidPicker() {
    const container = document.getElementById('bid-picker');
    container.innerHTML = '';

    // 表头：花色
    const headerRow = document.createElement('div');
    headerRow.className = 'bid-picker-row bid-picker-header';
    headerRow.appendChild(this._makeCell('点数', false, 'bid-cell-label'));
    for (const s of this.SUITS) {
      const cell = this._makeCell(s.symbol, false, 'bid-cell-suit');
      cell.classList.add(s.suit === 'hearts' || s.suit === 'diamonds' ? 'red' : 'black');
      headerRow.appendChild(cell);
    }
    container.appendChild(headerRow);

    // 每个点数一行
    for (const r of this.BID_RANKS) {
      const row = document.createElement('div');
      row.className = 'bid-picker-row';

      const labelCell = this._makeCell(r.name, false, 'bid-cell-label');
      row.appendChild(labelCell);

      for (const s of this.SUITS) {
        const card = { suit: s.suit, rank: r.rank, display: r.name + s.symbol };
        const cell = this._makeCell(s.symbol + r.name, true, 'bid-cell');
        cell.classList.add(s.suit === 'hearts' || s.suit === 'diamonds' ? 'red' : 'black');
        cell.addEventListener('click', () => this._toggleBidCell(card, cell));
        row.appendChild(cell);
      }
      container.appendChild(row);
    }
  },

  _makeCell(text, clickable, cls) {
    const el = document.createElement('div');
    el.className = cls || '';
    el.textContent = text;
    if (clickable) el.classList.add('bid-cell-clickable');
    return el;
  },

  _toggleBidCell(card, el) {
    const idx = this.selectedBidCards.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    if (idx !== -1) {
      // 取消选中
      this.selectedBidCards.splice(idx, 1);
      el.classList.remove('selected');
    } else {
      if (this.selectedBidCards.length >= 2) {
        // 已选2张，清空重选
        this.selectedBidCards = [];
        document.querySelectorAll('#bid-picker .bid-cell.selected').forEach(c => c.classList.remove('selected'));
      }
      this.selectedBidCards.push(card);
      el.classList.add('selected');
    }
    this._updateSelectedInfo();
    this.clearError();
  },

  _updateSelectedInfo() {
    const info = document.getElementById('bid-selected-info');
    if (this.selectedBidCards.length === 0) {
      info.textContent = '请选择2张叫牌（点击下方表格中的牌）';
    } else if (this.selectedBidCards.length === 1) {
      info.textContent = `已选：${this.selectedBidCards[0].display}，再选1张`;
    } else {
      info.textContent = `已选：${this.selectedBidCards[0].display} 和 ${this.selectedBidCards[1].display}`;
    }
  },

  handleConfirm() {
    if (this.selectedBidCards.length !== 2) {
      this.showError('请选择2张叫牌');
      return;
    }

    const state = GameApp.state;
    const result = TeamManager.resolveBid(state.callerIndex, this.selectedBidCards, state.hands);
    this.pendingConfig = result.config;
    this.pendingSituation = result.situation;

    // 情形B：某玩家同时持有两张叫牌，由该玩家决定是否提出异议
    if (result.situation === 'B' && result.objectionPlayer !== null) {
      const objPlayerName = state.players[result.objectionPlayer];
      document.getElementById('bid-objection-player').textContent = escapeHtml(objPlayerName);
      document.getElementById('bid-objection-cards').textContent =
        `${this.selectedBidCards[0].display} 和 ${this.selectedBidCards[1].display}`;
      this._showStep('objection');
      return;
    }

    // 叫牌确认后，询问是否有非主叫者要抢1v5
    this._startGrabPhase(result.config);
  },

  // 开始抢1v5阶段：逐个询问非主叫者
  _startGrabPhase(baseConfig) {
    this.pendingConfig = baseConfig;
    const state = GameApp.state;
    // 收集非主叫者列表（按座位顺序）
    this._grabCandidates = [];
    for (let i = 0; i < 6; i++) {
      if (i !== state.callerIndex) this._grabCandidates.push(i);
    }
    this._grabCandidateIdx = 0;
    this._askNextGrab();
  },

  _askNextGrab() {
    const state = GameApp.state;
    if (this._grabCandidateIdx >= this._grabCandidates.length) {
      // 所有人都不抢，使用原始配置
      this._confirmConfig(this.pendingConfig);
      return;
    }
    const playerIdx = this._grabCandidates[this._grabCandidateIdx];
    document.getElementById('bid-grab-player').textContent = escapeHtml(state.players[playerIdx]);
    this._showStep('grab');
  },

  handleGrabConfirm() {
    // 该玩家抢1v5，倍数选择
    const state = GameApp.state;
    const playerIdx = this._grabCandidates[this._grabCandidateIdx];
    const multiplierEl = document.querySelector('#bid-grab-multiplier-group .btn-multiplier.selected');
    const multiplier = multiplierEl ? parseInt(multiplierEl.dataset.value) : 2;
    const grabConfig = {
      mode: '1v5',
      caller: state.callerIndex, // 出牌者仍为叫主者
      grabber: playerIdx,        // 抢主者（积分计算用）
      partners: [],
      multiplier
    };
    this._confirmConfig(grabConfig);
  },

  handleGrabSkip() {
    this._grabCandidateIdx++;
    this._askNextGrab();
  },

  handleObjection(objected) {
    if (objected) {
      this.selectedBidCards = [];
      this.pendingConfig = null;
      this._showStep('select');
      document.querySelectorAll('#bid-picker .bid-cell.selected').forEach(c => c.classList.remove('selected'));
      this._updateSelectedInfo();
      this.showError('请重新选择叫牌');
    } else {
      this._startGrabPhase(this.pendingConfig);
    }
  },

  _confirmConfig(config) {
    TeamManager.setConfig(config);
    GameApp.state.bidCards = this.selectedBidCards.slice();
    GameApp.startPlaying();
  },

  showError(msg) {
    const el = document.getElementById('bid-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  clearError() {
    document.getElementById('bid-error').classList.add('hidden');
  }
};

// ===== PlayView 出牌界面 =====
const PlayView = {
  selectedCards: [],

  init() {
    document.getElementById('btn-play').addEventListener('click', () => this.handlePlay());
    document.getElementById('btn-pass').addEventListener('click', () => this.handlePass());
  },

  show() {
    this.selectedCards = [];
    this.render();
  },

  render() {
    const state = GameApp.state;
    const currentPlayer = RoundManager.getCurrentPlayer();
    const playerName = state.players[currentPlayer];
    const hand = sortHand(RoundManager.hands[currentPlayer]);
    const rankings = RoundManager.getRankings();

    // 当前玩家信息
    document.getElementById('play-current-player').textContent = '当前：' + escapeHtml(playerName);

    // 轮次信息
    const leadPlay = RoundManager.trickState.leadPlay;
    const trickInfo = leadPlay
      ? `领先：${this._playTypeLabel(leadPlay.type)}`
      : '新一轮（自由出牌）';
    document.getElementById('play-trick-info').textContent = trickInfo;

    // 叫牌信息（只显示叫的两张牌，不显示谁持有）
    const bidInfoEl = document.getElementById('play-bid-info');
    if (bidInfoEl && state.bidCards && state.bidCards.length === 2) {
      bidInfoEl.textContent = `叫牌：${state.bidCards[0].display} 和 ${state.bidCards[1].display}`;
    }

    // 名次栏
    const rankBar = document.getElementById('rankings-bar');
    rankBar.innerHTML = '';
    if (rankings.length > 0) {
      const label = document.createElement('span');
      label.style.color = 'var(--color-text-muted)';
      label.style.fontSize = '11px';
      label.textContent = '已完成：';
      rankBar.appendChild(label);
      rankings.forEach((pi, idx) => {
        const badge = document.createElement('span');
        badge.className = `rank-badge rank-${idx + 1}`;
        badge.textContent = `第${idx + 1}名: ${escapeHtml(state.players[pi])}`;
        rankBar.appendChild(badge);
      });
    }

    // 本轮出牌区
    this._renderTrickPlays();

    // 手牌
    this._renderHand(hand);

    // 手牌数量
    document.getElementById('hand-count').textContent = `(${hand.length}张)`;

    this.clearError();
  },

  _renderTrickPlays() {
    const container = document.getElementById('trick-plays');
    container.innerHTML = '';
    const plays = RoundManager.trickState.plays;
    const state = GameApp.state;

    for (const tp of plays) {
      const row = document.createElement('div');
      row.className = 'trick-play-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'trick-play-name';
      nameEl.textContent = escapeHtml(state.players[tp.playerIndex]);
      row.appendChild(nameEl);

      if (tp.play === null) {
        const passEl = document.createElement('span');
        passEl.className = 'trick-play-pass';
        passEl.textContent = 'Pass';
        row.appendChild(passEl);
      } else {
        const cardsEl = document.createElement('div');
        cardsEl.className = 'trick-play-cards';
        for (const card of tp.play.cards) {
          cardsEl.appendChild(renderCard(card, true));
        }
        row.appendChild(cardsEl);
      }

      container.appendChild(row);
    }
  },

  _renderHand(hand) {
    const container = document.getElementById('hand-cards');
    container.innerHTML = '';
    this.selectedCards = this.selectedCards.filter(sc =>
      hand.some(c => c.suit === sc.suit && c.rank === sc.rank)
    );

    for (const card of hand) {
      const cardEl = renderCard(card, false);
      const isSelected = this.selectedCards.some(sc => sc.suit === card.suit && sc.rank === card.rank);
      if (isSelected) cardEl.classList.add('selected');

      cardEl.addEventListener('click', () => this.toggleCard(card, cardEl));
      container.appendChild(cardEl);
    }
  },

  toggleCard(card, el) {
    const idx = this.selectedCards.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    if (idx !== -1) {
      this.selectedCards.splice(idx, 1);
      el.classList.remove('selected');
    } else {
      this.selectedCards.push(card);
      el.classList.add('selected');
    }
    this.clearError();
  },

  handlePlay() {
    if (this.selectedCards.length === 0) {
      this.showError('请先选择要出的牌');
      return;
    }

    const currentPlayer = RoundManager.getCurrentPlayer();
    const result = RoundManager.playCards(currentPlayer, this.selectedCards);

    if (!result.success) {
      this.showError(result.error);
      return;
    }

    this.selectedCards = [];

    if (result.gameOver || RoundManager.gameOver) {
      GameApp.endGame();
      return;
    }

    this.render();
  },

  handlePass() {
    const currentPlayer = RoundManager.getCurrentPlayer();
    const result = RoundManager.pass(currentPlayer);

    if (!result.success) {
      this.showError(result.error);
      return;
    }

    this.selectedCards = [];

    if (result.gameOver || RoundManager.gameOver) {
      GameApp.endGame();
      return;
    }

    this.render();
  },

  _playTypeLabel(type) {
    const labels = {
      single: '单张', pair: '对子', triple: '三张',
      straight: '顺子', flush: '同花式', flush_straight: '同花顺',
      full_house: '三带二', four_of_a_kind: '四打一'
    };
    return labels[type] || type;
  },

  showError(msg) {
    const el = document.getElementById('play-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  clearError() {
    document.getElementById('play-error').classList.add('hidden');
  }
};

// ===== ResultView 结算界面 =====
const ResultView = {
  init() {
    document.getElementById('btn-play-again').addEventListener('click', () => {
      GameApp.playAgain();
    });
  },

  show(rankings, teamConfig, scoreDeltas, players) {
    // 模式标签
    const modeLabels = { '1v5': '1v5 单挑', '2v4': '2v4 双打', '3v3': '3v3 对决' };
    document.getElementById('result-mode').textContent = modeLabels[teamConfig.mode] || teamConfig.mode;

    // 名次列表
    const rankingsEl = document.getElementById('result-rankings');
    rankingsEl.innerHTML = '<h3>名次结果</h3>';
    rankings.forEach((playerIdx, rank) => {
      const row = document.createElement('div');
      row.className = 'ranking-row';

      const numEl = document.createElement('div');
      numEl.className = `ranking-num rank-${rank + 1}`;
      numEl.textContent = rank + 1;

      const nameEl = document.createElement('div');
      nameEl.className = 'ranking-name';
      nameEl.textContent = escapeHtml(players[playerIdx]);

      const team = TeamManager.getTeam(playerIdx);
      const teamEl = document.createElement('div');
      teamEl.className = `ranking-team team-${team.toLowerCase()}`;
      teamEl.textContent = '队' + team;

      row.appendChild(numEl);
      row.appendChild(nameEl);
      row.appendChild(teamEl);
      rankingsEl.appendChild(row);
    });

    // 积分变化
    const scoresEl = document.getElementById('result-scores');
    scoresEl.innerHTML = '<h3>积分变化</h3>';

    // 获取历史总分（保存前）
    const history = StorageManager.loadHistory();
    const prevTotals = {};
    for (const result of history) {
      for (let i = 0; i < result.players.length; i++) {
        const name = result.players[i];
        prevTotals[name] = (prevTotals[name] || 0) + (result.scoreDeltas[i] || 0);
      }
    }

    players.forEach((name, i) => {
      const delta = scoreDeltas[i];
      const prevTotal = prevTotals[name] || 0;
      const newTotal = prevTotal + delta;

      const row = document.createElement('div');
      row.className = 'score-row';

      const nameEl = document.createElement('div');
      nameEl.className = 'score-name';
      nameEl.textContent = escapeHtml(name);

      const deltaEl = document.createElement('div');
      deltaEl.className = 'score-delta ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero');
      deltaEl.textContent = (delta > 0 ? '+' : '') + delta;

      const totalEl = document.createElement('div');
      totalEl.className = 'score-total';
      totalEl.textContent = '累计：' + newTotal;

      row.appendChild(nameEl);
      row.appendChild(deltaEl);
      row.appendChild(totalEl);
      scoresEl.appendChild(row);
    });
  }
};

// ===== LeaderboardView 排行榜界面 =====
const LeaderboardView = {
  init() {
    document.getElementById('btn-leaderboard-back').addEventListener('click', () => {
      GameApp.showView(GamePhase.SETUP);
    });
    document.getElementById('btn-clear-data').addEventListener('click', () => {
      if (confirm('确定要清除所有数据吗？此操作不可撤销。')) {
        StorageManager.clearAll();
        this.render();
      }
    });
  },

  show() {
    this.render();
  },

  render() {
    const scores = StorageManager.getTotalScores();
    const listEl = document.getElementById('leaderboard-list');
    const emptyEl = document.getElementById('leaderboard-empty');

    listEl.innerHTML = '';

    if (scores.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    scores.sort((a, b) => b.totalScore - a.totalScore);

    scores.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';

      const rankEl = document.createElement('div');
      rankEl.className = `lb-rank rank-${idx + 1}`;
      rankEl.textContent = idx + 1;

      const nameEl = document.createElement('div');
      nameEl.className = 'lb-name';
      nameEl.textContent = escapeHtml(item.name);

      const scoreEl = document.createElement('div');
      scoreEl.className = 'lb-score ' + (item.totalScore > 0 ? 'positive' : item.totalScore < 0 ? 'negative' : 'zero');
      scoreEl.textContent = (item.totalScore > 0 ? '+' : '') + item.totalScore;

      row.appendChild(rankEl);
      row.appendChild(nameEl);
      row.appendChild(scoreEl);
      listEl.appendChild(row);
    });
  }
};

// ===== HistoryView 历史记录界面 =====
const HistoryView = {
  init() {
    document.getElementById('btn-history-back').addEventListener('click', () => {
      GameApp.showView(GamePhase.SETUP);
    });
  },

  show() {
    this.render();
  },

  render() {
    const history = StorageManager.loadHistory();
    const listEl = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');

    listEl.innerHTML = '';

    if (history.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    // 按时间倒序
    const sorted = history.slice().sort((a, b) => b.timestamp - a.timestamp);

    for (const result of sorted) {
      const item = document.createElement('div');
      item.className = 'history-item';

      // 头部：时间 + 模式
      const header = document.createElement('div');
      header.className = 'history-header';

      const timeEl = document.createElement('span');
      timeEl.className = 'history-time';
      timeEl.textContent = this._formatTime(result.timestamp);

      const modeEl = document.createElement('span');
      modeEl.className = 'history-mode';
      modeEl.textContent = result.teamConfig.mode;

      header.appendChild(timeEl);
      header.appendChild(modeEl);
      item.appendChild(header);

      // 名次结果
      const rankingsEl = document.createElement('div');
      rankingsEl.className = 'history-rankings';
      const rankStr = result.rankings.map((pi, idx) =>
        `第${idx + 1}名: ${escapeHtml(result.players[pi])}`
      ).join(' | ');
      rankingsEl.textContent = rankStr;
      item.appendChild(rankingsEl);

      // 积分变化
      const scoresEl = document.createElement('div');
      scoresEl.className = 'history-scores';
      result.players.forEach((name, i) => {
        const delta = result.scoreDeltas[i];
        const span = document.createElement('span');
        span.className = 'history-score-item ' + (delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero');
        span.textContent = escapeHtml(name) + ': ' + (delta > 0 ? '+' : '') + delta;
        scoresEl.appendChild(span);
      });
      item.appendChild(scoresEl);

      listEl.appendChild(item);
    }
  },

  _formatTime(timestamp) {
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
};

// ===== GameApp 主控制器 =====
const GameApp = {
  /** @type {GameState} */
  state: {
    phase: GamePhase.SETUP,
    players: [],
    callerIndex: 0,
    hands: [],
    teamConfig: null
  },

  init() {
    SetupView.init();
    BidView.init();
    PlayView.init();
    ResultView.init();
    LeaderboardView.init();
    HistoryView.init();
    this.showView(GamePhase.SETUP);
  },

  showView(phase) {
    this.state.phase = phase;
    const viewMap = {
      [GamePhase.SETUP]: 'setup-view',
      [GamePhase.BIDDING]: 'bid-view',
      [GamePhase.PLAYING]: 'play-view',
      [GamePhase.RESULT]: 'result-view',
      [GamePhase.LEADERBOARD]: 'leaderboard-view',
      [GamePhase.HISTORY]: 'history-view'
    };

    document.querySelectorAll('.view').forEach(v => {
      v.classList.add('hidden');
      v.classList.remove('active');
    });

    const viewId = viewMap[phase];
    if (viewId) {
      const el = document.getElementById(viewId);
      el.classList.remove('hidden');
      el.classList.add('active');
    }

    // 触发各视图的show方法
    if (phase === GamePhase.SETUP) SetupView.show();
    if (phase === GamePhase.LEADERBOARD) LeaderboardView.show();
    if (phase === GamePhase.HISTORY) HistoryView.show();
  },

  startGame(playerNames) {
    this.state.players = playerNames;

    // 洗牌发牌
    const deck = DeckManager.createDeck();
    const shuffled = DeckManager.shuffle(deck);
    const hands = DeckManager.deal(shuffled, 6, 9);
    this.state.hands = hands;

    // 确定叫主者：第一局持♦3（suit=diamonds, rank=1）的玩家；后续局由上局头游决定
    // 这里简化：每局都找♦3持有者（若无历史则默认0）
    let callerIndex = 0;
    const diamond3 = { suit: 'diamonds', rank: 1 }; // ♦3 rank=1
    for (let i = 0; i < hands.length; i++) {
      if (hands[i].some(c => c.suit === diamond3.suit && c.rank === diamond3.rank)) {
        callerIndex = i;
        break;
      }
    }
    // 若有上局头游记录，后续局用头游作为叫主者
    if (this.state.lastWinner !== undefined && this.state.lastWinner !== null) {
      callerIndex = this.state.lastWinner;
    }
    this.state.callerIndex = callerIndex;

    TeamManager.reset();

    // 进入叫主阶段
    this.state.phase = GamePhase.BIDDING;
    this.showView(GamePhase.BIDDING);
    BidView.show(callerIndex, playerNames);
  },

  startPlaying() {
    const config = TeamManager.getConfig();
    this.state.teamConfig = config;

    // 叫主者先出牌
    RoundManager.startGame(this.state.hands, this.state.callerIndex);

    this.showView(GamePhase.PLAYING);
    PlayView.show();
  },

  endGame() {
    const rankings = RoundManager.getRankings();
    const config = TeamManager.getConfig();
    const scoreDeltas = ScoreCalculator.calculate(rankings, config);
    const players = this.state.players;

    // 记录头游（第1名）作为下局叫主者
    this.state.lastWinner = rankings[0];

    // 保存结果
    const result = {
      timestamp: Date.now(),
      players: players.slice(),
      rankings: rankings.slice(),
      teamConfig: config,
      scoreDeltas: scoreDeltas.slice()
    };
    StorageManager.saveGameResult(result);

    this.showView(GamePhase.RESULT);
    ResultView.show(rankings, config, scoreDeltas, players);
  },

  playAgain() {
    // 保留玩家名称和头游记录，重置游戏状态
    TeamManager.reset();
    this.showView(GamePhase.SETUP);
  }
};

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', () => {
  GameApp.init();
});
