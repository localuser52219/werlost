// js/viewer.js
// 觀眾端：交叉點座標 ix/iy，視野為前方左右 2×2 格，牆在格子，建築群集顯示半透明區域。

let room = null;
let players = [];
let pollTimer = null;
let viewerStartTime = null;
let mapGrid = null;
let clusterAreas = [];

const CLUSTER_BLOCK = 5; // 必須與 shopName.js 一致

document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinViewer");
  if (joinBtn) joinBtn.addEventListener("click", joinViewer);

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  if (roomParam) {
    const rc = document.getElementById("roomCode");
    if (rc) rc.value = roomParam;
    joinViewer();
  }
});

// 位置：以 ix/iy 作交叉點，若為 null 用 x/y 補
function getPlayerPos(p) {
  const px = (p.ix !== null && p.ix !== undefined) ? p.ix : p.x;
  const py = (p.iy !== null && p.iy !== undefined) ? p.iy : p.y;
  return { x: px, y: py };
}

// 與 player.js 完全一致的視野函式
function getFovCells(ix, iy, dir) {
  if (dir === 0) {
    // 北
    return {
      leftNear:  { x: ix - 1, y: iy - 1 },
      rightNear: { x: ix,     y: iy - 1 },
      leftFar:   { x: ix - 1, y: iy - 2 },
      rightFar:  { x: ix,     y: iy - 2 }
    };
  } else if (dir === 1) {
    // 東
    return {
      leftNear:  { x: ix,     y: iy - 1 },
      rightNear: { x: ix,     y: iy     },
      leftFar:   { x: ix + 1, y: iy - 1 },
      rightFar:  { x: ix + 1, y: iy     }
    };
  } else if (dir === 2) {
    // 南
    return {
      leftNear:  { x: ix,     y: iy     },
      rightNear: { x: ix - 1, y: iy     },
      leftFar:   { x: ix,     y: iy + 1 },
      rightFar:  { x: ix - 1, y: iy + 1 }
    };
  } else {
    // 西
    return {
      leftNear:  { x: ix - 1, y: iy     },
      rightNear: { x: ix - 1, y: iy - 1 },
      leftFar:   { x: ix - 2, y: iy     },
      rightFar:  { x: ix - 2, y: iy - 1 }
    };
  }
}

// ===== 建築群集分類與計算 =====

function classifyShopArea(shopName) {
  if (!shopName) return "商舖區";
  if (shopName.includes("玩具")) return "玩具區";
  if (shopName.includes("咖啡") || shopName.includes("茶") || shopName.includes("飲品")) {
    return "飲品區";
  }
  if (
    shopName.includes("麵") || shopName.includes("湯") ||
    shopName.includes("餐") || shopName.includes("早餐") ||
    shopName.includes("點心") || shopName.includes("甜品") ||
    shopName.includes("零食") || shopName.includes("水果")
  ) {
    return "食店區";
  }
  if (shopName.includes("書店") || shopName.includes("文具")) {
    return "書文具區";
  }
  if (shopName.includes("藥房") || shopName.includes("診所")) {
    return "藥房區";
  }
  return "商舖區";
}

function computeClusterAreas() {
  clusterAreas = [];
  if (!room || !mapGrid) return;

  const n = room.map_size || mapGrid.length;
  const seed = room.seed;
  const block = CLUSTER_BLOCK;

  const clusterNx = Math.ceil(n / block);
  const clusterNy = Math.ceil(n / block);

  for (let cy = 0; cy < clusterNy; cy++) {
    for (let cx = 0; cx < clusterNx; cx++) {
      const x0 = cx * block;
      const y0 = cy * block;
      const x1 = Math.min((cx + 1) * block, n) - 1;
      const y1 = Math.min((cy + 1) * block, n) - 1;

      const samples = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (window.isWall && window.isWall(mapGrid, x, y)) continue;
          const name = window.getShopName(seed, x, y);
          samples.push(name);
          if (samples.length >= 6) break;
        }
        if (samples.length >= 6) break;
      }

      if (samples.length === 0) continue;

      const count = {};
      samples.forEach((nm) => {
        const label = classifyShopArea(nm);
        count[label] = (count[label] || 0) + 1;
      });

      let bestLabel = null;
      let bestVal = -1;
      Object.keys(count).forEach((k) => {
        if (count[k] > bestVal) {
          bestVal = count[k];
          bestLabel = k;
        }
      });

      if (!bestLabel) continue;

      clusterAreas.push({
        x0,
        y0,
        x1,
        y1,
        label: bestLabel
      });
    }
  }
}

// ===== Supabase 載入房間與玩家 =====

