'use strict';

// ===== 从 server.js 复制的核心逻辑（不含网络部分）=====

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
  const team2 = new Set([config.caller, ...config.partners]);
  let topPos = -1, topPlayer = -1;
  for (let i = 0; i < 6; i++) {
    if (team2.has(rankings[i])) { topPos = i; topPlayer = rankings[i]; break; }
  }
  const eatA = topPos;
  const eatB = topPos + 1;
  const topScore = BASE_SCORES[eatA] + (eatB < 6 ? BASE_SCORES[eatB] : 0);
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
  let score2 = 0;
  for (const p of team2) score2 += playerScore[p] || 0;
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
  const scorePlayer = config.grabber !== undefined ? config.grabber : config.caller;
  const diff = 9;
  const deltas = new Array(6).fill(0);
  if (rankings[0] === scorePlayer) {
    deltas[scorePlayer] = diff * m * 5;
    for (let p = 0; p < 6; p++) if (p !== scorePlayer) deltas[p] = -(diff * m);
  } else {
    deltas[scorePlayer] = -(diff * m * 5);
    for (let p = 0; p < 6; p++) if (p !== scorePlayer) deltas[p] = diff * m;
  }
  return deltas;
}

// ===== 机器人出牌策略 =====

// 生成所有合法的出牌组合（给定手牌和领先牌型）
function getLegalPlays(hand, leadPlay) {
  const plays = [];

  if (!leadPlay) {
    // 自由出牌：枚举所有合法牌型
    // 单张
    for (const c of hand) {
      plays.push([c]);
    }
    // 对子
    for (let i = 0; i < hand.length; i++) {
      for (let j = i+1; j < hand.length; j++) {
        const pair = [hand[i], hand[j]];
        if (getCardType(pair) === CardType.PAIR) plays.push(pair);
      }
    }
    // 三张
    for (let i = 0; i < hand.length; i++) {
      for (let j = i+1; j < hand.length; j++) {
        for (let k = j+1; k < hand.length; k++) {
          const triple = [hand[i], hand[j], hand[k]];
          if (getCardType(triple) === CardType.TRIPLE) plays.push(triple);
        }
      }
    }
    // 5张牌型
    if (hand.length >= 5) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i+1; j < hand.length; j++) {
          for (let k = j+1; k < hand.length; k++) {
            for (let l = k+1; l < hand.length; l++) {
              for (let m = l+1; m < hand.length; m++) {
                const five = [hand[i],hand[j],hand[k],hand[l],hand[m]];
                if (getCardType(five)) plays.push(five);
              }
            }
          }
        }
      }
    }
  } else {
    // 跟牌：只枚举同牌型且更大的
    const n = leadPlay.cards.length;
    if (n === 1) {
      for (const c of hand) {
        const p = buildPlay([c]);
        if (p && comparePlay(p, leadPlay) > 0) plays.push([c]);
      }
    } else if (n === 2) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i+1; j < hand.length; j++) {
          const combo = [hand[i], hand[j]];
          const p = buildPlay(combo);
          if (p && p.type === leadPlay.type && comparePlay(p, leadPlay) > 0) plays.push(combo);
        }
      }
    } else if (n === 3) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i+1; j < hand.length; j++) {
          for (let k = j+1; k < hand.length; k++) {
            const combo = [hand[i],hand[j],hand[k]];
            const p = buildPlay(combo);
            if (p && p.type === leadPlay.type && comparePlay(p, leadPlay) > 0) plays.push(combo);
          }
        }
      }
    } else if (n === 5) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i+1; j < hand.length; j++) {
          for (let k = j+1; k < hand.length; k++) {
            for (let l = k+1; l < hand.length; l++) {
              for (let m = l+1; m < hand.length; m++) {
                const combo = [hand[i],hand[j],hand[k],hand[l],hand[m]];
                const p = buildPlay(combo);
                if (p && comparePlay(p, leadPlay) > 0) plays.push(combo);
              }
            }
          }
        }
      }
    }
  }
  return plays;
}

