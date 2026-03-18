'use strict';

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ===== 游戏常量 =====
const RANK_MAP = {
  '3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,
  'J':9,'Q':10,'K':11,'A':12,'2':13,'小王':14,'大王':15
};
const SUIT_RANK = { diamonds:1, clubs:2, hearts:3, spades:4, joker:5 };
const BASE_SCORES = [6,5,4,3,2,1];

const CardType = {
  SINGLE:'single', PAIR:'pair', TRIPLE:'triple',
  STRAIGHT:'straight', FLUSH:'flush', FLUSH_STRAIGHT:'flush_straight',
  FULL_HOUSE:'full_house', FOUR_OF_A_KIND:'four_of_a_kind'
};

// ===== 房间管理 =====
const rooms = new Map(); // roomCode -> Room

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ===== 牌组工具 =====
function createDeck() {
  const suits = ['spades','hearts','clubs','diamonds'];
  const suitSymbols = {spades:'♠',hearts:'♥',clubs:'♣',diamonds:'♦'};
  const rankNames = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const deck = [];
  for (const suit of suits) {
    for (const rn of rankNames) {
      deck.push({ suit, rank: RANK_MAP[rn], display: rn + suitSymbols[suit] });
    }
  }
  deck.push({ suit:'joker', rank:14, display:'小王' });
  deck.push({ suit:'joker', rank:15, display:'大王' });
  return deck;
}

function shuffle(deck) {
  const d = deck.slice();
  for (let i = d.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [d[i],d[j]] = [d[j],d[i]];
  }
  return d;
}

// ===== 牌型验证 =====
function getCardScore(card) {
  return card.rank * 10 + (SUIT_RANK[card.suit] || 0);
}

function getTopCard(cards) {
  return cards.reduce((best,c) => getCardScore(c) > getCardScore(best) ? c : best);
}

function isStraight(cards) {
  const ranks = cards.map(c => c.rank).sort((a,b) => a-b);
  if (new Set(ranks).size !== 5) return false;
  if (ranks[4] - ranks[0] === 4) return true;
  // A-low: A(12)+2(13)+3(1)+4(2)+5(3) => sorted [1,2,3,12,13]
  if (ranks[0]===1 && ranks[1]===2 && ranks[2]===3 && ranks[3]===12 && ranks[4]===13) return true;
  return false;
}

function straightTopRank(cards) {
  const ranks = cards.map(c => c.rank).sort((a,b) => a-b);
  if (ranks[0]===1 && ranks[1]===2 && ranks[2]===3 && ranks[3]===12 && ranks[4]===13) return 3;
  return ranks[4];
}

function getCardType(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  if (n === 1) return CardType.SINGLE;
  if (n === 2) {
    if (cards[0].rank === cards[1].rank) return CardType.PAIR;
    const ranks = [cards[0].rank, cards[1].rank].sort((a,b)=>a-b);
    if (ranks[0]===14 && ranks[1]===15) return CardType.PAIR;
    return null;
  }
  if (n === 3) {
    if (cards[0].rank===cards[1].rank && cards[1].rank===cards[2].rank) return CardType.TRIPLE;
    return null;
  }
  if (n === 5) {
    const rankCount = {};
    for (const c of cards) rankCount[c.rank] = (rankCount[c.rank]||0)+1;
    const counts = Object.values(rankCount).sort((a,b)=>b-a);
    if (counts[0]===4 && counts[1]===1) return CardType.FOUR_OF_A_KIND;
    if (counts[0]===3 && counts[1]===2) return CardType.FULL_HOUSE;
    if (cards.some(c=>c.suit==='joker')) return null;
    const sameSuit = cards.every(c=>c.suit===cards[0].suit);
    const consecutive = isStraight(cards);
    if (sameSuit && consecutive) return CardType.FLUSH_STRAIGHT;
    if (consecutive) return CardType.STRAIGHT;
    if (sameSuit) return CardType.FLUSH;
    return null;
  }
  return null;
}

function getPlayValue(cards, type) {
  const t = type || getCardType(cards);
  if (t === CardType.STRAIGHT || t === CardType.FLUSH_STRAIGHT) {
    const topRank = straightTopRank(cards);
    const topCards = cards.filter(c => c.rank === topRank);
    return getCardScore(getTopCard(topCards.length > 0 ? topCards : cards));
  }
  if (t === CardType.FULL_HOUSE) {
    const rc = {};
    for (const c of cards) rc[c.rank] = (rc[c.rank]||0)+1;
    const tr = Number(Object.keys(rc).find(r=>rc[r]===3));
    return getCardScore(getTopCard(cards.filter(c=>c.rank===tr)));
  }
  if (t === CardType.FOUR_OF_A_KIND) {
    const rc = {};
    for (const c of cards) rc[c.rank] = (rc[c.rank]||0)+1;
    const qr = Number(Object.keys(rc).find(r=>rc[r]===4));
    return getCardScore(getTopCard(cards.filter(c=>c.rank===qr)));
  }
  return getCardScore(getTopCard(cards));
}