async function joinViewer() {
  const codeInput = document.getElementById("roomCode");
  const statusEl = document.getElementById("status");
  const code = codeInput ? codeInput.value.trim() : "";

  if (typeof window.generateMap !== "function") {
    if (statusEl) {
      statusEl.textContent = "錯誤：js/shopName.js 未正確載入（generateMap 不存在）";
    }
    console.error("generateMap is not defined. Check script order.");
    return;
  }

  if (!code) {
    if (statusEl) statusEl.textContent = "請輸入房間代碼";
    return;
  }
  if (statusEl) statusEl.textContent = "載入中…";

  const { data: r, error: er } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (er || !r) {
    if (statusEl) statusEl.textContent = "房間不存在";
    console.error(er);
    return;
  }
  room = r;

  const size = room.map_size || 25;
  mapGrid = window.generateMap(room.seed, size);

  computeClusterAreas();
  await reloadPlayers();

  if (statusEl) {
    statusEl.textContent = `房間 ${room.code}｜地圖 ${size}×${size}`;
  }
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

// ===== 畫地圖 =====

function drawMap() {
  if (!room || !mapGrid) return;
  const cvs = document.getElementById("mapCanvas");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");
  const n = room.map_size || mapGrid.length || 25;
  const cell = 20;

  cvs.width = n * cell;
  cvs.height = n * cell;

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // 牆（格子）
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

  // 格線（交叉點 0..n）
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

  // 建築群集
  drawClusterAreas(ctx, n, cell);

  // 視野
  players.forEach((p) => {
    drawPlayerFov(ctx, p, n, cell);
  });

  // 玩家交叉點
  players.forEach((p) => {
    drawPlayerMarker(ctx, p, n, cell);
  });
}

function drawClusterAreas(ctx, n, cell) {
  if (!clusterAreas || !clusterAreas.length) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(10, cell - 6)}px sans-serif`;

  clusterAreas.forEach((area) => {
    const { x0, y0, x1, y1, label } = area;

    let fillColor = "rgba(150,150,150,0.18)";
    if (label === "玩具區") fillColor = "rgba(80,150,255,0.20)";
    else if (label === "飲品區") fillColor = "rgba(255,180,80,0.20)";
    else if (label === "食店區") fillColor = "rgba(255,120,120,0.20)";
    else if (label === "書文具區") fillColor = "rgba(180,120,255,0.20)";
    else if (label === "藥房區") fillColor = "rgba(120,220,160,0.20)";

    const px = x0 * cell;
    const py = y0 * cell;
    const w = (x1 - x0 + 1) * cell;
    const h = (y1 - y0 + 1) * cell;

    ctx.fillStyle = fillColor;
    ctx.fillRect(px, py, w, h);

    const cx = px + w / 2;
    const cy = py + h / 2;

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(label, cx, cy);
  });

  ctx.restore();
}

// 視野：以交叉點作原點，用 getFovCells 取得 4 個格子
function drawPlayerFov(ctx, p, n, cell) {
  const pos = getPlayerPos(p);
  const ix = pos.x;
  const iy = pos.y;
  const dir = p.direction || 0;

  if (ix < 0 || ix > n || iy < 0 || iy > n) return;

  const cells = getFovCells(ix, iy, dir);
  const list = [
    cells.leftNear,
    cells.rightNear,
    cells.leftFar,
    cells.rightFar
  ];

  let fillColor = "rgba(200,200,200,0.25)";
  if (p.role === "A") fillColor = "rgba(255,0,0,0.25)";
  else if (p.role === "B") fillColor = "rgba(0,0,255,0.25)";

  ctx.save();
  ctx.fillStyle = fillColor;

  list.forEach((c) => {
    if (c.x < 0 || c.x >= n || c.y < 0 || c.y >= n) return;
    ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
  });

  ctx.restore();
}

// 玩家 marker：畫在交叉點 (ix*cell, iy*cell)
function drawPlayerMarker(ctx, p, n, cell) {
  const pos = getPlayerPos(p);
  const ix = pos.x;
  const iy = pos.y;

  if (ix < 0 || ix > n || iy < 0 || iy > n) return;

  let color = "gray";
  if (p.role === "A") color = "red";
  else if (p.role === "B") color = "blue";

  const nodeX = ix * cell;
  const nodeY = iy * cell;
  const radius = cell * 0.3;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(nodeX, nodeY, radius, 0, Math.PI * 2);
  ctx.fill();

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

// ===== HUD 與 Realtime =====

function updateHud() {
  updateGameTime();
  updatePlayerInfo();
}

function updateGameTime() {
  if (!viewerStartTime) return;
  const el = document.getElementById("gameTime");
  if (!el) return;
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
  if (!infoEl) return;
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
    const nCell = getNameOrMark(cx,     cy - 1);
    const ne = getNameOrMark(cx + 1, cy - 1);

    const w = getNameOrMark(cx - 1, cy);
    const c = "交叉路口";
    const e = getNameOrMark(cx + 1, cy);

    const sw = getNameOrMark(cx - 1, cy + 1);
    const s = getNameOrMark(cx,     cy + 1);
    const se = getNameOrMark(cx + 1, cy + 1);

    html += `
      <div class="player-block">
        <div><strong>玩家 ${p.role}</strong>｜交叉點 (${cx}, ${cy})｜面向：${dirLabel}</div>
        <div>西北：${nw}　｜　北：${nCell}　｜　東北：${ne}</div>
        <div>西　：${w}　｜　中心：${c}　｜　東　：${e}</div>
        <div>西南：${sw}　｜　南：${s}　｜　東南：${se}</div>
      </div>
    `;
  });

  infoEl.innerHTML = html;
}

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
