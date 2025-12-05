// js/viewer.js
// 觀眾端：地圖 + 牆 + 玩家位置與面向 + 視野（前方 3×2），HUD 顯示以玩家為中心九宮格
// 第 2 步：玩家位置以 ix/iy 為主，並在畫面上顯示為「格線交叉點」

let room = null;
let players = [];
let pollTimer = null;
let viewerStartTime = null;
let mapGrid = null;

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

// 工具：從 player 取得位置（ix/iy 為主）
function getPlayerPos(p) {
  const px = (p.ix !== null && p.ix !== undefined) ? p.ix : p.x;
  const py = (p.iy !== null && p.iy !== undefined) ? p.iy : p.y;
  return { x: px, y: py };
}

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

// 畫地圖：牆 → 格線 → 視野 → 玩家
function drawMap() {
  if (!room || !mapGrid) return;
  const cvs = document.getElementById("mapCanvas");
  const ctx = cvs.getContext("2d");
  const n = room.map_size || mapGrid.length || 25;
  const cell = 20;

  cvs.width = n * cell;
  cvs.height = n * cell;

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // 牆（仍以 cell 顯示）
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

  // 視野（前方 3×2）
  players.forEach((p) => {
    drawPlayerFov(ctx, p, n, cell);
  });

  // 玩家（交叉點）
  players.forEach((p) => {
    drawPlayerMarker(ctx, p, n, cell);
  });
}

// 視野 6 格：與 player.js 對齊
function drawPlayerFov(ctx, p, n, cell) {
  const pos = getPlayerPos(p);
  const x0 = pos.x;
  const y0 = pos.y;

  if (x0 < 0 || x0 >= n || y0 < 0 || y0 >= n) return;

  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];

  const d = p.direction;
  const forward = dirVec[d] || dirVec[0];
  const left = dirVec[(d + 3) % 4] || dirVec[3];
  const right = dirVec[(d + 1) % 4] || dirVec[1];

  const front1 = { x: x0 + forward.dx, y: y0 + forward.dy };
  const front2 = { x: x0 + 2 * forward.dx, y: y0 + 2 * forward.dy };

  const lf1 = { x: front1.x + left.dx, y: front1.y + left.dy };
  const rf1 = { x: front1.x + right.dx, y: front1.y + right.dy };
  const lf2 = { x: front2.x + left.dx, y: front2.y + left.dy };
  const rf2 = { x: front2.x + right.dx, y: front2.y + right.dy };

  const cells = [lf2, front2, rf2, lf1, front1, rf1];

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

// 玩家 marker + 面向箭嘴：以「格線交叉點」為中心
function drawPlayerMarker(ctx, p, n, cell) {
  const pos = getPlayerPos(p);
  const px = pos.x;
  const py = pos.y;

  // 交叉點座標允許在 0..n 範圍內；目前 ix/iy 是 0..n-1
  if (px < 0 || px > n || py < 0 || py > n) return;

  let color = "gray";
  if (p.role === "A") color = "red";
  else if (p.role === "B") color = "blue";

  // 交叉點：在格線交叉點，而不是方格中心
  const nodeX = px * cell;
  const nodeY = py * cell;

  const radius = cell * 0.3;

  // 畫圓形路口標記
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(nodeX, nodeY, radius, 0, Math.PI * 2);
  ctx.fill();

  // 箭嘴：由路口往面向方向伸出
  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];
  const forward = dirVec[p.direction] || dirVec[0];

  const arrowLen = cell * 0.5;
  const tipX = nodeX + forward.dx * arrowLen;
  const tipY = nodeY + forward.dy * arrowLen;

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nodeX, nodeY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

// HUD：時間 + 以玩家為中心九宮格方位
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

  let html = "";

  const sorted = [...players].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === "A") return -1;
    if (b.role === "A") return 1;
    return a.role.localeCompare(b.role);
  });

  sorted.forEach((p) => {
    const pos = getPlayerPos(p);
    const cx = pos.x;
    const cy = pos.y;

    const dirLabel =
      p.direction >= 0 && p.direction <= 3 ? dirText[p.direction] : "?";

    const nw = getNameOrMark(cx - 1, cy - 1);
    const nCell = getNameOrMark(cx, cy - 1);
    const ne = getNameOrMark(cx + 1, cy - 1);

    const w = getNameOrMark(cx - 1, cy);
    const c = window.getShopName(seed, cx, cy);
    const e = getNameOrMark(cx + 1, cy);

    const sw = getNameOrMark(cx - 1, cy + 1);
    const s = getNameOrMark(cx, cy + 1);
    const se = getNameOrMark(cx + 1, cy + 1);

    html += `
      <div class="player-block">
        <div><strong>玩家 ${p.role}</strong>｜座標 (${cx}, ${cy})｜面向：${dirLabel}</div>
        <div>西北：${nw}　｜　北：${nCell}　｜　東北：${ne}</div>
        <div>西　：${w}　｜　中心：${c}　｜　東　：${e}</div>
        <div>西南：${sw}　｜　南：${s}　｜　東南：${se}</div>
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