function buildPlay(cards) {
  const type = getCardType(cards);
  if (!type) return null;
  return { cards: cards.slice(), type, value: getPlayValue(cards, type) };
}

function comparePlay(a, b) {
  const smallTypes = new Set([CardType.SINGLE, CardType.PAIR, CardType.TRIPLE]);
  if (smallTypes.has(a.type) || smallTypes.has(b.type)) {
    if (a.type !== b.type) return 0;
    return a.value - b.value;
  }
  const level = {
    [CardType.STRAIGHT]:1, [CardType.FLUSH]:2, [CardType.FULL_HOUSE]:3,
    [CardType.FOUR_OF_A_KIND]:4, [CardType.FLUSH_STRAIGHT]:5
  };
  const la = level[a.type]??0, lb = level[b.type]??0;
  if (la !== lb) return la - lb;
  return a.value - b.value;
}

// ===== 积分计算 =====
function calcScore(rankings, config) {
  if (config.mode === '3v3') return calc3v3(rankings, config);
  if (config.mode === '2v4') return calc2v4(rankings, config);
  if (config.mode === '1v5') return calc1v5(rankings, config);
  return new Array(6).fill(0);
}

function calc3v3(rankings, config) {
  const teamA = new Set([config.caller, ...config.partners]);
  let sA=0, sB=0;
  for (let i=0;i<6;i++) {
    if (teamA.has(rankings[i])) sA += BASE_SCORES[i];
    else sB += BASE_SCORES[i];
  }
  const diff = sA - sB;
  return Array.from({length:6},(_,p) => teamA.has(p) ? diff : -diff);
}

function calc2v4(rankings, config) {
  // 规则：两人组和4人组各占3个名次位置
  // 两人组最高者吃掉连续两个名次（topPos + topPos+1），另一人占1个位置
  // 4人组按名次取前3名位置
  // diff = 两人组总分 - 4人组总分，两人组每人 diff×2，4人组每人 -diff
  const team2 = new Set([config.caller, ...config.partners]);

  // 找两人组中名次最高者
  let topPos = -1, topPlayer = -1;
  for (let i = 0; i < 6; i++) {
    if (team2.has(rankings[i])) { topPos = i; topPlayer = rankings[i]; break; }
  }

  // 两人组最高者吃掉 topPos 和 topPos+1 两个名次
  const eatA = topPos;
  const eatB = topPos + 1; // 若 topPos=5 则 eatB=6，超出范围得0
  const topScore = BASE_SCORES[eatA] + (eatB < 6 ? BASE_SCORES[eatB] : 0);

  // 其余5人跳过 eatA 和 eatB，按名次顺序依次取剩余积分
  const playerScore = {};
  playerScore[topPlayer] = topScore;

  let scoreIdx = 0;
  for (let i = 0; i < 6; i++) {
    const player = rankings[i];
    if (player === topPlayer) continue;
    while (scoreIdx === eatA || scoreIdx === eatB) scoreIdx++;
    playerScore[player] = scoreIdx < 6 ? BASE_SCORES[scoreIdx] : 0;
    scoreIdx++;
  }

  // 两人组总分（2个人，共3个位置）
  let score2 = 0;
  for (const p of team2) score2 += playerScore[p] || 0;

  // 4人组：按名次排序，取前3名积分（共3个位置）
  const team4 = Array.from({length:6}, (_, i) => i).filter(p => !team2.has(p));
  const team4sorted = team4.slice().sort((a, b) => rankings.indexOf(a) - rankings.indexOf(b));
  let score4 = 0;
  for (let i = 0; i < Math.min(3, team4sorted.length); i++) {
    score4 += playerScore[team4sorted[i]] || 0;
  }

  const diff = score2 - score4;
  return Array.from({length:6}, (_, p) => team2.has(p) ? diff * 2 : -diff);
}

function calc1v5(rankings, config) {
  const m = config.multiplier || 2;
  const scorePlayer = config.grabber !== undefined ? config.grabber : config.caller; // 积分单人方
  const diff = 9; // 15-6=9 固定差值
  const deltas = new Array(6).fill(0);
  if (rankings[0] === scorePlayer) {
    // 单人方胜：单人方得 9*m*5，五人组每人 -9*m
    deltas[scorePlayer] = diff * m * 5;
    for (let p = 0; p < 6; p++) if (p !== scorePlayer) deltas[p] = -(diff * m);
  } else {
    // 五人组胜：单人方 -9*m*5，五人组每人 +9*m
    deltas[scorePlayer] = -(diff * m * 5);
    for (let p = 0; p < 6; p++) if (p !== scorePlayer) deltas[p] = diff * m;
  }
  return deltas;
}

