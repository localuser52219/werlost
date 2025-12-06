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

// 以交叉點 (ix,iy) 為原點的 2×2 視野 cell 座標
// dir: 0=北,1=東,2=南,3=西
// 左/右以玩家面向為基準
function getFovCells(ix, iy, dir) {
  // map_size = n（格子數），cell 索引 0..n-1，交叉點索引 0..n
  // 交叉點 (ix,iy) 相鄰的四格：
  //   NW: (ix-1,iy-1), NE:(ix,iy-1), SW:(ix-1,iy), SE:(ix,iy)

  if (dir === 0) {
    // 向北：前方是上方兩格列
    return {
      leftNear:  { x: ix - 1, y: iy - 1 }, // 西側
      rightNear: { x: ix,     y: iy - 1 }, // 東側
      leftFar:   { x: ix - 1, y: iy - 2 },
      rightFar:  { x: ix,     y: iy - 2 }
    };
  } else if (dir === 1) {
    // 向東：前方是右邊兩格列
    // 近排：上(左)是 (ix,iy-1)；下(右)是 (ix,iy)
    return {
      leftNear:  { x: ix,     y: iy - 1 }, // 面向東時，左邊 = 北（上）
      rightNear: { x: ix,     y: iy     }, // 右邊 = 南（下）
      leftFar:   { x: ix + 1, y: iy - 1 },
      rightFar:  { x: ix + 1, y: iy     }
    };
  } else if (dir === 2) {
    // 向南：前方是下方兩格列
    // 近排：左格 (ix,iy)，右格 (ix-1,iy)，但以玩家視角：
    // 面向南時，左邊 = 東（世界的右）
    return {
      leftNear:  { x: ix,     y: iy     }, // 左 = 東
      rightNear: { x: ix - 1, y: iy     }, // 右 = 西
      leftFar:   { x: ix,     y: iy + 1 },
      rightFar:  { x: ix - 1, y: iy + 1 }
    };
  } else {
    // dir === 3，向西：前方是左邊兩格列
    // 近排：上格 (ix-1,iy-1)，下格 (ix-1,iy)
    // 面向西時，左邊 = 南（下）
    return {
      leftNear:  { x: ix - 1, y: iy     }, // 左 = 南
      rightNear: { x: ix - 1, y: iy - 1 }, // 右 = 北
      leftFar:   { x: ix - 2, y: iy     },
      rightFar:  { x: ix - 2, y: iy - 1 }
    };
  }
}

// 交叉點移動：牆在格子上，只有「兩側 cell 都是牆」才封死
function canMove(ix, iy, dir) {
  const n = room.map_size;
  let nx = ix, ny = iy;
  if (dir === 0) ny--;       // 北
  else if (dir === 1) nx++;  // 東
  else if (dir === 2) ny++;  // 南
  else if (dir === 3) nx--;  // 西

  // 交叉點範圍 0..n
  if (nx < 0 || nx > n || ny < 0 || ny > n) return null;

  let c1, c2;
  if (dir === 0) {          // 北：水平邊之下方兩 cell
    c1 = { x: ix - 1, y: iy - 1 };
    c2 = { x: ix,     y: iy - 1 };
  } else if (dir === 1) {   // 東：垂直邊之右側兩 cell
    c1 = { x: ix, y: iy - 1 };
    c2 = { x: ix, y: iy     };
  } else if (dir === 2) {   // 南：水平邊之上方兩 cell
    c1 = { x: ix - 1, y: iy };
    c2 = { x: ix,     y: iy };
  } else {                  // 西：垂直邊之左側兩 cell
    c1 = { x: ix - 1, y: iy - 1 };
    c2 = { x: ix - 1, y: iy     };
  }

  const isWallCell = (c) => {
    if (c.x < 0 || c.x >= n || c.y < 0 || c.y >= n) return true; // 界外當牆
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
