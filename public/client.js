'use strict';

// ===== WebSocket 连接 =====
const WS_URL = location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.host}`;
let ws = null;
let mySeat = -1;
let myName = '';
let roomCode = '';
let gameState = null;
let selectedCards = [];

// ===== AI 配置 =====
// aiConfigs: seat -> { provider, model, apiKey, endpoint }
const aiConfigs = new Map();
// 服务器广播的AI座位集合（仅标记，Key不存服务器）
let serverAiSeats = new Set();
// 防止AI重复触发
const aiPending = new Set();

// ===== 工具 =====
function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('hidden');
    v.classList.remove('active');
  });
  const el = document.getElementById(id);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function clearError(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('hidden');
}

function hidePanels(...ids) {
  ids.forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

function showPanel(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

// ===== 牌面渲染 =====
const RANK_NAMES = {1:'3',2:'4',3:'5',4:'6',5:'7',6:'8',7:'9',8:'10',9:'J',10:'Q',11:'K',12:'A',13:'2'};
const SUIT_SYMBOLS = {spades:'♠',hearts:'♥',clubs:'♣',diamonds:'♦'};

function renderCard(card, small = false) {
  const div = document.createElement('div');
  div.className = 'card' + (small ? ' card-sm' : '');
  if (card.suit === 'joker') {
    div.classList.add(card.rank === 15 ? 'joker-big' : 'joker-small');
    const jokerLabel = card.rank === 15 ? '大' : '小';
    div.innerHTML = `<span class="card-corner">${jokerLabel}<br>王</span><span class="card-joker-text">${jokerLabel}<br>王</span>`;
  } else {
    div.classList.add(card.suit==='hearts'||card.suit==='diamonds' ? 'red' : 'black');
    const rankStr = RANK_NAMES[card.rank] || card.rank;
    const suitStr = SUIT_SYMBOLS[card.suit];
    div.innerHTML = `<span class="card-corner">${rankStr}<br>${suitStr}</span><span class="card-suit">${suitStr}</span><span class="card-rank">${rankStr}</span>`;
  }
  return div;
}

function sortHand(cards) {
  return cards.slice().sort((a,b) => b.rank - a.rank || b.suit.localeCompare(a.suit));
}

// ===== 叫牌选择器 =====
const BID_RANKS = [
  {name:'3',rank:1},{name:'4',rank:2},{name:'5',rank:3},{name:'6',rank:4},
  {name:'7',rank:5},{name:'8',rank:6},{name:'9',rank:7},{name:'10',rank:8}
];
const SUITS = [
  {suit:'spades',symbol:'♠'},{suit:'hearts',symbol:'♥'},
  {suit:'clubs',symbol:'♣'},{suit:'diamonds',symbol:'♦'}
];
let selectedBidCards = [];

function renderBidPicker() {
  const container = document.getElementById('bid-picker');
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'bid-picker-row bid-picker-header';
  const lbl = document.createElement('div');
  lbl.className = 'bid-cell-label';
  lbl.textContent = '点数';
  header.appendChild(lbl);
  for (const s of SUITS) {
    const cell = document.createElement('div');
    cell.className = 'bid-cell-suit bid-cell-label';
    cell.textContent = s.symbol;
    cell.classList.add(s.suit==='hearts'||s.suit==='diamonds'?'red':'black');
    header.appendChild(cell);
  }
  container.appendChild(header);
  for (const r of BID_RANKS) {
    const row = document.createElement('div');
    row.className = 'bid-picker-row';
    const rl = document.createElement('div');
    rl.className = 'bid-cell-label';
    rl.textContent = r.name;
    row.appendChild(rl);
    for (const s of SUITS) {
      const card = {suit:s.suit, rank:r.rank, display:r.name+s.symbol};
      const cell = document.createElement('div');
      cell.className = 'bid-cell bid-cell-clickable';
      cell.classList.add(s.suit==='hearts'||s.suit==='diamonds'?'red':'black');
      cell.textContent = s.symbol + r.name;
      cell.addEventListener('click', () => toggleBidCell(card, cell));
      row.appendChild(cell);
    }
    container.appendChild(row);
  }
}

function toggleBidCell(card, el) {
  const idx = selectedBidCards.findIndex(c=>c.suit===card.suit&&c.rank===card.rank);
  if (idx !== -1) {
    selectedBidCards.splice(idx,1);
    el.classList.remove('selected');
  } else {
    if (selectedBidCards.length >= 2) {
      selectedBidCards = [];
      document.querySelectorAll('#bid-picker .bid-cell.selected').forEach(c=>c.classList.remove('selected'));
    }
    selectedBidCards.push(card);
    el.classList.add('selected');
  }
  updateBidInfo();
}

function updateBidInfo() {
  const info = document.getElementById('bid-selected-info');
  if (!info) return;
  if (selectedBidCards.length===0) info.textContent='请选择2张叫牌';
  else if (selectedBidCards.length===1) info.textContent=`已选：${selectedBidCards[0].display}，再选1张`;
  else info.textContent=`已选：${selectedBidCards[0].display} 和 ${selectedBidCards[1].display}`;
}

let lastGrabCandidate = -1;
let grabMultiplier = 2; // 当前抢主倍数选择

// ===== WebSocket =====
function connect(onOpen) {
  ws = new WebSocket(WS_URL);
  ws.onopen = onOpen;
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => showError('lobby-error', '连接断开，请刷新页面重试');
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== 消息处理 =====
function handleMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      mySeat = msg.seat; roomCode = msg.code;
      renderWaiting(msg.players);
      showView('waiting-view');
      document.getElementById('room-code-display').textContent = roomCode;
      break;
    case 'room_joined':
      mySeat = msg.seat; roomCode = msg.code;
      renderWaiting(msg.players);
      showView('waiting-view');
      document.getElementById('room-code-display').textContent = roomCode;
      break;
    case 'player_joined':
      renderWaiting(msg.players);
      break;
    case 'player_disconnected':
      showError('play-error', `玩家 ${msg.seat+1} 断线了`);
      break;
    case 'state':
      gameState = msg;
      renderState(msg);
      triggerAIIfNeeded(msg);
      break;
    case 'result':
      renderResult(msg);
      showView('result-view');
      break;
    case 'error':
      showError('play-error', msg.msg);
      showError('bid-error', msg.msg);
      break;
    case 'ai_seats_updated':
      serverAiSeats = new Set(msg.aiSeats);
      // 如果带了 players 列表，刷新等待室
      if (msg.players) renderWaiting(msg.players);
      break;
    case 'ai_error':
      console.warn(`AI座位${msg.aiSeat+1}出牌失败: ${msg.error}`);
      // AI出牌失败时，延迟重试（可能是时序问题）
      aiPending.delete(msg.aiSeat);
      if (gameState) setTimeout(() => triggerAIIfNeeded(gameState), 500);
      break;
  }
}

// ===== 等待室渲染 =====
function renderWaiting(players) {
  const container = document.getElementById('waiting-players');
  container.innerHTML = '';
  let count = 0;
  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'waiting-player-row';
    if (p) {
      count++;
      const isAI = serverAiSeats.has(i);
      row.innerHTML = `<span class="seat-num">座位${i+1}</span><span class="player-name">${escapeHtml(p.name)}</span>${i===mySeat?'<span class="you-badge">你</span>':''}${isAI?'<span class="ai-badge">🤖 AI</span>':''}`;
    } else {
      row.innerHTML = `<span class="seat-num">座位${i+1}</span><span class="empty-seat">等待加入...</span>`;
    }
    container.appendChild(row);
  });
  document.getElementById('waiting-hint').textContent = `等待其他玩家加入... (${count}/6)`;
  const startBtn = document.getElementById('btn-start-game');
  if (mySeat === 0 && count === 6) startBtn.classList.remove('hidden');
  else startBtn.classList.add('hidden');

  // 房主显示AI配置区
  const aiSection = document.getElementById('ai-config-section');
  if (aiSection) {
    if (mySeat === 0) aiSection.classList.remove('hidden');
    else aiSection.classList.add('hidden');
  }
}

// ===== AI配置面板渲染 =====
// ===== AI配置 localStorage 持久化 =====
const AI_DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.0-flash',
  kimi: 'moonshot-v1-8k',
  qwen: 'qwen-plus',
  deepseek: 'deepseek-chat',
  custom: '',
};

function saveAIConfigs() {
  const data = {};
  aiConfigs.forEach((cfg, seat) => { data[seat] = cfg; });
  try { localStorage.setItem('ai_configs', JSON.stringify(data)); } catch(e) {}
}

function loadAIConfigs() {
  try {
    const raw = localStorage.getItem('ai_configs');
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.entries(data).forEach(([seat, cfg]) => {
      aiConfigs.set(parseInt(seat), cfg);
    });
  } catch(e) {}
}

function showAISaveToast(seat) {
  const el = document.getElementById(`ai-save-toast-${seat}`);
  if (!el) return;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 1800);
}

function renderAISeatList() {
  const container = document.getElementById('ai-seat-list');
  if (!container) return;
  container.innerHTML = '';

  // 顶部说明
  const hint = document.createElement('p');
  hint.className = 'ai-hint';
  hint.textContent = '勾选启用后填写 API Key，点击"保存"即可让该座位由AI控制。配置自动存储在本地浏览器，不上传服务器。';
  container.appendChild(hint);

  for (let i = 0; i < 6; i++) {
    const isAI = aiConfigs.has(i);
    const cfg = aiConfigs.get(i) || {};
    const item = document.createElement('div');
    item.className = 'ai-seat-item';
    const isOwner = i === 0;
    item.innerHTML = `
      <div class="ai-seat-header">
        <label class="ai-seat-toggle">
          <input type="checkbox" data-seat="${i}" ${isAI ? 'checked' : ''}>
          <span>座位${i+1}${isOwner?' (房主)':''}</span>
        </label>
        <span class="ai-seat-status ${isAI ? 'ai-active' : 'ai-inactive'}" id="ai-status-${i}">
          ${isAI ? '🤖 AI已加入' : (isOwner ? '👤 房主' : '空位')}
        </span>
      </div>
      <div class="ai-seat-config ${isAI ? '' : 'hidden'}" id="ai-cfg-${i}">
        <select class="ai-select" data-seat="${i}" data-field="provider">
          <option value="openai" ${cfg.provider==='openai'?'selected':''}>OpenAI</option>
          <option value="anthropic" ${cfg.provider==='anthropic'?'selected':''}>Claude (Anthropic)</option>
          <option value="gemini" ${cfg.provider==='gemini'?'selected':''}>Gemini (Google)</option>
          <option value="kimi" ${cfg.provider==='kimi'?'selected':''}>Kimi 月之暗面</option>
          <option value="qwen" ${cfg.provider==='qwen'?'selected':''}>Qwen 通义千问</option>
          <option value="deepseek" ${cfg.provider==='deepseek'?'selected':''}>DeepSeek</option>
          <option value="custom" ${cfg.provider==='custom'?'selected':''}>自定义API</option>
        </select>
        <input class="ai-input" type="text" placeholder="模型名称" data-seat="${i}" data-field="model" value="${escapeHtml(cfg.model||'')}">
        <input class="ai-input" type="password" placeholder="API Key（仅存本地）" data-seat="${i}" data-field="apiKey" value="${escapeHtml(cfg.apiKey||'')}">
        <input class="ai-input ai-endpoint ${cfg.provider==='custom'?'':'hidden'}" type="text" placeholder="自定义API端点 URL" data-seat="${i}" data-field="endpoint" value="${escapeHtml(cfg.endpoint||'')}">
        <div class="ai-save-row">
          <button class="btn btn-primary btn-sm ai-save-btn" data-seat="${i}">保存配置</button>
          <button class="btn btn-ghost btn-sm ai-test-btn" data-seat="${i}">测试连接</button>
          <span class="ai-save-toast hidden" id="ai-save-toast-${i}">✅ 已保存</span>
        </div>
        <div class="ai-test-result hidden" id="ai-test-result-${i}"></div>
      </div>
    `;
    container.appendChild(item);
  }

  // checkbox：启用/禁用AI座位
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const seat = parseInt(e.target.dataset.seat);
      const cfgDiv = document.getElementById(`ai-cfg-${seat}`);
      const statusEl = document.getElementById(`ai-status-${seat}`);
      if (e.target.checked) {
        const provider = 'openai';
        if (!aiConfigs.has(seat)) aiConfigs.set(seat, { provider, model: AI_DEFAULT_MODELS[provider], apiKey: '', endpoint: '' });
        cfgDiv.classList.remove('hidden');
        if (statusEl) { statusEl.textContent = '🤖 AI已加入'; statusEl.className = 'ai-seat-status ai-active'; }
        send({ type: 'ai_seat_config', seat, isAI: true });
        saveAIConfigs();
      } else {
        aiConfigs.delete(seat);
        cfgDiv.classList.add('hidden');
        if (statusEl) { statusEl.textContent = '空位'; statusEl.className = 'ai-seat-status ai-inactive'; }
        send({ type: 'ai_seat_config', seat, isAI: false });
        saveAIConfigs();
      }
    });
  });

  // provider 切换：自动填入默认模型名
  container.querySelectorAll('.ai-select').forEach(el => {
    el.addEventListener('change', (e) => {
      const seat = parseInt(e.target.dataset.seat);
      if (!aiConfigs.has(seat)) return;
      const cfg = aiConfigs.get(seat);
      cfg.provider = e.target.value;
      // 自动填入默认模型
      const defaultModel = AI_DEFAULT_MODELS[e.target.value] || '';
      cfg.model = defaultModel;
      const modelInput = document.querySelector(`.ai-input[data-seat="${seat}"][data-field="model"]`);
      if (modelInput) modelInput.value = defaultModel;
      // 自定义API显示endpoint
      const endpointEl = document.querySelector(`.ai-endpoint[data-seat="${seat}"]`);
      if (endpointEl) endpointEl.classList.toggle('hidden', e.target.value !== 'custom');
    });
  });

  // 其他输入框实时同步到内存
  container.querySelectorAll('.ai-input').forEach(el => {
    el.addEventListener('input', (e) => {
      const seat = parseInt(e.target.dataset.seat);
      const field = e.target.dataset.field;
      if (!aiConfigs.has(seat)) return;
      aiConfigs.get(seat)[field] = e.target.value;
    });
  });

  // 保存按钮：持久化到 localStorage
  container.querySelectorAll('.ai-save-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const seat = parseInt(e.target.dataset.seat);
      if (!aiConfigs.has(seat)) return;
      saveAIConfigs();
      showAISaveToast(seat);
    });
  });

  // 测试连接按钮
  container.querySelectorAll('.ai-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const seat = parseInt(e.target.dataset.seat);
      if (!aiConfigs.has(seat)) return;
      const cfg = aiConfigs.get(seat);
      const resultEl = document.getElementById(`ai-test-result-${seat}`);
      if (!resultEl) return;

      btn.disabled = true;
      btn.textContent = '测试中...';
      resultEl.className = 'ai-test-result';
      resultEl.textContent = '';

      try {
        const reply = await window.AIWorker.testConnection(cfg);
        resultEl.className = 'ai-test-result test-ok';
        resultEl.textContent = `✅ 连接成功！模型回复：${reply.slice(0, 60)}`;
      } catch (err) {
        resultEl.className = 'ai-test-result test-fail';
        resultEl.textContent = `❌ 连接失败：${err.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
      }
    });
  });
}