// 机器人策略：随机选一个合法出牌（简单随机策略）
function botChoosePlay(hand, leadPlay, isFirstTrick, isFirstGame) {
  // 第一局第一手必须含♦3
  if (isFirstGame && isFirstTrick && !leadPlay) {
    const diamond3 = hand.find(c => c.suit === 'diamonds' && c.rank === 1);
    if (diamond3) {
      // 随机选一个含♦3的合法牌型
      const allPlays = getLegalPlays(hand, null);
      const valid = allPlays.filter(p => p.some(c => c.suit==='diamonds' && c.rank===1));
      if (valid.length > 0) return valid[Math.floor(Math.random()*valid.length)];
      return [diamond3];
    }
  }
  const legal = getLegalPlays(hand, leadPlay);
  if (legal.length === 0) return null; // 只能Pass
  return legal[Math.floor(Math.random()*legal.length)];
}

// ===== 模拟游戏引擎 =====

function simulateGame(gameNum, lastWinner, isEverFirstGame, totalScores) {
  const deck = shuffle(createDeck());
  const hands = Array.from({length:6}, (_,i) => deck.slice(i*9,(i+1)*9));

  // 确定叫主者
  let callerIndex = 0;
  const isFirstGame = (lastWinner === null && isEverFirstGame);
  if (lastWinner !== null) {
    callerIndex = lastWinner;
  } else {
    for (let i=0;i<6;i++) {
      if (hands[i].some(c=>c.suit==='diamonds'&&c.rank===1)) { callerIndex=i; break; }
    }
  }

  // 随机叫牌（从3-10任意花色选2张）
  const BID_RANKS = [1,2,3,4,5,6,7,8];
  const SUITS = ['spades','hearts','clubs','diamonds'];
  function randomBidCard() {
    return { suit: SUITS[Math.floor(Math.random()*4)], rank: BID_RANKS[Math.floor(Math.random()*8)] };
  }
  const bidCard1 = randomBidCard();
  let bidCard2 = randomBidCard();
  // 确保两张不同
  while (bidCard2.suit===bidCard1.suit && bidCard2.rank===bidCard1.rank) bidCard2 = randomBidCard();

  // 解析叫牌情形
  const card1=bidCard1, card2=bidCard2;
  const holders1=[], holders2=[];
  let cHas1=false, cHas2=false;
  for (let i=0;i<6;i++) {
    const h1 = hands[i].some(c=>c.suit===card1.suit&&c.rank===card1.rank);
    const h2 = hands[i].some(c=>c.suit===card2.suit&&c.rank===card2.rank);
    if (i===callerIndex) { cHas1=h1; cHas2=h2; }
    else { if(h1) holders1.push(i); if(h2) holders2.push(i); }
  }

  let teamConfig;
  if (cHas1&&cHas2) {
    // 情形D：随机选2或3倍，随机决定是否有人抢
    const m = Math.random() < 0.5 ? 2 : 3;
    // 随机一个非叫主者抢（30%概率）
    const grabber = Math.random() < 0.3 ? (callerIndex+1+Math.floor(Math.random()*5))%6 : undefined;
    if (grabber !== undefined) {
      teamConfig = { mode:'1v5', caller:callerIndex, grabber, partners:[], multiplier:4 };
    } else {
      teamConfig = { mode:'1v5', caller:callerIndex, partners:[], multiplier:m };
    }
  } else if (cHas1&&holders2.length>0) {
    teamConfig = { mode:'2v4', caller:callerIndex, partners:[holders2[0]] };
  } else if (cHas2&&holders1.length>0) {
    teamConfig = { mode:'2v4', caller:callerIndex, partners:[holders1[0]] };
  } else {
    const both = holders1.find(p=>holders2.includes(p));
    if (both!==undefined) {
      teamConfig = { mode:'2v4', caller:callerIndex, partners:[both] };
    } else if (holders1.length>0&&holders2.length>0) {
      teamConfig = { mode:'3v3', caller:callerIndex, partners:[holders1[0],holders2[0]] };
    } else {
      teamConfig = { mode:'1v5', caller:callerIndex, partners:[], multiplier:2 };
    }
  }

  // ===== 出牌模拟 =====
  const rankings = [];
  let trickState = { leadPlay:null, plays:[], currentPlayer:callerIndex, passCount:0 };
  let firstTrickDone = false;
  let gameOver = false;
  let stepLimit = 10000; // 防止死循环

  function getNextActivePlayer(current) {
    let next=(current+1)%6, cnt=0;
    while (cnt<6) {
      if (hands[next].length>0) return next;
      next=(next+1)%6; cnt++;
    }
    return -1;
  }

  function getLeadPlayerIndex() {
    for (let i=trickState.plays.length-1;i>=0;i--) {
      if (trickState.plays[i].play!==null) return trickState.plays[i].playerIndex;
    }
    return -1;
  }

  function checkTeamWin() {
    if (!teamConfig) return false;
    const teamA = new Set([teamConfig.caller, ...(teamConfig.partners||[])]);
    const teamB = new Set(Array.from({length:6},(_,i)=>i).filter(i=>!teamA.has(i)));
    const finished = new Set(rankings);

    if (teamConfig.mode === '1v5') {
      const scorePlayer = teamConfig.grabber !== undefined ? teamConfig.grabber : teamConfig.caller;
      const soloFinished = finished.has(scorePlayer);
      const fiveTeamAnyFinished = [...teamB].some(p => finished.has(p));
      // 对于1v5，teamA只有caller，teamB是其余5人
      // 但如果有grabber，单人方是grabber，teamA仍是caller
      // 简化：单人方出完或五人组任意一人出完
      const soloPlayer = teamConfig.grabber !== undefined ? teamConfig.grabber : teamConfig.caller;
      const fiveTeam = Array.from({length:6},(_,i)=>i).filter(i=>i!==soloPlayer);
      const soloOut = finished.has(soloPlayer);
      const fiveAnyOut = fiveTeam.some(p=>finished.has(p));
      if (!soloOut && !fiveAnyOut) return false;
      const remaining = Array.from({length:6},(_,i)=>i)
        .filter(p => !finished.has(p))
        .sort((a,b) => hands[a].length - hands[b].length);
      for (const p of remaining) rankings.push(p);
      gameOver = true;
      return true;
    }

    if (teamConfig.mode === '2v4') {
      const team2finished = [...teamA].filter(p => finished.has(p)).length;
      const team4finished = [...teamB].filter(p => finished.has(p)).length;
      const team2Done = team2finished === 2;
      const team4Done = team4finished >= 3;
      if (!team2Done && !team4Done) return false;
      const remaining = Array.from({length:6},(_,i)=>i)
        .filter(p => !finished.has(p))
        .sort((a,b) => hands[a].length - hands[b].length);
      for (const p of remaining) rankings.push(p);
      gameOver = true;
      return true;
    }

    // 3v3
    const aDone = [...teamA].every(p=>finished.has(p));
    const bDone = [...teamB].every(p=>finished.has(p));
    if (!aDone && !bDone) return false;
    const losing = aDone ? teamB : teamA;
    const remaining = [...losing].filter(p=>!finished.has(p))
      .sort((a,b)=>hands[a].length-hands[b].length);
    for (const p of remaining) rankings.push(p);
    gameOver = true;
    return true;
  }

  while (!gameOver && stepLimit-- > 0) {
    const seat = trickState.currentPlayer;
    const hand = hands[seat];

    if (hand.length === 0) {
      // 已出完，跳到下一个
      let next = (seat+1)%6, cnt=0;
      while (hands[next].length===0 && cnt<6) { next=(next+1)%6; cnt++; }
      trickState.currentPlayer = next;
      continue;
    }

    // 下家只剩1张时的单牌限制检查
    const nextPlayer = getNextActivePlayer(seat);
    const nextHasOne = nextPlayer !== -1 && hands[nextPlayer].length === 1;

    // 机器人决策
    let chosenCards = null;

    if (!trickState.leadPlay) {
      // 自由出牌
      chosenCards = botChoosePlay(hand, null, !firstTrickDone, isFirstGame);
      // 下家剩1张：必须出最大单牌
      if (nextHasOne && chosenCards && chosenCards.length === 1) {
        const maxCard = hand.reduce((best,c) => getCardScore(c)>getCardScore(best)?c:best);
        chosenCards = [maxCard];
      }
    } else {
      // 跟牌
      const legal = getLegalPlays(hand, trickState.leadPlay);
      if (legal.length === 0) {
        // 必须Pass，但检查下家1张限制
        if (nextHasOne && trickState.leadPlay.type === 'single') {
          const canBeat = hand.some(c => getCardScore(c) > trickState.leadPlay.value);
          if (canBeat) {
            // 必须出最大单牌
            const maxCard = hand.reduce((best,c) => getCardScore(c)>getCardScore(best)?c:best);
            chosenCards = [maxCard];
          }
        }
        // 真的没法出，Pass
      } else {
        // 下家剩1张且是单牌轮：必须出最大单牌
        if (nextHasOne && trickState.leadPlay.type === 'single') {
          const maxCard = hand.reduce((best,c) => getCardScore(c)>getCardScore(best)?c:best);
          const maxPlay = buildPlay([maxCard]);
          if (maxPlay && comparePlay(maxPlay, trickState.leadPlay) > 0) {
            chosenCards = [maxCard];
          } else {
            chosenCards = null; // 打不过，Pass
          }
        } else {
          // 随机选一个合法出牌（50%概率Pass，50%出牌，增加游戏多样性）
          if (Math.random() < 0.5) {
            chosenCards = legal[Math.floor(Math.random()*legal.length)];
          }
        }
      }
    }

    if (chosenCards && chosenCards.length > 0) {
      // 出牌
      const play = buildPlay(chosenCards);
      if (!play) { chosenCards = null; } // 非法牌型，改为Pass
      else {
        // 移除手牌
        const newHand = hand.slice();
        for (const card of chosenCards) {
          const idx = newHand.findIndex(c=>c.suit===card.suit&&c.rank===card.rank);
          if (idx === -1) { chosenCards = null; break; } // 牌不在手中，异常
          newHand.splice(idx,1);
        }
        if (chosenCards) {
          hands[seat] = newHand;
          trickState.plays.push({ playerIndex:seat, play });
          trickState.leadPlay = play;
          trickState.passCount = 0;
          if (isFirstGame && !firstTrickDone) firstTrickDone = true;
          if (newHand.length === 0) rankings.push(seat);
          if (rankings.length >= 6) { gameOver=true; break; }
          if (newHand.length===0 && checkTeamWin()) break;
          const remaining = hands.filter(h=>h.length>0);
          if (remaining.length===1) {
            rankings.push(hands.findIndex(h=>h.length>0));
            gameOver=true; break;
          }
          // 下一个玩家
          let next=(seat+1)%6, cnt=0;
          while (hands[next].length===0&&cnt<6) { next=(next+1)%6; cnt++; }
          trickState.currentPlayer = next;
          continue;
        }
      }
    }

    // Pass
    trickState.plays.push({ playerIndex:seat, play:null });
    trickState.passCount++;
    const leadIdx = getLeadPlayerIndex();
    const activePlayers = hands.filter((h,i)=>h.length>0&&i!==leadIdx).length;
    if (trickState.passCount >= activePlayers) {
      const winnerHasCards = hands[leadIdx] && hands[leadIdx].length > 0;
      const withCards = hands.filter(h=>h.length>0).length;
      if (withCards===0) { gameOver=true; break; }
      if (withCards===1&&winnerHasCards) {
        rankings.push(leadIdx); gameOver=true; break;
      }
      if (checkTeamWin()) break;
      let next = leadIdx;
      if (!winnerHasCards) {
        next = (leadIdx+1)%6;
        let cnt=0;
        while (hands[next].length===0&&cnt<6) { next=(next+1)%6; cnt++; }
      }
      trickState = { leadPlay:null, plays:[], currentPlayer:next, passCount:0 };
    } else {
      let next=(seat+1)%6, cnt=0;
      while (hands[next].length===0&&cnt<6) { next=(next+1)%6; cnt++; }
      trickState.currentPlayer = next;
    }
  }

  if (stepLimit <= 0) {
    return { error: `游戏${gameNum}卡死（超过步数限制）`, teamConfig, rankings };
  }

  if (rankings.length < 6) {
    // 补全名次
    const finished = new Set(rankings);
    const remaining = Array.from({length:6},(_,i)=>i)
      .filter(p=>!finished.has(p))
      .sort((a,b)=>hands[a].length-hands[b].length);
    for (const p of remaining) rankings.push(p);
  }

  const deltas = calcScore(rankings, teamConfig);
  const sum = deltas.reduce((a,b)=>a+b,0);

  return {
    gameNum,
    mode: teamConfig.mode,
    multiplier: teamConfig.multiplier,
    caller: teamConfig.caller,
    grabber: teamConfig.grabber,
    partners: teamConfig.partners,
    rankings,
    deltas,
    sum,
    error: null
  };
}

