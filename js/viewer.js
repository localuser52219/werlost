// js/viewer.js
// 觀眾端：顯示整張地圖＋牆＋玩家位置與面向＋視野，並顯示遊戲時間與四面 2 格資料

let room = null;
let players = [];
let pollTimer = null;
let viewerStartTime = null;
let mapGrid = null; // mapGrid[y][x] = { type: 'road' | 'wall' }

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("joinViewer")
    .addEventListener("click", joinViewer);

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  if (roomParam) {
    document.getElementById("roomCode").value = roomParam;
    joinViewer();
  }
});

async function joinViewer() {
  const code = document.getElementById("roomCode").value.trim();
  const s = document.getElementById("status");

  if (typeof window.generateMap !== "function") {
    s.textContent = "錯誤：js/shopName.js 未正確載入（generateMap 不存在）";
    console.error("generateMap is not defined. Check script order.");
    return;
  }

  if (!code) {
    s.textContent = "請輸入房間代碼";
    return;
  }
  s.textContent = "載入中…";

  const { data: r, error: er } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (er || !r) {
    s.textContent = "房間不存在";
    console.error(er);
    return;
  }
  room = r;

  const size = room.map_size || 25;
  mapGrid = window.generateMap(room.seed, size);

  await reloadPlayers();

  s.textContent = `房間 ${room.code}｜地圖 ${size}×${size}`;
  viewerStartTime = Date.now();
  drawMap();
  updateHud();
  setupRealtimeViewer();
  setupPolling();
}

async function reloadPlayers() {
  if (!room) return;
  const { data: ps, error: ep } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id);

  if (ep) {
    console.error("讀取玩家失敗", ep);
    return;
  }
  players = ps || [];
}

// 繪製地圖：牆 → 格線 → 視野 → 玩家 marker
function drawMap() {
  if (!room || !mapGrid) return;
  const cvs = document.getElementById("mapCanvas");
  const ctx = cvs.getContext("2d");
  const n = room.map_size || mapGrid.length || 25;
  const cell = 20;

  cvs.width = n * cell;
  cvs.height = n * cell;

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // 牆（灰色）
  ctx.fillStyle = "#666";
  for (let y = 0; y < n; y++) {
    const row = mapGrid[y];
    if (!row) continue;
    for (let x = 0; x < n; x++) {
      const tile = row[x];
      if (!tile) continue;
      if (tile.type === "wall") {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  // 格線
  ctx.strokeStyle = "#aaa";
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, n * cell);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(n * cell, i * cell);
    ctx.stroke();
  }

  // 玩家視野（半透明色塊）
  players.forEach((p) => {
    drawPlayerFov(ctx, p, n, cell);
  });

  // 玩家 marker
  players.forEach((p) => {
    drawPlayerMarker(ctx, p, n, cell);
  });
}

/**
 * 視野 6 格（與 player.js 完全一致）：
 * - 左前 1 格、左前 2 格
 * - 前方 1 格、前方 2 格
 * - 右前 1 格、右前 2 格
 *
 * direction 編碼：
 * 0: 北 (y-1)
 * 1: 東 (x+1)
 * 2: 南 (y+1)
 * 3: 西 (x-1)
 */
function drawPlayerFov(ctx, p, n, cell) {
  if (p.x < 0 || p.x >= n || p.y < 0 || p.y >= n) return;

  // 和 player.js 一樣的方向向量
  const dirVec = [
    { dx: 0, dy: -1 }, // 0 北
    { dx: 1, dy: 0 },  // 1 東
    { dx: 0, dy: 1 },  // 2 南
    { dx: -1, dy: 0 }  // 3 西
  ];

  const d = p.direction;
  const forward = dirVec[d] || dirVec[0];
  const left = dirVec[(d + 3) % 4] || dirVec[3];
  const right = dirVec[(d + 1) % 4] || dirVec[1];

  const cells = [];

  // 前方 1 / 2 格
  const front1 = { x: p.x + forward.dx, y: p.y + forward.dy };
  const front2 = { x: p.x + 2 * forward.dx, y: p.y + 2 * forward.dy };
  cells.push(front1, front2);

  // 左前 1 / 2 格
  const lf1 = {
    x: p.x + forward.dx + left.dx,
    y: p.y + forward.dy + left.dy
  };
  const lf2 = {
    x: p.x + 2 * forward.dx + 2 * left.dx,
    y: p.y + 2 * forward.dy + 2 * left.dy
  };
  cells.push(lf1, lf2);

  // 右前 1 / 2 格
  const rf1 = {
    x: p.x + forward.dx + right.dx,
    y: p.y + forward.dy + right.dy
  };
  const rf2 = {
    x: p.x + 2 * forward.dx + 2 * right.dx,
    y: p.y + 2 * forward.dy + 2 * right.dy
  };
  cells.push(rf1, rf2);

  // 顏色：與之前保持一致
  let fillColor = "rgba(200,200,200,0.25)";
  if (p.role === "A") fillColor = "rgba(255,0,0,0.25)";
  else if (p.role === "B") fillColor = "rgba(0,0,255,0.25)";

  ctx.save();
  ctx.fillStyle = fillColor;

  cells.forEach((c) => {
    if (c.x < 0 || c.x >= n || c.y < 0 || c.y >= n) return;
    ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
  });

  ctx.restore();
}

// 玩家 marker + 面向箭嘴
function drawPlayerMarker(ctx, p, n, cell) {
  if (p.x < 0 || p.x >= n || p.y < 0 || p.y >= n) return;

  let color = "gray";
  if (p.role === "A") color = "red";
  else if (p.role === "B") color = "blue";

  const xPix = p.x * cell;
  const yPix = p.y * cell;

  ctx.fillStyle = color;
  ctx.fillRect(xPix + 2, yPix + 2, cell - 4, cell - 4);

  const centerX = xPix + cell / 2;
  const centerY = yPix + cell / 2;

  const dirVec = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 }
  ];
  const forward = dirVec[p.direction] || dirVec[0];

  const arrowLen = cell * 0.35;
  const tipX = centerX + forward.dx * arrowLen;
  const tipY = centerY + forward.dy * arrowLen;

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

