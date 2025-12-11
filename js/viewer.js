// js/viewer.js
// 觀眾端：顯示大地圖 + 玩家位置 + 四方向視野資訊（NE / SE / NW / SW）
// ★ 沒有目的地、沒有星星 ICON、沒有 goal 計算

let roomCode = null;
let roomData = null;
let mapSize = 0;
let mapGrid = null;

let players = [];

const CELL_SIZE = 16;

document.addEventListener("DOMContentLoaded", () => {
  roomCode = getRoomCodeFromUrl();
  const statusEl = document.getElementById("viewerStatus");

  if (!roomCode) {
    statusEl.textContent = "URL 缺少 ?room= 或 ?code=";
    return;
  }
  if (!window._supabase) {
    statusEl.textContent = "Supabase 尚未初始化";
    return;
  }
  if (
    typeof window.generateMap !== "function" ||
    typeof window.isWall !== "function"
  ) {
    statusEl.textContent =
      "錯誤：js/shopName.js 未正確載入（需要 generateMap / isWall）";
    return;
  }

  statusEl.textContent = "載入房間資料中…";
  initViewer(roomCode).catch((err) => {
    console.error(err);
    statusEl.textContent = "載入房間錯誤";
  });
});

// 允許同時使用 ?room=fff 或 ?code=fff
function getRoomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || params.get("code");
}

async function initViewer(code) {
  const statusEl = document.getElementById("viewerStatus");

  // 讀取房間
  const { data: room, error: roomErr } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (roomErr || !room) {
    statusEl.textContent = "找不到房間：" + code;
    return;
  }

  roomData = room;
  mapSize = room.map_size;
  mapGrid = window.generateMap(room.seed, mapSize);

  drawBaseMap();
  statusEl.textContent = "等待玩家資料…";

  // 初次取得 players
  const { data: initPlayers } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id);

  players = initPlayers || [];
  handlePlayersUpdate();

  // 訂閱 players 更新
  window._supabase
    .channel("viewer-" + room.id)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "players",
        filter: `room_id=eq.${room.id}`,
      },
      refreshPlayers
    )
    .subscribe();
}

async function refreshPlayers() {
  const { data } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", roomData.id);

  players = data || [];
  handlePlayersUpdate();
}

function handlePlayersUpdate() {
  const statusEl = document.getElementById("viewerStatus");
  const pA = players.find((p) => p.player_no === 1);
  const pB = players.find((p) => p.player_no === 2);

  if (!pA && !pB) {
    statusEl.textContent = "尚未有玩家加入";
    clearPlayersOnMap();
    updateGameInfo(null, null);
    return;
  }

  statusEl.textContent = "遊戲進行中…";

  drawBaseMap();
  drawPlayersOnMap();
  updateGameInfo(pA, pB);
}

// ========== 地圖繪製 ==========

function getMapCanvas() {
  return document.getElementById("viewerMap");
}

function drawBaseMap() {
  const canvas = getMapCanvas();
  if (!canvas || !mapGrid) return;

  canvas.width = mapSize * CELL_SIZE;
  canvas.height = mapSize * CELL_SIZE;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
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

function drawPlayersOnMap() {
  const canvas = getMapCanvas();
  const ctx = canvas.getContext("2d");

  const pA = players.find((p) => p.player_no === 1);
  const pB = players.find((p) => p.player_no === 2);

  if (pA) drawPlayerDot(ctx, pA.x, pA.y, "#3b82f6");
  if (pB) drawPlayerDot(ctx, pB.x, pB.y, "#ef4444");
}

function drawPlayerDot(ctx, gx, gy, color) {
  const cx = gx * CELL_SIZE + CELL_SIZE / 2;
  const cy = gy * CELL_SIZE + CELL_SIZE / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, CELL_SIZE * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ========== 四周視野 ==========
// （以交叉點 ix,iy → 四格為 NW NE SW SE）

function updateGameInfo(pA, pB) {
  const infoA = document.getElementById("infoAQuads");
  const infoB = document.getElementById("infoBQuads");

  if (pA) {
    const ix = pA.ix ?? pA.x;
    const iy = pA.iy ?? pA.y;
    infoA.innerHTML = buildQuad(ix, iy);
  } else {
    infoA.textContent = "玩家 A 未加入";
  }

  if (pB) {
    const ix = pB.ix ?? pB.x;
    const iy = pB.iy ?? pB.y;
    infoB.innerHTML = buildQuad(ix, iy);
  } else {
    infoB.textContent = "玩家 B 未加入";
  }
}

function buildQuad(ix, iy) {
  const nw = getCell(ix - 1, iy - 1);
  const ne = getCell(ix, iy - 1);
  const sw = getCell(ix - 1, iy);
  const se = getCell(ix, iy);

  return `
    <div>西北 (NW)：${nw}</div>
    <div>東北 (NE)：${ne}</div>
    <div>西南 (SW)：${sw}</div>
    <div>東南 (SE)：${se}</div>
  `;
}

function getCell(x, y) {
  if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return "界外";
  if (window.isWall(mapGrid, x, y)) return "牆壁";

  if (window.getShopName) {
    try { return window.getShopName(mapGrid, x, y); }
    catch {}
  }
  return `道路 (${x},${y})`;
}