// ===== Room 类 =====
class Room {
  constructor(code) {
    this.code = code;
    this.players = new Array(6).fill(null);
    this.phase = 'waiting';
    this.hands = [];
    this.callerIndex = 0;
    this.teamConfig = null;
    this.bidCards = [];
    this.trickState = null;
    this.rankings = [];
    this.gameOver = false;
    this.lastWinner = null;
    this.history = [];
    this.totalScores = new Array(6).fill(0); // 各座位累计积分
    this.isEverFirstGame = true; // 是否从未清空过（用于♦3限制）
    // 抢1v5状态
    this.grabCandidates = [];
    this.grabCandidateIdx = 0;
    this.pendingConfig = null;
    // AI座位标记：seat -> true（只标记是否AI，不存Key）
    this.aiSeats = new Set();
  }

  getPlayerCount() {
    return this.players.filter(p => p !== null).length;
  }

  isFull() {
    return this.getPlayerCount() === 6;
  }

  getFreeSeat() {
    return this.players.findIndex(p => p === null);
  }

  broadcast(msg, excludeWs = null) {
    const str = JSON.stringify(msg);
    for (const p of this.players) {
      if (p && p.ws && p.ws.readyState === 1 && p.ws !== excludeWs) {
        p.ws.send(str);
      }
    }
  }