// ===== 格式化输出工具 =====
function fmt(n, width) { return String(n).padStart(width); }
function fmtDelta(d) { return (d > 0 ? '+' : '') + d; }

// 按队伍分组显示名次和积分
function formatResult(result) {
  const { mode, multiplier, grabber, caller, partners, rankings, deltas, sum } = result;

  const status = Math.abs(sum) < 0.01 ? '✅' : `❌(和=${sum})`;

  if (mode === '1v5') {
    // 单人方
    const soloIdx = grabber !== undefined ? grabber : caller;
    const soloRank = rankings.indexOf(soloIdx) + 1;
    const soloDelta = fmtDelta(deltas[soloIdx]);
    const soloWin = rankings[0] === soloIdx;
    const soloLabel = grabber !== undefined ? `P${soloIdx+1}(抢)` : `P${soloIdx+1}(叫)`;

    // 五人组
    const fiveTeam = Array.from({length:6},(_,i)=>i).filter(i=>i!==soloIdx);
    const fiveStr = fiveTeam.map(p => {
      const rank = rankings.indexOf(p) + 1;
      return `P${p+1}第${rank}名`;
    }).join(' ');
    const fiveDelta = fmtDelta(deltas[fiveTeam[0]]); // 五人组每人相同

    const mStr = `1v5×${multiplier}`;
    const resultLabel = soloWin ? '单人胜' : '五人胜';
    return `${mStr.padEnd(7)} | 单人: ${soloLabel}第${soloRank}名 ${soloDelta.padStart(5)} | 五人组: ${fiveStr} 每人${fiveDelta.padStart(5)} | ${resultLabel} | 总和${sum===0?'=0 ✅':`=${sum} ❌`}`;
  }

  if (mode === '2v4') {
    const team2 = new Set([caller, ...(partners||[])]);
    const team2players = [...team2];
    const team4players = Array.from({length:6},(_,i)=>i).filter(i=>!team2.has(i));

    const t2str = team2players.map(p => {
      const rank = rankings.indexOf(p) + 1;
      return `P${p+1}第${rank}名(${fmtDelta(deltas[p])})`;
    }).join(' ');
    const t4str = team4players.map(p => {
      const rank = rankings.indexOf(p) + 1;
      return `P${p+1}第${rank}名(${fmtDelta(deltas[p])})`;
    }).join(' ');

    const t2win = deltas[team2players[0]] > 0;
    return `${'2v4'.padEnd(7)} | 两人组: ${t2str} | 四人组: ${t4str} | ${t2win?'两人胜':'四人胜'} | 总和${sum===0?'=0 ✅':`=${sum} ❌`}`;
  }

  // 3v3
  const teamA = new Set([caller, ...(partners||[])]);
  const teamAplayers = [...teamA];
  const teamBplayers = Array.from({length:6},(_,i)=>i).filter(i=>!teamA.has(i));

  const tAstr = teamAplayers.map(p => {
    const rank = rankings.indexOf(p) + 1;
    return `P${p+1}第${rank}名(${fmtDelta(deltas[p])})`;
  }).join(' ');
  const tBstr = teamBplayers.map(p => {
    const rank = rankings.indexOf(p) + 1;
    return `P${p+1}第${rank}名(${fmtDelta(deltas[p])})`;
  }).join(' ');

  const aWin = deltas[teamAplayers[0]] > 0;
  return `${'3v3'.padEnd(7)} | A队: ${tAstr} | B队: ${tBstr} | ${aWin?'A队胜':'B队胜'} | 总和${sum===0?'=0 ✅':`=${sum} ❌`}`;
}

