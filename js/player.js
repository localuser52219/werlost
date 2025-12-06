// js/player.js
// 玩家端：交叉點座標 ix/iy，前方左右 2×2 視野，自身位置為「交叉路口」；牆在格子上，交叉點可以沿單邊牆通過。

let room = null;
let selfPlayer = null;
let mapGrid = null;

document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinBtn");
  const turnLeftBtn = document.getElementById("turnLeft");
  const turnRightBtn = document.getElementById("turnRight");
  const moveForwardBtn = document.getElementById("moveForward");

  if (joinBtn) joinBtn.addEventListener("click", joinRoom);
  if (turnLeftBtn) turnLeftBtn.addEventListener("click", () => turn(-1));
  if (turnRightBtn) turnRightBtn.addEventListener("click", () => turn(1));
  if (moveForwardBtn) moveForwardBtn.addEventListener("click", () => moveForward());

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  const roleParam = params.get("role");

  if (roomParam) {
    const rc = document.getElementById("roomCode");
    if (rc) rc.value = roomParam;
  }
  if (roleParam === "A" || roleParam === "B") {
    const sel = document.getElementById("role");
    if (sel) sel.value = roleParam;
  }

  if (roomParam) {
    joinRoom();
  }
});

// 位置：只用 ix/iy（交叉點），若為 null 就用 x/y 補
function getPlayerPos(p) {
  const px = (p.ix !== null && p.ix !== undefined) ? p.ix : p.x;
  const py = (p.iy !== null && p.iy !== undefined) ? p.iy : p.y;
  return { x: px, y: py };
}

// 旋轉 cell offset（以「向北」為基準）：dir=0北,1東,2南,3西
function rotateOffset(dx, dy, dir) {
  if (dir === 0) return { dx, dy };                // 北
  if (dir === 1) return { dx: -dy, dy: dx };       // 東（順時針90）
  if (dir === 2) return { dx: -dx, dy: -dy };      // 南（180）
  return { dx: dy, dy: -dx };                      // 西（逆時針90）
}

// 以交叉點 (ix,iy) 為原點的 2×2 視野 cell 座標
function getFovCells(ix, iy, dir) {
  const base = {
    leftNear:  { dx: -1, dy: -1 },
    rightNear: { dx:  0, dy: -1 },
    leftFar:   { dx: -1, dy: -2 },
    rightFar:  { dx:  0, dy: -2 }
  };
  const ln = rotateOffset(base.leftNear.dx, base.leftNear.dy, dir);
  const rn = rotateOffset(base.rightNear.dx, base.rightNear.dy, dir);
  const lf = rotateOffset(base.leftFar.dx, base.leftFar.dy, dir);
  const rf = rotateOffset(base.rightFar.dx, base.rightFar.dy, dir);

  return {
    leftNear:  { x: ix + ln.dx, y: iy + ln.dy },
    rightNear: { x: ix + rn.dx, y: iy + rn.dy },
    leftFar:   { x: ix + lf.dx, y: iy + lf.dy },
    rightFar:  { x: ix + rf.dx, y: iy + rf.dy }
  };
}

// 交叉點移動：牆在格子上，只有「兩側 cell 都是牆」才封死
function canMove(ix, iy, dir) {
  const n = room.map_size;
  let nx = ix, ny = iy;
  if (dir === 0) ny--;       // 北
  else if (dir === 1) nx++;  // 東
  else if (dir === 2) ny++;  // 南
  else if (dir === 3) nx--;  // 西

  // 交叉點範圍應為 0..n（允許在最外一圈交叉點行走）
  if (nx < 0 || nx > n || ny < 0 || ny > n) return null;

  let c1, c2;
  if (dir === 0) {          // 北：線段在兩個 cell 之間的水平邊上
    c1 = { x: ix - 1, y: iy - 1 };
    c2 = { x: ix,     y: iy - 1 };
  } else if (dir === 1) {   // 東：垂直邊
    c1 = { x: ix, y: iy - 1 };
    c2 = { x: ix, y: iy     };
  } else if (dir === 2) {   // 南
    c1 = { x: ix - 1, y: iy };
    c2 = { x: ix,     y: iy };
  } else {                  // 西
    c1 = { x: ix - 1, y: iy - 1 };
    c2 = { x: ix - 1, y: iy     };
  }

  const isWallCell = (c) => {
    if (c.x < 0 || c.x >= n || c.y < 0 || c.y >= n) return true; // 界外視為牆
    return window.isWall(mapGrid, c.x, c.y);
  };

  const w1 = isWallCell(c1);
  const w2 = isWallCell(c2);

  if (w1 && w2) return null; // 兩邊都是牆，禁止

  return { nx, ny };
}