  sendTo(seatIndex, msg) {
    const p = this.players[seatIndex];
    if (p && p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(msg));
    }
  }

  // 发送给所有人，但手牌只发自己的
  broadcastState() {
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      if (!p || !p.ws || p.ws.readyState !== 1) continue; // 跳过AI虚拟玩家
      p.ws.send(JSON.stringify(this._buildStateFor(i)));
    }
  }

  _buildStateFor(seatIndex) {
    // 主攻方：抢了1v5用grabber，否则用caller
    const attackerIndex = (this.teamConfig && this.teamConfig.grabber !== undefined)
      ? this.teamConfig.grabber
      : this.callerIndex;
    // 房主（seat=0）额外获取所有AI座位的手牌，用于驱动AI出牌（包括座位0自己）
    const aiHands = {};
    if (seatIndex === 0 && this.aiSeats.size > 0) {
      for (const aiSeat of this.aiSeats) {
        if (this.hands[aiSeat]) {
          aiHands[aiSeat] = this.hands[aiSeat];
        }
      }
    }
    return {
      type: 'state',
      phase: this.phase,
      players: this.players.map(p => p ? { name: p.name, connected: p.connected } : null),
      mySeat: seatIndex,
      myHand: this.hands[seatIndex] || [],
      handCounts: this.hands.map(h => h ? h.length : 0),
      callerIndex: this.callerIndex,
      attackerIndex,
      teamConfig: this.teamConfig,
      bidCards: this.bidCards,
      bidSituation: this.bidSituation || null,
      // D2（2倍不公示）时，非叫主者看不到情形和倍数
      visibleSituation: (this.bidSituation === 'D2' && seatIndex !== this.callerIndex) ? null : (this.bidSituation || null),
      pendingConfig: this.pendingConfig || null,
      objectionPlayer: this.objectionPlayer ?? null,
      trickState: this.trickState ? {
        leadPlay: this.trickState.leadPlay,
        plays: this.trickState.plays,
        currentPlayer: this.trickState.currentPlayer,
        passCount: this.trickState.passCount
      } : null,
      rankings: this.rankings,
      gameOver: this.gameOver,
      isFirstGame: this.isFirstGame,
      totalScores: this.totalScores,
      aiSeats: [...this.aiSeats],
      aiHands: Object.keys(aiHands).length > 0 ? aiHands : undefined,
      grabPhase: this.phase === 'grab' ? {
        currentCandidate: this.grabCandidates[this.grabCandidateIdx],
        pendingConfig: this.pendingConfig
      } : null
    };
  }

  startGame() {
    const deck = shuffle(createDeck());
    this.hands = Array.from({length:6}, (_,i) => deck.slice(i*9,(i+1)*9));
    this.rankings = [];
    this.gameOver = false;
    this.teamConfig = null;
    this.bidCards = [];
    // 第一局标记：只有从未开始过（lastWinner===null 且 isEverFirstGame）才限制♦3
    this.isFirstGame = (this.lastWinner === null && this.isEverFirstGame);
    if (this.isFirstGame) this.isEverFirstGame = false; // 第一局开始后清除标记
    // 确定叫主者
    let callerIndex = 0;
    if (this.lastWinner !== null) {
      callerIndex = this.lastWinner;
    } else {
      for (let i=0;i<6;i++) {
        if (this.hands[i].some(c=>c.suit==='diamonds'&&c.rank===1)) { callerIndex=i; break; }
      }
    }
    this.callerIndex = callerIndex;
    this.phase = 'bidding';
    this.broadcastState();
  }

  resolveBid(callerIndex, bidCards) {
    const card1=bidCards[0], card2=bidCards[1];
    const holders1=[], holders2=[];
    let cHas1=false, cHas2=false;
    for (let i=0;i<6;i++) {
      const h1 = this.hands[i].some(c=>c.suit===card1.suit&&c.rank===card1.rank);
      const h2 = this.hands[i].some(c=>c.suit===card2.suit&&c.rank===card2.rank);
      if (i===callerIndex) { cHas1=h1; cHas2=h2; }
      else { if(h1) holders1.push(i); if(h2) holders2.push(i); }
    }
    if (cHas1&&cHas2) return { situation:'D', config:{mode:'1v5',caller:callerIndex,partners:[],multiplier:null}, objectionPlayer:null };
    if (cHas1&&holders2.length>0) return { situation:'C', config:{mode:'2v4',caller:callerIndex,partners:[holders2[0]]}, objectionPlayer:null };
    if (cHas2&&holders1.length>0) return { situation:'C', config:{mode:'2v4',caller:callerIndex,partners:[holders1[0]]}, objectionPlayer:null };
    const both = holders1.find(p=>holders2.includes(p));
    if (both!==undefined) return { situation:'B', config:{mode:'2v4',caller:callerIndex,partners:[both]}, objectionPlayer:both };
    if (holders1.length>0&&holders2.length>0) return { situation:'A', config:{mode:'3v3',caller:callerIndex,partners:[holders1[0],holders2[0]]}, objectionPlayer:null };
    return { situation:'D', config:{mode:'1v5',caller:callerIndex,partners:[],multiplier:null}, objectionPlayer:null };
  }

  // 叫主者选好牌后，广播给所有人显示，然后进入确认阶段
  startBidReveal(bidCards) {
    const result = this.resolveBid(this.callerIndex, bidCards);
    this.bidCards = bidCards;
    this.pendingConfig = result.config;
    this.bidSituation = result.situation;
    this.objectionPlayer = null;

    if (result.situation === 'B') {
      this.objectionPlayer = result.objectionPlayer;
      this.phase = 'bid_reveal';
    } else if (result.situation === 'D') {
      // 情形D：叫主者持两张，需先选2倍（不公示）或3倍（公示1v5）
      this.phase = 'bid_d_multiplier';
    } else {
      this._initGrab();
    }
    this.broadcastState();
  }

  // 情形D：叫主者选择倍数
  handleDMultiplier(multiplier) {
    this.pendingConfig.multiplier = multiplier;
    if (multiplier === 3) {
      // 3倍：公示1v5，然后走抢主流程
      this.bidSituation = 'D3'; // 标记为公示
    } else {
      // 2倍：不公示，直接走抢主流程（其他人不知道是1v5）
      this.bidSituation = 'D2'; // 标记为不公示
    }
    this._initGrab();
    this.broadcastState();
  }

  // 异议确认后进入抢主或直接开始
  afterObjection(objected) {
    if (objected) {
      this.phase = 'bidding';
      this.bidCards = [];
      this.pendingConfig = null;
      this.bidSituation = null;
      this.objectionPlayer = null;
    } else {
      // 不异议，进入抢主流程
      this._initGrab();
    }
    this.broadcastState();
  }

  _initGrab() {
    // 从叫主者下一位开始，顺时针排列
    const candidates = [];
    for (let i = 1; i <= 5; i++) {
      candidates.push((this.callerIndex + i) % 6);
    }
    this.grabCandidates = candidates;
    this.grabCandidateIdx = 0;
    this.grabResponses = {};
    this.phase = 'grab';
  }

  startGrabPhase(baseConfig) {
    this.pendingConfig = baseConfig;
    this._initGrab();
    this.broadcastState();
  }

  handleGrab(playerSeat, multiplier) {
    // 抢到1v5，无论原来是什么情形都变成1v5
    const config = {
      mode:'1v5', caller:this.callerIndex,
      grabber:playerSeat, partners:[], multiplier
    };
    this.teamConfig = config;
    this._startPlaying();
  }

  handleGrabSkip() {
    this.grabCandidateIdx++;
    if (this.grabCandidateIdx >= this.grabCandidates.length) {
      // 所有人都跳过，用原始叫牌结果
      this.teamConfig = this.pendingConfig;
      this.phase = 'bid_confirmed';
      this.broadcastState();
    } else {
      this.broadcastState();
    }
  }

  _startPlaying() {
    this.phase = 'playing';
    this.firstTrickDone = false; // 第一手牌是否已出完
    this.trickState = {
      leadPlay: null, plays: [], currentPlayer: this.callerIndex, passCount: 0
    };
    this.broadcastState();
  }

  playCards(seatIndex, cards) {
    if (seatIndex !== this.trickState.currentPlayer) return { success:false, error:'不是你的回合' };
    const hand = this.hands[seatIndex];
    for (const card of cards) {
      if (!hand.some(c=>c.suit===card.suit&&c.rank===card.rank)) return { success:false, error:'出的牌不在手牌中' };
    }
    const play = buildPlay(cards);
    if (!play) return { success:false, error:'非法牌型' };

    // 第一局第一手：必须包含♦3（suit=diamonds, rank=1）
    if (this.isFirstGame && !this.firstTrickDone && this.trickState.leadPlay === null) {
      const hasDiamond3 = cards.some(c => c.suit === 'diamonds' && c.rank === 1);
      if (!hasDiamond3) return { success:false, error:'第一局第一手必须出含♦3的牌' };
    }

    if (this.trickState.leadPlay && comparePlay(play, this.trickState.leadPlay) <= 0) {
      return { success:false, error:'必须出比当前领先牌更大的同牌型，或选择Pass' };
    }

    // 下家只剩1张牌时的单牌限制（无论自由出牌还是跟牌均生效）：
    // 当前玩家出单牌必须出手中最大的单牌
    if (play.type === 'single') {
      const nextPlayer = this._getNextActivePlayer(seatIndex);
      if (nextPlayer !== -1 && this.hands[nextPlayer].length === 1) {
        const maxCard = hand.reduce((best, c) => getCardScore(c) > getCardScore(best) ? c : best);
        if (getCardScore(cards[0]) < getCardScore(maxCard)) {
          return { success:false, error:`下家只剩1张牌，出单牌必须出最大的（${maxCard.display}）` };
        }
      }
    }
    // 移除手牌
    const newHand = hand.slice();
    for (const card of cards) {
      const idx = newHand.findIndex(c=>c.suit===card.suit&&c.rank===card.rank);
      newHand.splice(idx,1);
    }
    this.hands[seatIndex] = newHand;
    this.trickState.plays.push({ playerIndex:seatIndex, play });
    this.trickState.leadPlay = play;
    this.trickState.passCount = 0;
    // 第一局第一手出完后标记，直接关闭限制
    if (this.isFirstGame && !this.firstTrickDone) {
      this.firstTrickDone = true;
      this.isFirstGame = false; // 第一手出完，后续不再限制
    }
    if (newHand.length === 0) this.rankings.push(seatIndex);
    if (this.rankings.length >= 6) { this.gameOver=true; this._endGame(); return { success:true }; }
    if (newHand.length===0 && this._checkTeamWin()) { this._endGame(); return { success:true }; }
    const remaining = this.hands.filter(h=>h.length>0);
    if (remaining.length===1) {
      this.rankings.push(this.hands.findIndex(h=>h.length>0));
      this.gameOver=true; this._endGame(); return { success:true };
    }
    this._advanceToNextPlayer(seatIndex);
    this.broadcastState();
    return { success:true };
  }

  pass(seatIndex) {
    if (seatIndex !== this.trickState.currentPlayer) return { success:false, error:'不是你的回合' };
    if (!this.trickState.leadPlay) return { success:false, error:'本轮第一个出牌不能Pass' };
    // 下家只剩1张牌时的Pass限制：
    // 当前轮是单牌，且手中最大单牌能打过领先牌，则不能Pass（必须出最大单牌拦截）
    // 只有手中所有牌都打不过领先牌时才允许Pass
    if (this.trickState.leadPlay.type === 'single') {
      const nextPlayer = this._getNextActivePlayer(seatIndex);
      if (nextPlayer !== -1 && this.hands[nextPlayer].length === 1) {
        const hand = this.hands[seatIndex];
        const canBeat = hand.some(c => getCardScore(c) > this.trickState.leadPlay.value);
        if (canBeat) return { success:false, error:'下家只剩1张牌，你有能打过的单牌，必须出最大单牌拦截，不能Pass' };
      }
    }
    this.trickState.plays.push({ playerIndex:seatIndex, play:null });
    this.trickState.passCount++;
    const leadIdx = this._getLeadPlayerIndex();
    const activePlayers = this.hands.filter((h,i)=>h.length>0&&i!==leadIdx).length;
    if (this.trickState.passCount >= activePlayers) {
      const winnerHasCards = this.hands[leadIdx].length > 0;
      const withCards = this.hands.filter(h=>h.length>0).length;
      if (withCards===0) { this.gameOver=true; this._endGame(); return { success:true }; }
      if (withCards===1&&winnerHasCards) {
        this.rankings.push(leadIdx); this.gameOver=true; this._endGame(); return { success:true };
      }
      if (this._checkTeamWin()) { this._endGame(); return { success:true }; }
      let next = leadIdx;
      if (!winnerHasCards) {
        next = (leadIdx+1)%6;
        let cnt=0;
        while (this.hands[next].length===0&&cnt<6) { next=(next+1)%6; cnt++; }
      }
      this.trickState = { leadPlay:null, plays:[], currentPlayer:next, passCount:0 };
      this.broadcastState();
      return { success:true };
    }
    this._advanceToNextPlayer(seatIndex);
    this.broadcastState();
    return { success:true };
  }

  _checkTeamWin() {
    if (!this.teamConfig) return false;
    const teamA = new Set([this.teamConfig.caller, ...(this.teamConfig.partners||[])]);
    const teamB = new Set(Array.from({length:6},(_,i)=>i).filter(i=>!teamA.has(i)));
    const finished = new Set(this.rankings);

    // 1v5模式：五人组（teamB）只需有一人出完即触发结算
    if (this.teamConfig.mode === '1v5') {
      const soloFinished = finished.has(this.teamConfig.caller);
      const fiveTeamAnyFinished = [...teamB].some(p => finished.has(p));
      if (!soloFinished && !fiveTeamAnyFinished) return false;
      // 将未完成的玩家按手牌数从少到多填入名次
      const remaining = Array.from({length:6},(_,i)=>i)
        .filter(p => !finished.has(p))
        .sort((a,b) => this.hands[a].length - this.hands[b].length);
      for (const p of remaining) this.rankings.push(p);
      this.gameOver = true;
      return true;
    }

    // 2v4模式：任意一队占满3个名次位置时立即结算
    if (this.teamConfig.mode === '2v4') {
      const team2finished = [...teamA].filter(p => finished.has(p)).length; // 两人组已出完人数
      const team4finished = [...teamB].filter(p => finished.has(p)).length; // 4人组已出完人数
      // 两人组最高者吃掉1个额外名次，所以两人组2人出完 = 占3个名次位置
      // 4人组3人出完 = 占3个名次位置
      const team2Done = team2finished === 2; // 两人组全员出完（占3个位置）
      const team4Done = team4finished >= 3;  // 4人组至少3人出完（占3个位置）
      if (!team2Done && !team4Done) return false;
      // 将未出完的玩家按手牌数从少到多填入剩余名次
      const remaining = Array.from({length:6}, (_, i) => i)
        .filter(p => !finished.has(p))
        .sort((a, b) => this.hands[a].length - this.hands[b].length);
      for (const p of remaining) this.rankings.push(p);
      this.gameOver = true;
      return true;
    }

    // 3v3模式：某队全员出完才结算
    const aDone = [...teamA].every(p => finished.has(p));
    const bDone = [...teamB].every(p => finished.has(p));
    if (!aDone && !bDone) return false;
    const losing = aDone ? teamB : teamA;
    const remaining = [...losing].filter(p => !finished.has(p))
      .sort((a, b) => this.hands[a].length - this.hands[b].length);
    for (const p of remaining) this.rankings.push(p);
    this.gameOver = true;
    return true;
  }

  _endGame() {
    this.phase = 'result';
    const deltas = calcScore(this.rankings, this.teamConfig);
    this.lastWinner = this.rankings[0];
    // 累加总积分
    for (let i = 0; i < 6; i++) this.totalScores[i] += deltas[i];
    const result = {
      timestamp: Date.now(),
      rankings: this.rankings.slice(),
      teamConfig: this.teamConfig,
      scoreDeltas: deltas
    };
    this.history.push(result);
    // 广播结算
    for (let i=0;i<6;i++) {
      const p = this.players[i];
      if (!p || !p.ws || p.ws.readyState !== 1) continue; // 跳过AI虚拟玩家
      p.ws.send(JSON.stringify({
        type:'result',
        rankings: this.rankings,
        teamConfig: this.teamConfig,
        scoreDeltas: deltas,
        players: this.players.map(p=>p?p.name:null),
        history: this.history
      }));
    }
  }

  _getLeadPlayerIndex() {
    for (let i=this.trickState.plays.length-1;i>=0;i--) {
      if (this.trickState.plays[i].play!==null) return this.trickState.plays[i].playerIndex;
    }
    return -1;
  }

  _advanceToNextPlayer(current) {
    let next=(current+1)%6, cnt=0;
    while (this.hands[next].length===0&&cnt<6) { next=(next+1)%6; cnt++; }
    this.trickState.currentPlayer = next;
  }

  _getNextActivePlayer(current) {
    let next=(current+1)%6, cnt=0;
    while (cnt<6) {
      if (this.hands[next].length>0) return next;
      next=(next+1)%6; cnt++;
    }
    return -1;
  }
}