// ===== 游戏状态路由 =====
function renderState(state) {
  const { phase } = state;
  // 始终同步服务器AI座位集合
  if (state.aiSeats) serverAiSeats = new Set(state.aiSeats);
  if (phase === 'waiting') {
    showView('waiting-view');
    renderWaiting(state.players);
    // 房主：自动把本地 aiConfigs 同步给服务器（play_again 后恢复AI座位）
    if (mySeat === 0 && aiConfigs.size > 0) {
      aiConfigs.forEach((cfg, seat) => {
        send({ type: 'ai_seat_config', seat, isAI: true });
      });
    }
    return;
  }
  if (['bidding','bid_reveal','objection','grab','bid_confirmed','bid_d_multiplier'].includes(phase)) {
    showView('bid-view');
    renderBidPhase(state);
    return;
  }
  if (phase === 'playing') { showView('play-view'); renderPlayPhase(state); return; }
}

// ===== 叫主阶段渲染 =====
const BID_PANELS = [
  'bid-step-select','bid-waiting-select',
  'bid-reveal-section',
  'bid-step-objection','bid-waiting-objection',
  'bid-step-grab','bid-waiting-grab',
  'bid-step-start','bid-waiting-start',
  'bid-step-d-multiplier','bid-waiting-d-multiplier'
];