// ===== 强制1v5测试（固定10局，覆盖2/3/4倍 + 抢主 + 胜负两种情况）=====
function force1v5Game(gameNum, multiplier, grabberOffset) {
  // 强制构造1v5配置，不走随机叫牌流程
  const deck = shuffle(createDeck());
  const hands = Array.from({length:6}, (_,i) => deck.slice(i*9,(i+1)*9));
  const callerIndex = 0;
  const grabber = grabberOffset !== undefined ? (callerIndex + grabberOffset) % 6 : undefined;
  const teamConfig = {
    mode: '1v5', caller: callerIndex,
    grabber, partners: [], multiplier
  };

  const rankings = [];
  let trickState = { leadPlay:null, plays:[], currentPlayer:callerIndex, passCount:0 };
  let gameOver = false;
  let stepLimit = 10000;

  function getNextActivePlayer(current) {
    let next=(current+1)%6, cnt=0;
    while (cnt<6) { if (hands[next].length>0) return next; next=(next+1)%6; cnt++; }
    return -1;
  }
  function getLeadPlayerIndex() {
    for (let i=trickState.plays.length-1;i>=0;i--) {
      if (trickState.plays[i].play!==null) return trickState.plays[i].playerIndex;
    }
    return -1;
  }
  function checkTeamWin() {
    const soloPlayer = teamConfig.grabber !== undefined ? teamConfig.grabber : teamConfig.caller;
    const fiveTeam = Array.from({length:6},(_,i)=>i).filter(i=>i!==soloPlayer);
    const finished = new Set(rankings);
    const soloOut = finished.has(soloPlayer);
    const fiveAnyOut = fiveTeam.some(p=>finished.has(p));
    if (!soloOut && !fiveAnyOut) return false;
    const remaining = Array.from({length:6},(_,i)=>i)
      .filter(p=>!finished.has(p)).sort((a,b)=>hands[a].length-hands[b].length);
    for (const p of remaining) rankings.push(p);
    gameOver = true;
    return true;
  }

  while (!gameOver && stepLimit-- > 0) {
    const seat = trickState.currentPlayer;
    const hand = hands[seat];
    if (hand.length === 0) {
      let next=(seat+1)%6, cnt=0;
      while (hands[next].length===0&&cnt<6){next=(next+1)%6;cnt++;}
      trickState.currentPlayer=next; continue;
    }
    const nextPlayer = getNextActivePlayer(seat);
    const nextHasOne = nextPlayer !== -1 && hands[nextPlayer].length === 1;
    let chosenCards = null;
    if (!trickState.leadPlay) {
      chosenCards = botChoosePlay(hand, null, false, false);
      if (nextHasOne && chosenCards && chosenCards.length===1) {
        const maxCard = hand.reduce((best,c)=>getCardScore(c)>getCardScore(best)?c:best);
        chosenCards = [maxCard];
      }
    } else {
      const legal = getLegalPlays(hand, trickState.leadPlay);
      if (legal.length===0) {
        if (nextHasOne && trickState.leadPlay.type==='single') {
          const canBeat = hand.some(c=>getCardScore(c)>trickState.leadPlay.value);
          if (canBeat) { const maxCard=hand.reduce((b,c)=>getCardScore(c)>getCardScore(b)?c:b); chosenCards=[maxCard]; }
        }
      } else {
        if (nextHasOne && trickState.leadPlay.type==='single') {
          const maxCard=hand.reduce((b,c)=>getCardScore(c)>getCardScore(b)?c:b);
          const maxPlay=buildPlay([maxCard]);
          chosenCards=(maxPlay&&comparePlay(maxPlay,trickState.leadPlay)>0)?[maxCard]:null;
        } else {
          if (Math.random()<0.5) chosenCards=legal[Math.floor(Math.random()*legal.length)];
        }
      }
    }
    if (chosenCards && chosenCards.length>0) {
      const play=buildPlay(chosenCards);
      if (play) {
        const newHand=hand.slice();
        let ok=true;
        for (const card of chosenCards) {
          const idx=newHand.findIndex(c=>c.suit===card.suit&&c.rank===card.rank);
          if (idx===-1){ok=false;break;} newHand.splice(idx,1);
        }
        if (ok) {
          hands[seat]=newHand; trickState.plays.push({playerIndex:seat,play});
          trickState.leadPlay=play; trickState.passCount=0;
          if (newHand.length===0) rankings.push(seat);
          if (rankings.length>=6){gameOver=true;break;}
          if (newHand.length===0&&checkTeamWin()) break;
          const rem=hands.filter(h=>h.length>0);
          if (rem.length===1){rankings.push(hands.findIndex(h=>h.length>0));gameOver=true;break;}
          let next=(seat+1)%6,cnt=0;
          while(hands[next].length===0&&cnt<6){next=(next+1)%6;cnt++;}
          trickState.currentPlayer=next; continue;
        }
      }
    }
    trickState.plays.push({playerIndex:seat,play:null}); trickState.passCount++;
    const leadIdx=getLeadPlayerIndex();
    const activePlayers=hands.filter((h,i)=>h.length>0&&i!==leadIdx).length;
    if (trickState.passCount>=activePlayers) {
      const winnerHasCards=hands[leadIdx]&&hands[leadIdx].length>0;
      const withCards=hands.filter(h=>h.length>0).length;
      if (withCards===0){gameOver=true;break;}
      if (withCards===1&&winnerHasCards){rankings.push(leadIdx);gameOver=true;break;}
      if (checkTeamWin()) break;
      let next=leadIdx;
      if (!winnerHasCards){next=(leadIdx+1)%6;let cnt=0;while(hands[next].length===0&&cnt<6){next=(next+1)%6;cnt++;}}
      trickState={leadPlay:null,plays:[],currentPlayer:next,passCount:0};
    } else {
      let next=(seat+1)%6,cnt=0;
      while(hands[next].length===0&&cnt<6){next=(next+1)%6;cnt++;}
      trickState.currentPlayer=next;
    }
  }
  if (stepLimit<=0) return { error:`1v5测试${gameNum}卡死`, teamConfig, rankings };
  if (rankings.length<6) {
    const finished=new Set(rankings);
    const rem=Array.from({length:6},(_,i)=>i).filter(p=>!finished.has(p)).sort((a,b)=>hands[a].length-hands[b].length);
    for (const p of rem) rankings.push(p);
  }
  const deltas=calcScore(rankings,teamConfig);
  const sum=deltas.reduce((a,b)=>a+b,0);
  return { gameNum, mode:'1v5', multiplier, caller:callerIndex, grabber, partners:[], rankings, deltas, sum, error:null };
}

