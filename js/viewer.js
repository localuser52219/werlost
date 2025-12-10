// js/viewer.js
// 觀眾端：顯示大地圖 + 玩家位置 + 四周方位 + 固定目的地

let roomCode = null;
let roomData = null;
let mapSize = 0;
let mapGrid = null;
let initialA = null;   // A 玩家起始位置（用 ix,iy，如無則用 x,y）
let goal = null;       // 固定目的地：A 起始位置的「東北」格

let players = [];      // 最新玩家資料列表

document.addEventListener("DOMContentLoaded", () => {
  roomCode = getRoomCodeFromUrl();
  const statusEl = document.getElementById("viewerStatus");

  if (!roomCode) {
    if (statusEl) statusEl.textContent = "URL 缺少 ?code= 房間代碼";
    return;
  }
  if (!window._supabase) {
    if (statusEl) statusEl.textContent = "Supabase 尚未初始化";
    return;
  }
  if (typeof window.generateMap !== "function" ||
      typeof window.isWall !== "function") {
    if (statusEl) statusEl.textContent = "錯誤：js/shopName.js 未正確載入（需要 generateMap / isWall）";
    return;
  }

  if (statusEl) statusEl.textContent = "載入房間資料中…";
  initViewer(roomCode).catch(err => {
    console.error(err);
    if (statusEl) statusEl.textContent = "載入房間時發生錯誤";
  });
});

// 從 URL 讀取 ?code=
function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  return code ? code.trim() : null;
}