function renderBidPhase(state) {
  const { phase, players, mySeat: seat, myHand, callerIndex,
          bidCards, bidSituation, visibleSituation, pendingConfig, objectionPlayer, grabPhase, totalScores } = state;

  const callerName = players[callerIndex]?.name || `玩家${callerIndex+1}`;
  document.getElementById('bid-caller-name').textContent = `叫主者：${escapeHtml(callerName)}`;

  // 积分栏
  const scoresBar = document.getElementById('bid-scores-bar');
  if (scoresBar && totalScores) {
    scoresBar.innerHTML = '';
    players.forEach((p, i) => {
      if (!p) return;
      const item = document.createElement('div');
      item.className = 'bid-score-item';
      const sc = totalScores[i] || 0;
      item.innerHTML = `<span class="bid-score-name">${escapeHtml(p.name)}</span><span class="bid-score-val ${sc>0?'positive':sc<0?'negative':'zero'}">${sc>0?'+':''}${sc}</span>`;
      scoresBar.appendChild(item);
    });
    // 房主显示清空按钮
    if (seat === 0) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-ghost btn-sm bid-reset-btn';
      resetBtn.textContent = '清空积分';
      resetBtn.addEventListener('click', () => {
        if (confirm('确定清空所有积分？清空后下一局重新从♦3开始。')) {
          send({ type: 'reset_scores' });
        }
      });
      scoresBar.appendChild(resetBtn);
    }
  }

  const handEl = document.getElementById('bid-my-hand');
  handEl.innerHTML = '';
  sortHand(myHand).forEach(c => handEl.appendChild(renderCard(c, true)));

  BID_PANELS.forEach(id => hidePanels(id));

  // ── 阶段1：叫主者选牌 ──
  if (phase === 'bidding') {
    if (seat === callerIndex) {
      showPanel('bid-step-select');
      selectedBidCards = [];
      renderBidPicker();
      updateBidInfo();
    } else {
      showPanel('bid-waiting-select');
      document.getElementById('bid-waiting-select-msg').textContent = `等待 ${escapeHtml(callerName)} 选牌...`;
    }
    return;
  }

  // ── 情形D倍数选择 ──
  if (phase === 'bid_d_multiplier') {
    if (seat === callerIndex) {
      showPanel('bid-step-d-multiplier');
    } else {
      showPanel('bid-waiting-d-multiplier');
      document.getElementById('bid-waiting-d-msg').textContent = `等待 ${escapeHtml(callerName)} 决定...`;
    }
    return;
  }

  // ── 阶段2：展示叫牌（所有人可见） ──
  if (['bid_reveal','objection','grab','bid_confirmed'].includes(phase)) {
    showPanel('bid-reveal-section');
    const revealEl = document.getElementById('bid-reveal-cards');
    revealEl.innerHTML = '';
    (bidCards||[]).forEach(c => revealEl.appendChild(renderCard(c, false)));
    // D3（3倍公示）显示1v5标签；D2（2倍不公示）不显示
    const label = document.getElementById('bid-situation-label');
    if (visibleSituation === 'D3') {
      label.textContent = '1v5 单挑（3倍）';
      label.style.color = 'var(--color-primary)';
    } else {
      label.textContent = '';
    }
  }

  // ── 阶段2a：异议确认 ──
  if (phase === 'bid_reveal' && bidSituation === 'B' && objectionPlayer !== null) {
    if (seat === objectionPlayer) {
      showPanel('bid-step-objection');
      document.getElementById('bid-objection-cards').textContent =
        bidCards?.length===2 ? `${bidCards[0].display} 和 ${bidCards[1].display}` : '';
    } else {
      showPanel('bid-waiting-objection');
      document.getElementById('bid-waiting-objection-msg').textContent = '等待玩家确认...';
    }
    return;
  }

  // ── 阶段2b：抢1v5 ──
  if (phase === 'grab' && grabPhase) {
    const currentCandidate = grabPhase.currentCandidate;
    if (seat === currentCandidate) {
      showPanel('bid-step-grab');
    } else {
      showPanel('bid-waiting-grab');
      const cName = players[currentCandidate]?.name || `玩家${currentCandidate+1}`;
      document.getElementById('bid-waiting-grab-msg').textContent = `等待 ${escapeHtml(cName)} 决定是否抢1v5...`;
    }
    return;
  }

  // ── 阶段3：确认完毕 ──
  if (phase === 'bid_confirmed') {
    if (seat === callerIndex) {
      showPanel('bid-step-start');
      document.getElementById('bid-confirmed-info').textContent = '队伍确认完毕，可以开始游戏';
    } else {
      showPanel('bid-waiting-start');
    }
    return;
  }
}