// 加入房間
async function joinRoom() {
  const codeInput = document.getElementById("roomCode");
  const roleSelect = document.getElementById("role");
  const statusEl = document.getElementById("status");
  const code = codeInput ? codeInput.value.trim() : "";
  const role = roleSelect ? roleSelect.value : "A";

  if (!code) {
    if (statusEl) statusEl.textContent = "請輸入房間代碼";
    return;
  }

  if (statusEl) statusEl.textContent = "連接房間中…";

  const { data: r, error: roomErr } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (roomErr || !r) {
    if (statusEl) statusEl.textContent = "房間不存在或讀取錯誤";
    console.error(roomErr);
    return;
  }

  room = r;
  mapGrid = window.generateMap(room.seed, room.map_size);

  const { data: p, error: playerErr } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id)
    .eq("role", role)
    .maybeSingle();

  if (playerErr || !p) {
    if (statusEl) statusEl.textContent = "找不到此角色（A/B）";
    console.error(playerErr);
    return;
  }

  selfPlayer = p;

  if (statusEl) {
    statusEl.textContent =
      `已進入房間 ${room.code} ｜ 地圖 ${room.map_size}×${room.map_size}`;
  }

  setupRealtime();
  updateViewCells();
}

// 更新視野
function updateViewCells() {
  if (!room || !selfPlayer || !mapGrid) return;

  const pos = getPlayerPos(selfPlayer);
  const ix = pos.x;
  const iy = pos.y;
  const d = selfPlayer.direction || 0;

  const size = room.map_size;

  const getName = (cx, cy) => {
    if (cx < 0 || cx >= size || cy < 0 || cy >= size) return "界外";
    if (window.isWall(mapGrid, cx, cy)) return "牆壁";
    return window.getShopName(room.seed, cx, cy);
  };

  const cells = getFovCells(ix, iy, d);

  const lnEl = document.getElementById("leftNear");
  const lfEl = document.getElementById("leftFar");
  const rnEl = document.getElementById("rightNear");
  const rfEl = document.getElementById("rightFar");

  if (lnEl) lnEl.textContent = getName(cells.leftNear.x, cells.leftNear.y);
  if (lfEl) lfEl.textContent = getName(cells.leftFar.x, cells.leftFar.y);
  if (rnEl) rnEl.textContent = getName(cells.rightNear.x, cells.rightNear.y);
  if (rfEl) rfEl.textContent = getName(cells.rightFar.x, cells.rightFar.y);

  const hereEl = document.getElementById("hereShop");
  if (hereEl) hereEl.textContent = "交叉路口";
}

// 轉向
async function turn(dir) {
  if (!selfPlayer) return;
  const newDir = (selfPlayer.direction + dir + 4) % 4;

  const { error } = await window._supabase
    .from("players")
    .update({ direction: newDir })
    .eq("id", selfPlayer.id);

  if (error) {
    console.error("更新方向失敗", error);
    return;
  }

  selfPlayer.direction = newDir;
  updateViewCells();
}

// 前進一格：使用交叉點＋單邊牆邏輯
async function moveForward() {
  if (!selfPlayer || !room || !mapGrid) return;

  const pos = getPlayerPos(selfPlayer);
  const ix = pos.x;
  const iy = pos.y;
  const d = selfPlayer.direction || 0;

  const res = canMove(ix, iy, d);
  if (!res) return;

  const { nx, ny } = res;

  const { error } = await window._supabase
    .from("players")
    .update({
      ix: nx,
      iy: ny,
      x: nx,
      y: ny
    })
    .eq("id", selfPlayer.id);

  if (error) {
    console.error("更新座標失敗", error);
    return;
  }

  selfPlayer.ix = nx;
  selfPlayer.iy = ny;
  selfPlayer.x = nx;
  selfPlayer.y = ny;

  updateViewCells();
}

// Realtime
function setupRealtime() {
  if (!room) return;

  window._supabase
    .channel("room_changes_" + room.id)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "players",
        filter: `room_id=eq.${room.id}`
      },
      (payload) => {
        const row = payload.new;
        if (!selfPlayer) return;
        if (row.id === selfPlayer.id) {
          selfPlayer = row;
          updateViewCells();
        } else {
          console.log("對方位置更新：", row);
        }
      }
    )
    .subscribe((status) => {
      console.log("Realtime status:", status);
    });
}
