// js/viewer.js
// 觀眾端：顯示大地圖 + 玩家位置 + 四周方位 + 固定目的地（大星星）

let roomCode = null;
let roomData = null;
let mapSize = 0;
let mapGrid = null;

let initialA = null;   // A 玩家起始「交叉點」位置（ix,iy）
let goal = null;       // 固定目的地：A 起始交叉點的東北格

let players = [];      // 最新玩家資料列表

// 每格像素大小（地圖繪圖用）
const CELL_SIZE = 16;

document.addEventListener("DOMContentLoaded", () => {
  roomCode = getRoomCodeFromUrl();
  const statusEl = document.getElementById("viewerStatus");

  if (!roomCode) {
    if (statusEl) statusEl.textContent = "URL 缺少 ?room= 或 ?code= 房間代碼";
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

// 從 URL 讀取房間代碼：優先用 ?room=，其次用 ?code=
function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromRoom = params.get("room");
  const fromCode = params.get("code");
  const code = fromRoom || fromCode;
  return code ? code.trim() : null;
}

// 初始化：讀取房間 + 建立地圖 + 訂閱 players
async function initViewer(code) {
  const statusEl = document.getElementById("viewerStatus");

  const { data: room, error: roomErr } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)              // DB 裡欄位叫 code，沿用
    .maybeSingle();

  if (roomErr || !room) {
    console.error(roomErr);
    if (statusEl) statusEl.textContent = "找不到此房間：" + code;
    return;
  }

  roomData = room;
  mapSize = room.map_size;
  mapGrid = window.generateMap(room.seed, mapSize);

  drawBaseMap();

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
      () => {
        refreshPlayers();
      }
    )
    .subscribe();
}