function getSituationLabel(situation, config, players) {
  if (!config) return '';
  if (config.mode === '3v3') {
    const p = config.partners.map(i => players[i]?.name || `玩家${i+1}`).join('、');
    return `3v3 — 伙伴：${p}`;
  }
  if (config.mode === '2v4') {
    const p = config.partners.map(i => players[i]?.name || `玩家${i+1}`).join('、');
    return `2v4 — 伙伴：${p}`;
  }
  if (config.mode === '1v5') {
    return `1v5 — 单挑五人`;
  }
  return '';
}

// ===== 出牌阶段渲染 =====
function renderPlayPhase(state) {
  const { players, mySeat: seat, myHand, handCounts, trickState, rankings, bidCards, teamConfig, attackerIndex, isFirstGame } = state;
  selectedCards = selectedCards.filter(sc => myHand.some(c=>c.suit===sc.suit&&c.rank===sc.rank));

  const currentPlayer = trickState ? trickState.currentPlayer : -1;
  const curName = players[currentPlayer]?.name || '';
  document.getElementById('play-current-player').textContent =
    currentPlayer === seat ? '轮到你出牌' : `等待：${escapeHtml(curName)}`;

  const leadPlay = trickState ? trickState.leadPlay : null;
  document.getElementById('play-trick-info').textContent = leadPlay
    ? `领先：${playTypeLabel(leadPlay.type)}` : '新一轮（自由出牌）';

  // 第一局第一手提示
  const firstHintEl = document.getElementById('first-trick-hint');
  if (firstHintEl) {
    if (isFirstGame && !leadPlay && currentPlayer === seat) {
      firstHintEl.textContent = '⚠️ 第一局第一手必须出含♦3的牌';
      firstHintEl.classList.remove('hidden');
    } else {
      firstHintEl.classList.add('hidden');
    }
  }

  // 主攻方 + 叫牌信息
  const attackerName = (attackerIndex !== undefined && players[attackerIndex])
    ? players[attackerIndex].name : '';
  // 判断是否有人抢了1v5
  const isGrab = teamConfig && teamConfig.grabber !== undefined;
  const attackerLabel = isGrab ? `抢1V5（4倍）：${escapeHtml(attackerName)}` : `叫主：${escapeHtml(attackerName)}`;
  const bidInfo = bidCards?.length === 2
    ? `叫牌：${bidCards[0].display} ${bidCards[1].display}　${attackerLabel}`
    : '';
  document.getElementById('play-bid-info').textContent = bidInfo;

  const rankBar = document.getElementById('rankings-bar');
  rankBar.innerHTML = '';
  rankings.forEach((pi, idx) => {
    const badge = document.createElement('span');
    badge.className = `rank-badge rank-${idx+1}`;
    badge.textContent = `第${idx+1}名: ${escapeHtml(players[pi]?.name||'')}`;
    rankBar.appendChild(badge);
  });

  const othersEl = document.getElementById('other-players');
  othersEl.innerHTML = '';
  // 找下一位活跃玩家（当前玩家的下家）
  let nextActive = -1;
  if (currentPlayer >= 0) {
    let n = (currentPlayer + 1) % 6, cnt = 0;
    while (cnt < 6) {
      if (players[n] && handCounts[n] > 0) { nextActive = n; break; }
      n = (n + 1) % 6; cnt++;
    }
  }
  const nextHasOne = nextActive !== -1 && handCounts[nextActive] === 1;

  players.forEach((p, i) => {
    if (!p) return;
    const div = document.createElement('div');
    const isSelf = i === seat;
    div.className = 'other-player-info' + (i===currentPlayer?' active':'') + (isSelf?' self':'');
    const count = handCounts[i];
    const countHtml = count === 1
      ? `<span class="other-count last-card">⚠️ 最后1张</span>`
      : '';
    const selfBadge = isSelf ? '<span class="self-badge">我</span>' : '';
    div.innerHTML = `<span class="other-name">${escapeHtml(p.name)}</span>${selfBadge}${countHtml}`;
    othersEl.appendChild(div);
  });

  // 下家剩1张时，提示当前玩家出单牌限制
  const singleWarnEl = document.getElementById('single-card-warn');
  if (currentPlayer === seat && nextHasOne) {
    singleWarnEl.textContent = `⚠️ 下家（${escapeHtml(players[nextActive].name)}）只剩1张，出单牌须出最大，无法拦截才可Pass`;
    singleWarnEl.classList.remove('hidden');
  } else {
    singleWarnEl.classList.add('hidden');
  }

  const trickEl = document.getElementById('trick-table');
  trickEl.innerHTML = '';
  if (trickState && players) {
    players.forEach((p, i) => {
      if (!p) return;
      const col = document.createElement('div');
      col.className = 'trick-col';
      if (i === currentPlayer) col.classList.add('trick-col-active');

      const nameEl = document.createElement('div');
      nameEl.className = 'trick-col-name';
      nameEl.textContent = p.name + (i === seat ? '（我）' : '');
      col.appendChild(nameEl);

      // 显示该玩家本轮所有出牌记录，每次往下偏移
      const allTps = trickState.plays.filter(x => x.playerIndex === i && x.play !== null);
      const lastPass = trickState.plays.filter(x => x.playerIndex === i).slice(-1)[0];
      const hasPass = lastPass && lastPass.play === null;

      const cardsEl = document.createElement('div');
      cardsEl.className = 'trick-col-cards';

      if (allTps.length === 0 && !hasPass) {
        cardsEl.innerHTML = '<span class="trick-waiting">-</span>';
      } else if (allTps.length === 0 && hasPass) {
        cardsEl.innerHTML = '<span class="trick-pass">Pass</span>';
      } else {
        // 每次出牌叠加显示，后一次向下偏移
        const wrapEl = document.createElement('div');
        wrapEl.className = 'trick-plays-stack';
        allTps.forEach((tp, rowIdx) => {
          const cards = tp.play.cards;
          const rowEl = document.createElement('div');
          rowEl.className = 'trick-fan-row';
          rowEl.style.setProperty('--row-idx', rowIdx);
          // 5张牌用更小偏移
          const offset = cards.length >= 5 ? 8 : 14;
          const fanEl = document.createElement('div');
          fanEl.className = 'trick-fan';
          fanEl.style.setProperty('--fan-offset', offset + 'px');
          fanEl.style.width = `calc(${cards.length >= 5 ? 30 : 36}px + ${cards.length - 1} * ${offset}px)`;
          cards.forEach((c, idx) => {
            const cardEl = renderCard(c, true);
            cardEl.style.setProperty('--fan-idx', idx);
            cardEl.style.setProperty('--fan-total', cards.length);
            if (cards.length >= 5) cardEl.classList.add('card-xs');
            fanEl.appendChild(cardEl);
          });
          // 最新一条是领先牌时高亮
          const isLead = rowIdx === allTps.length - 1 && trickState.leadPlay &&
            tp.play.value === trickState.leadPlay.value &&
            tp.play.type === trickState.leadPlay.type;
          if (isLead) fanEl.classList.add('trick-fan-lead');
          rowEl.appendChild(fanEl);
          wrapEl.appendChild(rowEl);
        });
        if (hasPass) {
          const passEl = document.createElement('div');
          passEl.className = 'trick-fan-row';
          passEl.style.setProperty('--row-idx', allTps.length);
          passEl.innerHTML = '<span class="trick-pass">Pass</span>';
          wrapEl.appendChild(passEl);
        }
        cardsEl.appendChild(wrapEl);
      }

      col.appendChild(cardsEl);
      trickEl.appendChild(col);
    });
  }

  const handEl = document.getElementById('hand-cards');
  handEl.innerHTML = '';
  sortHand(myHand).forEach(card => {
    const el = renderCard(card, false);
    if (selectedCards.some(sc=>sc.suit===card.suit&&sc.rank===card.rank)) el.classList.add('selected');
    el.addEventListener('click', () => {
      const idx = selectedCards.findIndex(sc=>sc.suit===card.suit&&sc.rank===card.rank);
      if (idx!==-1) { selectedCards.splice(idx,1); el.classList.remove('selected'); }
      else { selectedCards.push(card); el.classList.add('selected'); }
      clearError('play-error');
    });
    handEl.appendChild(el);
  });
  document.getElementById('hand-count').textContent = `(${myHand.length}张)`;

  const isMyTurn = currentPlayer === seat;
  document.getElementById('btn-play').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn;
}

