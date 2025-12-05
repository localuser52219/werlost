// js/player.js
// 玩家端：加入房間、顯示前方左右 2×2 視野 + 自身店舖名、移動（用 ix/iy）

let room = null;
let selfPlayer = null;
let mapGrid = null;

document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinBtn");
  const turnLeftBtn = document.getElementById("turnLeft");
  const turnRightBtn = document.getElementById("turnRight");
  const moveForwardBtn = document.getElementById("moveForward");

  joinBtn.addEventListener("click", joinRoom);
  turnLeftBtn.addEventListener("click", () => turn(-1));
  turnRightBtn.addEventListener("click", () => turn(1));
  moveForwardBtn.addEventListener("click", () => moveForward());

  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  const roleParam = params.get("role");

  if (roomParam) {
    document.getElementById("roomCode").value = roomParam;
  }
  if (roleParam === "A" || roleParam === "B") {
    document.getElementById("role").value = roleParam;
  }

  if (roomParam) {
    joinRoom();
  }
});

// 位置：以 ix/iy 為主，fallback x/y
function getPlayerPos(p) {
  const px = (p.ix !== null && p.ix !== undefined) ? p.ix : p.x;
  const py = (p.iy !== null && p.iy !== undefined) ? p.iy : p.y;
  return { x: px, y: py };
}

// 加入房間
async function joinRoom() {
  const code = document.getElementById("roomCode").value.trim();
  const role = document.getElementById("role").value;
  const statusEl = document.getElementById("status");

  if (!code) {
    statusEl.textContent = "請輸入房間代碼";
    return;
  }

  statusEl.textContent = "連接房間中…";

  const { data: r, error: roomErr } = await window._supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (roomErr || !r) {
    statusEl.textContent = "房間不存在或讀取錯誤";
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
    statusEl.textContent = "找不到此角色（A/B）";
    console.error(playerErr);
    return;
  }

  selfPlayer = p;

  statusEl.textContent =
    `已進入房間 ${room.code} ｜ 地圖 ${room.map_size}×${room.map_size}`;

  setupRealtime();
  updateViewCells();
}

// 更新視野：前方左右 2×2 四格 + 自身位置名
function updateViewCells() {
  if (!room || !selfPlayer || !mapGrid) return;

  const pos = getPlayerPos(selfPlayer);
  const x = pos.x;
  const y = pos.y;
  const d = selfPlayer.direction; // 0北 1東 2南 3西

  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];

  const forward = dirVec[d];
  const left = dirVec[(d + 3) % 4];
  const right = dirVec[(d + 1) % 4];

  // 以玩家為基準計算前方 intersection，再掛到 cell 上：
  const front1 = { x: x + forward.dx, y: y + forward.dy };
  const front2 = { x: x + 2 * forward.dx, y: y + 2 * forward.dy };

  // 左右 2×2：
  const leftNear = {
    x: front1.x + left.dx,
    y: front1.y + left.dy
  };
  const rightNear = {
    x: front1.x + right.dx,
    y: front1.y + right.dy
  };
  const leftFar = {
    x: front2.x + left.dx,
    y: front2.y + left.dy
  };
  const rightFar = {
    x: front2.x + right.dx,
    y: front2.y + right.dy
  };

  const size = room.map_size;

  const getName = (pos) => {
    if (pos.x < 0 || pos.x >= size || pos.y < 0 || pos.y >= size) {
      return "界外";
    }
    if (window.isWall(mapGrid, pos.x, pos.y)) {
      return "牆壁";
    }
    return window.getShopName(room.seed, pos.x, pos.y);
  };

  // 四格視野
  const lnEl = document.getElementById("leftNear");
  const lfEl = document.getElementById("leftFar");
  const rnEl = document.getElementById("rightNear");
  const rfEl = document.getElementById("rightFar");

  if (lnEl) lnEl.textContent = getName(leftNear);
  if (lfEl) lfEl.textContent = getName(leftFar);
  if (rnEl) rnEl.textContent = getName(rightNear);
  if (rfEl) rfEl.textContent = getName(rightFar);

  // 自身所在交叉點附近代表店舖名（仍用 cell 索引 x,y 做命名）
  const hereName = window.getShopName(room.seed, x, y);
  const hereEl = document.getElementById("hereShop");
  if (hereEl) hereEl.textContent = hereName;
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

// 前進一格（暫時仍以 cell 為單位；牆仍用 cell-based）
async function moveForward() {
  if (!selfPlayer || !room || !mapGrid) return;

  const d = selfPlayer.direction;
  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];
  const f = dirVec[d];

  const pos = getPlayerPos(selfPlayer);
  const x = pos.x;
  const y = pos.y;

  const nx = x + f.dx;
  const ny = y + f.dy;

  const size = room.map_size;

  if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
    return;
  }

  if (window.isWall(mapGrid, nx, ny)) {
    return;
  }

  const { error } = await window._supabase
    .from("players")
    .update({
      x: nx,
      y: ny,
      ix: nx,
      iy: ny
    })
    .eq("id", selfPlayer.id);

  if (error) {
    console.error("更新座標失敗", error);
    return;
  }

  selfPlayer.x = nx;
  selfPlayer.y = ny;
  selfPlayer.ix = nx;
  selfPlayer.iy = ny;

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