// 初始化：讀取房間 + 建立地圖 + 訂閱 players
async function initViewer(code) {
  const statusEl = document.getElementById("viewerStatus");

  // 讀取房間
  const { data: room, error: roomErr } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (roomErr || !room) {
    console.error(roomErr);
    if (statusEl) statusEl.textContent = "找不到此房間";
    return;
  }

  roomData = room;
  mapSize = room.map_size;
  mapGrid = window.generateMap(room.seed, mapSize);

  drawBaseMap(); // 先畫地圖底

  if (statusEl) statusEl.textContent = "等待玩家資料…";

  // 初次取得 players
  const { data: initPlayers, error: pErr } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id);

  if (pErr) {
    console.error(pErr);
    if (statusEl) statusEl.textContent = "讀取玩家資料失敗";
  } else {
    players = initPlayers || [];
    handlePlayersUpdate();
  }

  // 訂閱 players 變化
  window._supabase
    .channel("viewer-players-" + room.id)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` },
      payload => {
        // 重新取一次 players 比較簡單
        refreshPlayers();
      }
    )
    .subscribe();
}

// 重新讀取 players 資料
async function refreshPlayers() {
  const { data, error } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", roomData.id);

  if (error) {
    console.error(error);
    return;
  }
  players = data || [];
  handlePlayersUpdate();
}

// 處理玩家更新：畫玩家 / 更新遊戲資訊 / 計算目的地
function handlePlayersUpdate() {
  const statusEl = document.getElementById("viewerStatus");

  const pA = players.find(p => p.player_no === 1);
  const pB = players.find(p => p.player_no === 2);

  if (!pA && !pB) {
    if (statusEl) statusEl.textContent = "尚未有玩家加入";
    clearPlayersOnMap();
    updateGameInfo(null, null);
    return;
  }

  if (statusEl) statusEl.textContent = "遊戲進行中…";

  // 確認 A 的「起始位置」只設定一次
  if (pA && !initialA) {
    const ix = (typeof pA.ix === "number") ? pA.ix : pA.x;
    const iy = (typeof pA.iy === "number") ? pA.iy : pA.y;
    initialA = { x: ix, y: iy };

    // 一次性計算「目的地」＝ A 起始位置的東北格（固定）
    goal = computeGoalFromA(initialA);
  }

  drawBaseMap();      // 重新畫地圖
  drawPlayersOnMap(); // 畫玩家位置
  if (goal) drawGoalOnMap(); // 畫目的地（如果存在）

  updateGameInfo(pA, pB);
}

// ========== 地圖繪製 ==========

const CELL_SIZE = 16; // 每格像素大小

function getMapCanvas() {
  const cvs = document.getElementById("viewerMap");
  return cvs;
}

function drawBaseMap() {
  const canvas = getMapCanvas();
  if (!canvas || !mapGrid) return;

  const size = mapSize;
  canvas.width = size * CELL_SIZE;
  canvas.height = size * CELL_SIZE;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 背景
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 畫格子（道路 / 牆）
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isWall = window.isWall(mapGrid, x, y);
      if (isWall) {
        ctx.fillStyle = "#111827";
      } else {
        ctx.fillStyle = "#0b1120";
      }
      ctx.fillRect(
        x * CELL_SIZE,
        y * CELL_SIZE,
        CELL_SIZE - 1,
        CELL_SIZE - 1
      );
    }
  }
}

function clearPlayersOnMap() {
  drawBaseMap();
}

// 將玩家畫成圓點（紅 / 藍）
function drawPlayersOnMap() {
  const canvas = getMapCanvas();
  if (!canvas || !mapGrid) return;
  const ctx = canvas.getContext("2d");

  const pA = players.find(p => p.player_no === 1);
  const pB = players.find(p => p.player_no === 2);

  if (pA) {
    drawPlayerDot(ctx, pA.x, pA.y, "#3b82f6"); // 藍
  }
  if (pB) {
    drawPlayerDot(ctx, pB.x, pB.y, "#ef4444"); // 紅
  }
}

function drawPlayerDot(ctx, gridX, gridY, color) {
  const cx = gridX * CELL_SIZE + CELL_SIZE / 2;
  const cy = gridY * CELL_SIZE + CELL_SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, CELL_SIZE * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// 在地圖上畫出「目的地」標記（黃色閃動圈）
function drawGoalOnMap() {
  const canvas = getMapCanvas();
  if (!canvas || !goal) return;
  const ctx = canvas.getContext("2d");

  const gx = goal.x;
  const gy = goal.y;
  if (gx < 0 || gx >= mapSize || gy < 0 || gy >= mapSize) return;

  const cx = gx * CELL_SIZE + CELL_SIZE / 2;
  const cy = gy * CELL_SIZE + CELL_SIZE / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, CELL_SIZE * 0.45, 0, Math.PI * 2);
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, CELL_SIZE * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "#facc15";
  ctx.fill();

  ctx.restore();
}

// ========== 目的地計算：A 起始位置的東北格 ==========

function computeGoalFromA(startA) {
  if (!mapGrid || !startA) return null;
  const gx = startA.x + 1;  // 東：x+1
  const gy = startA.y - 1;  // 北：y-1（畫面座標向下為正）

  if (gx < 0 || gx >= mapSize || gy < 0 || gy >= mapSize) return null;

  const name = getCellLabel(gx, gy);
  return { x: gx, y: gy, name };
}

// ========== 遊戲資訊：只顯示 NE / SE / NW / SW + 目的地 ==========

function updateGameInfo(pA, pB) {
  const infoAEl = document.getElementById("infoAQuads");
  const infoBEl = document.getElementById("infoBQuads");
  const goalEl = document.getElementById("goalInfo");

  // 玩家 A 周邊
  if (infoAEl && pA) {
    infoAEl.innerHTML = buildQuadInfoHtml(pA.x, pA.y);
  } else if (infoAEl) {
    infoAEl.innerHTML = "<div>玩家 A 未加入</div>";
  }

  // 玩家 B 周邊
  if (infoBEl && pB) {
    infoBEl.innerHTML = buildQuadInfoHtml(pB.x, pB.y);
  } else if (infoBEl) {
    infoBEl.innerHTML = "<div>玩家 B 未加入</div>";
  }

  // 目的地：A 起始位置的東北格
  if (goalEl) {
    if (goal) {
      goalEl.textContent = `目的地：${goal.name} (${goal.x}, ${goal.y})`;
    } else {
      goalEl.textContent = "目的地：尚未設定";
    }
  }
}

// 建構 NE/SE/NW/SW 四格資訊（以玩家當前位置為中心）
function buildQuadInfoHtml(px, py) {
  const ne = getCellLabel(px + 1, py - 1);
  const se = getCellLabel(px + 1, py + 1);
  const nw = getCellLabel(px - 1, py - 1);
  const sw = getCellLabel(px - 1, py + 1);

  return `
    <div>東北(NE)：${ne}</div>
    <div>東南(SE)：${se}</div>
    <div>西北(NW)：${nw}</div>
    <div>西南(SW)：${sw}</div>
  `;
}

// 取得某格的文字標籤（牆 / 店舖 / 道路）
function getCellLabel(x, y) {
  if (!mapGrid || mapSize <= 0) return "";

  if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) {
    return "界外";
  }

  if (typeof window.isWall === "function" && window.isWall(mapGrid, x, y)) {
    return "牆壁";
  }

  // 若有店舖函式就取店名
  if (typeof window.getShopName === "function") {
    try {
      return window.getShopName(mapGrid, x, y);
    } catch (e) {
      console.warn("getShopName 失敗，改用座標標示", e);
    }
  }

  // Fallback：道路 + 座標
  return `(${x},${y}) 道路`;
}