// 重新讀取 players 資料
async function refreshPlayers() {
  if (!roomData) return;
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

// 處理玩家更新：畫玩家 / 更新資訊 / 計算目的地
function handlePlayersUpdate() {
  const statusEl = document.getElementById("viewerStatus");

  const pA = players.find(p => p.player_no === 1);
  const pB = players.find(p => p.player_no === 2);

  if (!pA && !pB) {
    if (statusEl) statusEl.textContent = "尚未有玩家加入";
    clearPlayersOnMap();
    updateGameInfo(null, null);
    clearGoalStar();
    return;
  }

  if (statusEl) statusEl.textContent = "遊戲進行中…";

  // A 的初始「交叉點」位置：只記一次
  if (pA && !initialA) {
    const ix = (typeof pA.ix === "number") ? pA.ix : pA.x;
    const iy = (typeof pA.iy === "number") ? pA.iy : pA.y;
    initialA = { x: ix, y: iy };

    // 計算固定目的地：A 起始交叉點的東北格
    goal = computeGoalFromA(initialA);
  }

  drawBaseMap();
  drawPlayersOnMap();
  if (goal) drawGoalOnMap(); else clearGoalStar();

  updateGameInfo(pA, pB);
}

// ========== 地圖繪製 ==========

function getMapCanvas() {
  return document.getElementById("viewerMap");
}

function drawBaseMap() {
  const canvas = getMapCanvas();
  if (!canvas || !mapGrid) return;

  const size = mapSize;
  canvas.width = size * CELL_SIZE;
  canvas.height = size * CELL_SIZE;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isWall = window.isWall(mapGrid, x, y);
      ctx.fillStyle = isWall ? "#111827" : "#0b1120";
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

// 玩家圓點：目前仍以格子中心畫（用 x,y）
function drawPlayersOnMap() {
  const canvas = getMapCanvas();
  if (!canvas || !mapGrid) return;
  const ctx = canvas.getContext("2d");

  const pA = players.find(p => p.player_no === 1);
  const pB = players.find(p => p.player_no === 2);

  if (pA) drawPlayerDot(ctx, pA.x, pA.y, "#3b82f6");
  if (pB) drawPlayerDot(ctx, pB.x, pB.y, "#ef4444");
}

function drawPlayerDot(ctx, gridX, gridY, color) {
  const cx = gridX * CELL_SIZE + CELL_SIZE / 2;
  const cy = gridY * CELL_SIZE + CELL_SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, CELL_SIZE * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ========== 目的地（A 起始交叉點的東北格） + 星星 ICON ==========

// startA 為交叉點 (ix,iy)
// 東北格 = (ix, iy-1)
function computeGoalFromA(startA) {
  if (!mapGrid || !startA) return null;

  const gx = startA.x;     // NE 格子 x = ix
  const gy = startA.y - 1; // NE 格子 y = iy-1

  if (gx < 0 || gx >= mapSize || gy < 0 || gy >= mapSize) return null;

  const name = getCellLabel(gx, gy);
  return { x: gx, y: gy, name };
}

// 在地圖上畫出大星星（用絕對定位覆蓋在 canvas 上）
function drawGoalOnMap() {
  const canvas = getMapCanvas();
  if (!canvas || !goal) return;

  const wrapper = canvas.parentElement || document.body;
  clearGoalStar();

  const star = document.createElement("div");
  star.id = "goal-star";
  star.className = "goal-star";

  const px = goal.x * CELL_SIZE + CELL_SIZE / 2;
  const py = goal.y * CELL_SIZE + CELL_SIZE / 2;

  star.style.left = px + "px";
  star.style.top = py + "px";

  wrapper.appendChild(star);
}

function clearGoalStar() {
  const old = document.getElementById("goal-star");
  if (old && old.parentNode) old.parentNode.removeChild(old);
}

// ========== 遊戲資訊：NE/SE/NW/SW（以交叉點為中心） + 目的地文字 ==========

function updateGameInfo(pA, pB) {
  const infoAEl = document.getElementById("infoAQuads");
  const infoBEl = document.getElementById("infoBQuads");
  const goalEl = document.getElementById("goalInfo");

  // 玩家 A 周邊：用 A 的交叉點座標 (ix,iy) 計算四周格
  if (infoAEl && pA) {
    const ixA = (typeof pA.ix === "number") ? pA.ix : pA.x;
    const iyA = (typeof pA.iy === "number") ? pA.iy : pA.y;
    infoAEl.innerHTML = buildQuadInfoHtml(ixA, iyA);
  } else if (infoAEl) {
    infoAEl.innerHTML = "<div>玩家 A 未加入</div>";
  }

  // 玩家 B 周邊：同樣以交叉點處理（若無 ix,iy 則退回 x,y）
  if (infoBEl && pB) {
    const ixB = (typeof pB.ix === "number") ? pB.ix : pB.x;
    const iyB = (typeof pB.iy === "number") ? pB.iy : pB.y;
    infoBEl.innerHTML = buildQuadInfoHtml(ixB, iyB);
  } else if (infoBEl) {
    infoBEl.innerHTML = "<div>玩家 B 未加入</div>";
  }

  // 目的地文字：A 起始交叉點的東北格
  if (goalEl) {
    if (goal) {
      goalEl.textContent = `目的地：${goal.name} (${goal.x}, ${goal.y})`;
    } else {
      goalEl.textContent = "目的地：尚未設定";
    }
  }
}

// 以「交叉點 (ix,iy)」為中心，計算周圍四個格子
// NW: (ix-1, iy-1), NE: (ix, iy-1), SW: (ix-1, iy), SE: (ix, iy)
function buildQuadInfoHtml(ix, iy) {
  const ne = getCellLabel(ix,     iy - 1);
  const se = getCellLabel(ix,     iy);
  const nw = getCellLabel(ix - 1, iy - 1);
  const sw = getCellLabel(ix - 1, iy);

  return `
    <div>東北 (NE)：${ne}</div>
    <div>東南 (SE)：${se}</div>
    <div>西北 (NW)：${nw}</div>
    <div>西南 (SW)：${sw}</div>
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

  if (typeof window.getShopName === "function") {
    try {
      return window.getShopName(mapGrid, x, y);
    } catch (e) {
      console.warn("getShopName 失敗，改用座標標示", e);
    }
  }

  return `(${x},${y}) 道路`;
}