// ===== 主测试循环 =====
const TOTAL_GAMES = 100;
let lastWinner = null;
let isEverFirstGame = true;
const totalScores = new Array(6).fill(0);

const modeCount = { '3v3':0, '2v4':0, '1v5':0 };
const errors = [];
let sumErrors = 0;

// ── 第一部分：随机100局 ──
console.log('\n' + '═'.repeat(110));
console.log('🎮  随机模拟 100 局');
console.log('═'.repeat(110));

for (let g = 1; g <= TOTAL_GAMES; g++) {
  const result = simulateGame(g, lastWinner, isEverFirstGame, totalScores);

  if (result.error) {
    errors.push(result.error);
    console.log(`第${fmt(g,3)}局 ❌ 错误: ${result.error}`);
    continue;
  }

  if (Math.abs(result.sum) > 0.01) {
    sumErrors++;
    errors.push(`第${g}局积分总和不为零: ${result.sum}`);
  }

  for (let i=0;i<6;i++) totalScores[i] += result.deltas[i];
  lastWinner = result.rankings[0];
  isEverFirstGame = false;
  modeCount[result.mode]++;

  console.log(`第${fmt(g,3)}局 | ${formatResult(result)}`);
}

// ── 第二部分：强制1v5专项测试 ──
console.log('\n' + '═'.repeat(110));
console.log('🔴  1v5 专项测试（覆盖2倍/3倍/4倍抢主，各胜负情况）');
console.log('═'.repeat(110));