// HUD：時間 + 每玩家「四面 2 格」資料（地圖絕對方向）
function updateHud() {
  updateGameTime();
  updatePlayerInfo();
}

function updateGameTime() {
  if (!viewerStartTime) return;
  const el = document.getElementById("gameTime");
  const elapsedMs = Date.now() - viewerStartTime;
  const totalSec = Math.floor(elapsedMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function updatePlayerInfo() {
  const infoEl = document.getElementById("playerInfo");
  if (!room || !players.length || !mapGrid) {
    infoEl.innerHTML = "";
    return;
  }

  const dirText = ["北", "東", "南", "西"];
  const n = room.map_size || mapGrid.length;
  const seed = room.seed;

  const getNameOrMark = (x, y) => {
    if (x < 0 || x >= n || y < 0 || y >= n) return "─";
    if (window.isWall && window.isWall(mapGrid, x, y)) return "牆壁";
    return window.getShopName(seed, x, y);
  };

  const north = { dx: 0, dy: -1 };
  const east = { dx: 1, dy: 0 };
  const south = { dx: 0, dy: 1 };
  const west = { dx: -1, dy: 0 };

  let html = "";

  const sorted = [...players].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === "A") return -1;
    if (b.role === "A") return 1;
    return a.role.localeCompare(b.role);
  });

  sorted.forEach((p) => {
    const dirLabel =
      p.direction >= 0 && p.direction <= 3 ? dirText[p.direction] : "?";

    const n1 = getNameOrMark(p.x + north.dx, p.y + north.dy);
    const n2 = getNameOrMark(p.x + 2 * north.dx, p.y + 2 * north.dy);

    const e1 = getNameOrMark(p.x + east.dx, p.y + east.dy);
    const e2 = getNameOrMark(p.x + 2 * east.dx, p.y + 2 * east.dy);

    const s1 = getNameOrMark(p.x + south.dx, p.y + south.dy);
    const s2 = getNameOrMark(p.x + 2 * south.dx, p.y + 2 * south.dy);

    const w1 = getNameOrMark(p.x + west.dx, p.y + west.dy);
    const w2 = getNameOrMark(p.x + 2 * west.dx, p.y + 2 * west.dy);

    html += `
      <div class="player-block">
        <div><strong>玩家 ${p.role}</strong>｜座標 (${p.x}, ${p.y})｜面向：${dirLabel}</div>
        <div>北 1：${n1}　｜　北 2：${n2}</div>
        <div>東 1：${e1}　｜　東 2：${e2}</div>
        <div>南 1：${s1}　｜　南 2：${s2}</div>
        <div>西 1：${w1}　｜　西 2：${w2}</div>
      </div>
    `;
  });

  infoEl.innerHTML = html;
}

// Realtime
function setupRealtimeViewer() {
  if (!room) return;

  window._supabase
    .channel("viewer_" + room.id)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "players",
        filter: `room_id=eq.${room.id}`
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old;
          players = players.filter((p) => p.id !== oldRow.id);
          drawMap();
          updateHud();
          return;
        }

        const row = payload.new;
        if (!row) return;
        const idx = players.findIndex((p) => p.id === row.id);
        if (idx >= 0) {
          players[idx] = row;
        } else {
          players.push(row);
        }
        drawMap();
        updateHud();
      }
    )
    .subscribe((status) => {
      console.log("Viewer Realtime status:", status);
    });
}

// 保險輪詢
function setupPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(async () => {
    if (!room) return;
    await reloadPlayers();
    drawMap();
    updateHud();
  }, 1000);
}