// ===== WebSocket 消息处理 =====
wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerSeat = -1;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        const code = generateRoomCode();
        const room = new Room(code);
        rooms.set(code, room);
        const seat = 0;
        room.players[seat] = { name: msg.name, ws, connected: true, seatIndex: seat };
        playerRoom = room;
        playerSeat = seat;
        ws.send(JSON.stringify({ type:'room_created', code, seat, players: room.players.map(p=>p?{name:p.name}:null) }));
        break;
      }

      case 'join_room': {
        const room = rooms.get(msg.code);
        if (!room) { ws.send(JSON.stringify({type:'error',msg:'房间不存在'})); return; }
        if (room.isFull()) { ws.send(JSON.stringify({type:'error',msg:'房间已满'})); return; }
        if (room.phase !== 'waiting') { ws.send(JSON.stringify({type:'error',msg:'游戏已开始'})); return; }
        const seat = room.getFreeSeat();
        room.players[seat] = { name: msg.name, ws, connected: true, seatIndex: seat };
        playerRoom = room;
        playerSeat = seat;
        ws.send(JSON.stringify({ type:'room_joined', code: msg.code, seat, players: room.players.map(p=>p?{name:p.name}:null) }));
        room.broadcast({ type:'player_joined', seat, name: msg.name, players: room.players.map(p=>p?{name:p.name}:null) }, ws);
        break;
      }

      case 'start_game': {
        if (!playerRoom || playerSeat !== 0) return;
        if (!playerRoom.isFull()) { ws.send(JSON.stringify({type:'error',msg:'需要6名玩家才能开始'})); return; }
        playerRoom.startGame();
        break;
      }

      case 'bid_confirm': {
        if (!playerRoom || playerSeat !== playerRoom.callerIndex) return;
        if (msg.bidCards.length !== 2) return;
        playerRoom.startBidReveal(msg.bidCards);
        break;
      }

      case 'bid_d_multiplier': {
        if (!playerRoom || playerSeat !== playerRoom.callerIndex) return;
        if (playerRoom.phase !== 'bid_d_multiplier') return;
        const m = msg.multiplier === 3 ? 3 : 2;
        playerRoom.handleDMultiplier(m);
        break;
      }

      case 'objection_response': {
        if (!playerRoom || playerSeat !== playerRoom.objectionPlayer) return;
        playerRoom.afterObjection(msg.objected);
        break;
      }

      case 'grab_response': {
        if (!playerRoom || playerRoom.phase !== 'grab') return;
        const expected = playerRoom.grabCandidates[playerRoom.grabCandidateIdx];
        if (playerSeat !== expected) return;
        if (msg.grab) {
          playerRoom.handleGrab(playerSeat, msg.multiplier || 2);
        } else {
          playerRoom.handleGrabSkip();
        }
        break;
      }

      case 'start_playing': {
        // 叫主者在 bid_confirmed 阶段点击开始游戏
        if (!playerRoom || playerSeat !== playerRoom.callerIndex) return;
        if (playerRoom.phase !== 'bid_confirmed') return;
        playerRoom._startPlaying();
        break;
      }

      case 'play_cards': {
        if (!playerRoom || playerRoom.phase !== 'playing') return;
        const result = playerRoom.playCards(playerSeat, msg.cards);
        if (!result.success) ws.send(JSON.stringify({type:'error',msg:result.error}));
        break;
      }

      case 'pass': {
        if (!playerRoom || playerRoom.phase !== 'playing') return;
        const result = playerRoom.pass(playerSeat);
        if (!result.success) ws.send(JSON.stringify({type:'error',msg:result.error}));
        break;
      }

      case 'play_again': {
        if (!playerRoom || playerSeat !== 0) return;
        playerRoom.phase = 'waiting';
        // 保留 AI 虚拟玩家和 aiSeats，让等待室直接显示已配置的AI座位
        // 重置游戏状态但不清除AI配置
        playerRoom.hands = [];
        playerRoom.rankings = [];
        playerRoom.gameOver = false;
        playerRoom.teamConfig = null;
        playerRoom.bidCards = [];
        playerRoom.trickState = null;
        playerRoom.bidSituation = null;
        playerRoom.objectionPlayer = null;
        playerRoom.pendingConfig = null;
        playerRoom.grabCandidates = [];
        playerRoom.grabCandidateIdx = 0;
        playerRoom.broadcastState();
        break;
      }

      case 'reset_scores': {
        // 只有座位0（房主）可以清空积分
        if (!playerRoom || playerSeat !== 0) return;
        playerRoom.totalScores = new Array(6).fill(0);
        playerRoom.history = [];
        playerRoom.lastWinner = null;
        playerRoom.isEverFirstGame = true; // 重置后下一局重新触发♦3限制
        playerRoom.startGame(); // 直接重新发牌开始
        break;
      }

      // AI座位配置：标记哪些座位是AI控制（Key不存服务器）
      case 'ai_seat_config': {
        if (!playerRoom || playerSeat !== 0) return; // 只有房主可配置
        if (playerRoom.phase !== 'waiting') return;
        const { seat: aiSeat, isAI } = msg;
        if (aiSeat < 0 || aiSeat >= 6) return;
        if (isAI) {
          playerRoom.aiSeats.add(aiSeat);
          // 座位0是房主真实玩家，保留其ws连接，只标记为AI驱动
          // 其他座位填入虚拟AI玩家，让 isFull() 能正确计数
          if (aiSeat !== 0 && !playerRoom.players[aiSeat]) {
            playerRoom.players[aiSeat] = { name: `AI${aiSeat+1}`, ws: null, connected: true, seatIndex: aiSeat, isAI: true };
          }
        } else {
          playerRoom.aiSeats.delete(aiSeat);
          // 清除虚拟AI玩家（座位0是真实玩家，不清除）
          if (aiSeat !== 0 && playerRoom.players[aiSeat] && playerRoom.players[aiSeat].isAI) {
            playerRoom.players[aiSeat] = null;
          }
        }
        // 广播完整等待室状态（含玩家列表更新）
        const playersInfo = playerRoom.players.map(p => p ? { name: p.name } : null);
        playerRoom.broadcast({
          type: 'ai_seats_updated',
          aiSeats: [...playerRoom.aiSeats],
          players: playersInfo
        });
        // 同时给房主发 player_joined 风格的更新，刷新等待室
        ws.send(JSON.stringify({
          type: 'ai_seats_updated',
          aiSeats: [...playerRoom.aiSeats],
          players: playersInfo
        }));
        break;
      }

      // AI代理出牌：前端代替AI座位发送操作
      case 'ai_action': {
        if (!playerRoom) return;
        const { aiSeat, action: aiAct } = msg;
        // 验证：该座位确实是AI座位，且发送者是房主（座位0）
        if (!playerRoom.aiSeats.has(aiSeat)) return;
        if (playerSeat !== 0) return;
        if (aiAct === 'play_cards') {
          const result = playerRoom.playCards(aiSeat, msg.cards);
          if (!result.success) {
            // 通知房主AI出牌失败
            ws.send(JSON.stringify({ type: 'ai_error', aiSeat, error: result.error }));
          }
        } else if (aiAct === 'pass') {
          const result = playerRoom.pass(aiSeat);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'ai_error', aiSeat, error: result.error }));
          }
        } else if (aiAct === 'bid_confirm') {
          if (playerRoom.phase !== 'bidding' || playerRoom.callerIndex !== aiSeat) return;
          playerRoom.startBidReveal(msg.bidCards);
        } else if (aiAct === 'bid_d_multiplier') {
          if (playerRoom.phase !== 'bid_d_multiplier' || playerRoom.callerIndex !== aiSeat) return;
          playerRoom.handleDMultiplier(msg.multiplier === 3 ? 3 : 2);
        } else if (aiAct === 'objection_response') {
          if (playerRoom.objectionPlayer !== aiSeat) return;
          playerRoom.afterObjection(msg.objected);
        } else if (aiAct === 'grab_response') {
          if (playerRoom.phase !== 'grab') return;
          const expected = playerRoom.grabCandidates[playerRoom.grabCandidateIdx];
          if (aiSeat !== expected) return;
          if (msg.grab) {
            playerRoom.handleGrab(aiSeat, msg.multiplier || 4);
          } else {
            playerRoom.handleGrabSkip();
          }
        } else if (aiAct === 'start_playing') {
          if (playerRoom.phase !== 'bid_confirmed' || playerRoom.callerIndex !== aiSeat) return;
          playerRoom._startPlaying();
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (playerRoom && playerSeat >= 0) {
      const p = playerRoom.players[playerSeat];
      if (p) p.connected = false;
      playerRoom.broadcast({ type:'player_disconnected', seat: playerSeat });
      // 若房间全部断开，30秒后清理
      setTimeout(() => {
        if (playerRoom && playerRoom.players.every(p=>!p||!p.connected)) {
          rooms.delete(playerRoom.code);
        }
      }, 30000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`找朋友扑克服务器运行在 http://localhost:${PORT}`);
});