const force1v5Cases = [
  { label:'2倍(叫主)', m:2, grabOff:undefined },
  { label:'2倍(叫主)', m:2, grabOff:undefined },
  { label:'3倍(叫主)', m:3, grabOff:undefined },
  { label:'3倍(叫主)', m:3, grabOff:undefined },
  { label:'4倍(抢主P2)', m:4, grabOff:1 },
  { label:'4倍(抢主P3)', m:4, grabOff:2 },
  { label:'4倍(抢主P4)', m:4, grabOff:3 },
  { label:'4倍(抢主P5)', m:4, grabOff:4 },
  { label:'4倍(抢主P6)', m:4, grabOff:5 },
  { label:'2倍(叫主)', m:2, grabOff:undefined },
];

let force1v5SumErrors = 0;
for (let i = 0; i < force1v5Cases.length; i++) {
  const c = force1v5Cases[i];
  const result = force1v5Game(i+1, c.m, c.grabOff);
  if (result.error) {
    console.log(`  测试${i+1} [${c.label}] ❌ ${result.error}`);
    errors.push(result.error);
    continue;
  }
  if (Math.abs(result.sum) > 0.01) {
    force1v5SumErrors++;
    errors.push(`1v5测试${i+1}积分总和不为零: ${result.sum}`);
  }
  console.log(`  测试${fmt(i+1,2)} [${c.label.padEnd(12)}] | ${formatResult(result)}`);
}

// ── 汇总报告 ──
console.log('\n' + '═'.repeat(110));
console.log('📊  测试汇总报告');
console.log('═'.repeat(110));
console.log(`随机100局  →  3v3: ${modeCount['3v3']}局   2v4: ${modeCount['2v4']}局   1v5: ${modeCount['1v5']}局`);
console.log(`积分总和错误: 随机${sumErrors}局 + 1v5专项${force1v5SumErrors}局`);
console.log('\n各玩家累计积分（随机100局）:');
totalScores.forEach((s,i) => console.log(`  P${i+1}: ${fmtDelta(s)}`));
console.log(`  合计: ${totalScores.reduce((a,b)=>a+b,0)}`);

if (errors.length > 0) {
  console.log('\n❌ 发现的问题:');
  errors.forEach(e => console.log('  -', e));
} else {
  console.log('\n✅ 全部测试通过！积分逻辑正确，无卡死。');
}