function playTypeLabel(type) {
  const m = {single:'单张',pair:'对子',triple:'三张',straight:'顺子',flush:'同花式',
    flush_straight:'同花顺',full_house:'三带二',four_of_a_kind:'四打一'};
  return m[type] || type;
}

// ===== 结算渲染 =====
function renderResult(msg) {
  const { rankings, teamConfig, scoreDeltas, players, history } = msg;
  const modeLabels = {'1v5':'1v5 单挑','2v4':'2v4 双打','3v3':'3v3 对决'};
  document.getElementById('result-mode').textContent = modeLabels[teamConfig.mode] || teamConfig.mode;

  const rankEl = document.getElementById('result-rankings');
  rankEl.innerHTML = '<h3>名次结果</h3>';
  rankings.forEach((pi, rank) => {
    const row = document.createElement('div');
    row.className = 'ranking-row';
    row.innerHTML = `<div class="ranking-num rank-${rank+1}">${rank+1}</div>
      <div class="ranking-name">${escapeHtml(players[pi]||'')}</div>`;
    rankEl.appendChild(row);
  });

  // 计算累计积分（含本局）
  const totals = {};
  players.forEach(name => { if (name) totals[name] = 0; });
  (history||[]).forEach(r => {
    players.forEach((name, i) => {
      if (name) totals[name] = (totals[name]||0) + (r.scoreDeltas[i]||0);
    });
  });

  // 本局积分变化
  const scEl = document.getElementById('result-scores');
  scEl.innerHTML = '<h3>本局积分</h3>';
  players.forEach((name, i) => {
    if (!name) return;
    const delta = scoreDeltas[i];
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `<div class="score-name">${escapeHtml(name)}</div>
      <div class="score-delta ${delta>0?'positive':delta<0?'negative':'zero'}">${delta>0?'+':''}${delta}</div>
      <div class="score-total">累计：${totals[name]||0}</div>`;
    scEl.appendChild(row);
  });

  // 所有人累计积分排行
  const totalEl = document.getElementById('result-totals');
  if (totalEl) {
    totalEl.innerHTML = '<h3>积分排行</h3>';
    const sorted = players
      .map((name, i) => ({ name, total: totals[name]||0 }))
      .filter(x => x.name)
      .sort((a, b) => b.total - a.total);
    sorted.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<div class="score-name">${idx+1}. ${escapeHtml(item.name)}</div>
        <div class="score-total ${item.total>0?'positive':item.total<0?'negative':'zero'}">${item.total>0?'+':''}${item.total}</div>`;
      totalEl.appendChild(row);
    });
  }

  document.getElementById('btn-play-again').classList.toggle('hidden', mySeat !== 0);
  const resetBtn = document.getElementById('btn-reset-scores');
  if (resetBtn) resetBtn.classList.toggle('hidden', mySeat !== 0);
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
  try {
  const urlParams = new URLSearchParams(location.search);
  const codeFromUrl = urlParams.get('room');
  if (codeFromUrl) document.getElementById('lobby-code').value = codeFromUrl.toUpperCase();

  document.getElementById('btn-create-room').addEventListener('click', () => {
    const name = document.getElementById('lobby-name').value.trim();
    if (!name) { showError('lobby-error','请输入你的名字'); return; }
    myName = name;
    connect(() => send({ type:'create_room', name }));
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const name = document.getElementById('lobby-name').value.trim();
    const code = document.getElementById('lobby-code').value.trim().toUpperCase();
    if (!name) { showError('lobby-error','请输入你的名字'); return; }
    if (code.length !== 6) { showError('lobby-error','请输入6位房间码'); return; }
    myName = name;
    connect(() => send({ type:'join_room', name, code }));
  });

  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      document.getElementById('btn-copy-link').textContent = '已复制！';
      setTimeout(() => document.getElementById('btn-copy-link').textContent = '复制链接', 2000);
    });
  });

  document.getElementById('btn-start-game').addEventListener('click', () => send({ type:'start_game' }));

  document.getElementById('btn-bid-confirm').addEventListener('click', () => {
    if (selectedBidCards.length !== 2) { showError('bid-error','请选择2张叫牌'); return; }
    send({ type:'bid_confirm', bidCards: selectedBidCards });
  });

  document.getElementById('btn-bid-objection-yes').addEventListener('click', () => {
    send({ type:'objection_response', objected: true });
  });
  document.getElementById('btn-bid-objection-no').addEventListener('click', () => {
    send({ type:'objection_response', objected: false });
  });

  document.getElementById('btn-bid-grab-confirm').addEventListener('click', () => {
    send({ type:'grab_response', grab: true, multiplier: 4 });
  });
  document.getElementById('btn-bid-grab-skip').addEventListener('click', () => {
    send({ type:'grab_response', grab: false });
  });

  document.getElementById('btn-bid-d-2x').addEventListener('click', () => {
    send({ type:'bid_d_multiplier', multiplier: 2 });
  });
  document.getElementById('btn-bid-d-3x').addEventListener('click', () => {
    send({ type:'bid_d_multiplier', multiplier: 3 });
  });

  document.getElementById('btn-start-playing').addEventListener('click', () => {
    send({ type:'start_playing' });
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    if (selectedCards.length === 0) { showError('play-error','请先选择要出的牌'); return; }
    send({ type:'play_cards', cards: selectedCards });
    selectedCards = [];
  });

  document.getElementById('btn-pass').addEventListener('click', () => send({ type:'pass' }));

  document.getElementById('btn-play-again').addEventListener('click', () => send({ type:'play_again' }));

  document.getElementById('btn-reset-scores').addEventListener('click', () => {
    if (confirm('确定清空所有积分？清空后下一局重新从♦3开始。')) {
      send({ type: 'reset_scores' });
    }
  });

  // 规则说明书折叠
  const rulesToggle = document.getElementById('rules-toggle');
  const rulesBody = document.getElementById('rules-body');
  const rulesArrow = document.getElementById('rules-arrow');
  if (rulesToggle && rulesBody && rulesArrow) {
    // 初始收起
    rulesBody.style.display = 'none';
    rulesToggle.addEventListener('click', () => {
      const isHidden = rulesBody.style.display === 'none';
      rulesBody.style.display = isHidden ? 'flex' : 'none';
      rulesArrow.textContent = isHidden ? '▲' : '▼';
    });
  }

  // AI配置面板折叠
  loadAIConfigs(); // 从 localStorage 恢复配置
  const btnToggleAI = document.getElementById('btn-toggle-ai-config');
  const aiPanel = document.getElementById('ai-config-panel');
  if (btnToggleAI && aiPanel) {
    btnToggleAI.addEventListener('click', () => {
      const isHidden = aiPanel.classList.contains('hidden');
      if (isHidden) {
        aiPanel.classList.remove('hidden');
        renderAISeatList();
        // 把已保存的AI座位同步给服务器
        aiConfigs.forEach((cfg, seat) => {
          send({ type: 'ai_seat_config', seat, isAI: true });
        });
        btnToggleAI.textContent = '🤖 收起AI设置';
      } else {
        aiPanel.classList.add('hidden');
        btnToggleAI.textContent = '🤖 AI玩家设置';
      }
    });
  }
  } catch(e) {
    console.error('DOMContentLoaded error:', e);
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;padding:8px;font-size:12px;z-index:9999;word-break:break-all">'
      + 'Init错误: ' + e.message + '</div>');
  }
});


// ===== AI 自动出牌 =====
// 只有房主（seat=0）负责驱动所有AI座位
async function triggerAIIfNeeded(state) {
  if (mySeat !== 0) return; // 只有房主驱动AI
  if (!window.AIWorker) return;

  const { phase, aiSeats } = state;
  if (!aiSeats || aiSeats.length === 0) return;

  // 更新本地AI座位集合
  serverAiSeats = new Set(aiSeats);

  // 出牌阶段
  if (phase === 'playing') {
    const currentPlayer = state.trickState?.currentPlayer;
    if (currentPlayer === undefined || currentPlayer === -1) return;
    if (!serverAiSeats.has(currentPlayer)) return;
    if (aiPending.has(currentPlayer)) return;
    const cfg = aiConfigs.get(currentPlayer);
    if (!cfg || !cfg.apiKey) {
      await triggerAIPlay(currentPlayer, state, null);
    } else {
      await triggerAIPlay(currentPlayer, state, cfg);
    }
    return;
  }

  // 叫主阶段
  if (phase === 'bidding') {
    const caller = state.callerIndex;
    if (!serverAiSeats.has(caller)) return;
    if (aiPending.has(caller)) return;
    aiPending.add(caller);
    await delay(1000 + Math.random() * 1500);
    try {
      const cfg = aiConfigs.get(caller);
      const bidCards = await window.AIWorker.aiDecideBid(cfg || {}, state);
      send({ type: 'ai_action', aiSeat: caller, action: 'bid_confirm', bidCards });
    } finally {
      aiPending.delete(caller);
    }
    return;
  }

  // 情形D倍数选择
  if (phase === 'bid_d_multiplier') {
    const caller = state.callerIndex;
    if (!serverAiSeats.has(caller)) return;
    if (aiPending.has(caller)) return;
    aiPending.add(caller);
    await delay(800 + Math.random() * 1000);
    try {
      const cfg = aiConfigs.get(caller);
      const multiplier = await window.AIWorker.aiDecideDMultiplier(cfg || {}, state);
      send({ type: 'ai_action', aiSeat: caller, action: 'bid_d_multiplier', multiplier });
    } finally {
      aiPending.delete(caller);
    }
    return;
  }

  // 异议阶段
  if (phase === 'bid_reveal' && state.bidSituation === 'B' && state.objectionPlayer !== null) {
    const op = state.objectionPlayer;
    if (!serverAiSeats.has(op)) return;
    if (aiPending.has(op)) return;
    aiPending.add(op);
    await delay(800 + Math.random() * 800);
    try {
      const cfg = aiConfigs.get(op);
      // 构建AI视角的state（使用AI座位的手牌）
      const aiHand = state.aiHands && state.aiHands[op];
      const aiState = { ...state, myHand: aiHand || [], mySeat: op };
      const { objected } = await window.AIWorker.aiDecideObjection(cfg || {}, aiState);
      send({ type: 'ai_action', aiSeat: op, action: 'objection_response', objected });
    } finally {
      aiPending.delete(op);
    }
    return;
  }

  // 抢主阶段
  if (phase === 'grab' && state.grabPhase) {
    const candidate = state.grabPhase.currentCandidate;
    if (!serverAiSeats.has(candidate)) return;
    if (aiPending.has(candidate)) return;
    aiPending.add(candidate);
    await delay(800 + Math.random() * 1000);
    try {
      const cfg = aiConfigs.get(candidate);
      const { grab, multiplier } = await window.AIWorker.aiDecideGrab(cfg || {}, state);
      send({ type: 'ai_action', aiSeat: candidate, action: 'grab_response', grab, multiplier: multiplier || 4 });
    } finally {
      aiPending.delete(candidate);
    }
    return;
  }

  // 确认完毕，叫主者开始游戏
  if (phase === 'bid_confirmed') {
    const caller = state.callerIndex;
    if (!serverAiSeats.has(caller)) return;
    if (aiPending.has(caller)) return;
    aiPending.add(caller);
    await delay(600);
    try {
      send({ type: 'ai_action', aiSeat: caller, action: 'start_playing' });
    } finally {
      aiPending.delete(caller);
    }
    return;
  }
}

async function triggerAIPlay(seat, state, cfg) {
  aiPending.add(seat);
  await delay(800 + Math.random() * 1500);
  try {
    // 所有AI座位的手牌都通过 aiHands 获取（服务器统一发给房主）
    const aiHand = state.aiHands && state.aiHands[seat];
    if (!aiHand) {
      send({ type: 'ai_action', aiSeat: seat, action: 'pass' });
      return;
    }

    // 构建AI视角的state
    const aiState = { ...state, myHand: aiHand, mySeat: seat };
    const legalPlays = getLegalPlays(aiHand, state.trickState?.leadPlay);

    let chosen;
    if (cfg && cfg.apiKey) {
      chosen = await window.AIWorker.aiDecide(cfg, aiState, legalPlays);
    } else {
      // 随机策略
      if (legalPlays.length > 0) {
        chosen = legalPlays[Math.floor(Math.random() * legalPlays.length)];
      } else {
        chosen = null;
      }
    }

    if (chosen) {
      send({ type: 'ai_action', aiSeat: seat, action: 'play_cards', cards: chosen });
    } else {
      send({ type: 'ai_action', aiSeat: seat, action: 'pass' });
    }
  } catch (e) {
    console.warn('AI出牌异常:', e);
    send({ type: 'ai_action', aiSeat: seat, action: 'pass' });
  } finally {
    aiPending.delete(seat);
  }
}

// 计算合法出牌列表（从手牌中枚举所有合法牌型）
function getLegalPlays(hand, leadPlay) {
  if (!hand || hand.length === 0) return [];
  const allCombos = [];

  // 枚举所有可能的出牌组合
  const n = hand.length;

  // 单张
  for (const c of hand) allCombos.push([c]);

  // 对子
  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      const cards = [hand[i], hand[j]];
      if (getClientCardType(cards)) allCombos.push(cards);
    }
  }

  // 三张
  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      for (let k = j+1; k < n; k++) {
        const cards = [hand[i], hand[j], hand[k]];
        if (getClientCardType(cards)) allCombos.push(cards);
      }
    }
  }

  // 5张组合
  if (n >= 5) {
    for (let i = 0; i < n; i++) {
      for (let j = i+1; j < n; j++) {
        for (let k = j+1; k < n; k++) {
          for (let l = k+1; l < n; l++) {
            for (let m = l+1; m < n; m++) {
              const cards = [hand[i], hand[j], hand[k], hand[l], hand[m]];
              if (getClientCardType(cards)) allCombos.push(cards);
            }
          }
        }
      }
    }
  }

  if (!leadPlay) return allCombos;

  // 过滤：必须同牌型且更大
  return allCombos.filter(cards => {
    const type = getClientCardType(cards);
    if (!type) return false;
    const play = { type, value: getClientPlayValue(cards, type) };
    return canBeat(play, leadPlay);
  });
}

function getClientCardType(cards) {
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

function getClientPlayValue(cards, type) {
  const SUIT_RANK = { diamonds:1, clubs:2, hearts:3, spades:4, joker:5 };
  const score = c => c.rank * 10 + (SUIT_RANK[c.suit] || 0);
  const top = arr => arr.reduce((b,c) => score(c)>score(b)?c:b);
  if (type === 'straight' || type === 'flush_straight') {
    const ranks = cards.map(c=>c.rank).sort((a,b)=>a-b);
    const topRank = (ranks[0]===1&&ranks[1]===2&&ranks[2]===3&&ranks[3]===12&&ranks[4]===13) ? 3 : ranks[4];
    return score(top(cards.filter(c=>c.rank===topRank)));
  }
  if (type === 'full_house') {
    const rc = {};
    for (const c of cards) rc[c.rank] = (rc[c.rank]||0)+1;
    const tr = Number(Object.keys(rc).find(r=>rc[r]===3));
    return score(top(cards.filter(c=>c.rank===tr)));
  }
  if (type === 'four_of_a_kind') {
    const rc = {};
    for (const c of cards) rc[c.rank] = (rc[c.rank]||0)+1;
    const qr = Number(Object.keys(rc).find(r=>rc[r]===4));
    return score(top(cards.filter(c=>c.rank===qr)));
  }
  return score(top(cards));
}

function canBeat(play, leadPlay) {
  const smallTypes = new Set(['single','pair','triple']);
  if (smallTypes.has(leadPlay.type) || smallTypes.has(play.type)) {
    if (play.type !== leadPlay.type) return false;
    return play.value > leadPlay.value;
  }
  const level = { straight:1, flush:2, full_house:3, four_of_a_kind:4, flush_straight:5 };
  const la = level[play.type]??0, lb = level[leadPlay.type]??0;
  if (la !== lb) return la > lb;
  return play.value > leadPlay.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
