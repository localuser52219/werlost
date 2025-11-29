// player.js
// 玩家端：加入房間、顯示 6 格視野、移動（含牆＆邊界限制）、Realtime

let room = null;        // rooms 表的一列
let selfPlayer = null;  // players 表中自己的那列
let mapGrid = null;     // MapGrid: mapGrid[y][x] = { type: 'road' | 'wall' }

// 綁定 UI + 處理 URL 參數
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

// 加入房間：讀取 room + self player
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
  // 用 seed + map_size 生成地圖（含牆）
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

// 更新視野：左前、左前 2、前、前 2、右前、右前 2
function updateViewCells() {
  if (!room || !selfPlayer || !mapGrid) return;

  const x = selfPlayer.x;
  const y = selfPlayer.y;
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

  const front1 = { x: x + forward.dx, y: y + forward.dy };
  const front2 = { x: x + 2 * forward.dx, y: y + 2 * forward.dy };

  const lf1 = {
    x: x + forward.dx + left.dx,
    y: y + forward.dy + left.dy
  };
  const lf2 = {
    x: x + 2 * forward.dx + 2 * left.dx,
    y: y + 2 * forward.dy + 2 * left.dy
  };

  const rf1 = {
    x: x + forward.dx + right.dx,
    y: y + forward.dy + right.dy
  };
  const rf2 = {
    x: x + 2 * forward.dx + 2 * right.dx,
    y: y + 2 * forward.dy + 2 * right.dy
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

  document.getElementById("front1").textContent = getName(front1);
  document.getElementById("front2").textContent = getName(front2);
  document.getElementById("leftFront1").textContent = getName(lf1);
  document.getElementById("leftFront2").textContent = getName(lf2);
  document.getElementById("rightFront1").textContent = getName(rf1);
  document.getElementById("rightFront2").textContent = getName(rf2);
}

// 轉向（dir = -1 左轉，+1 右轉）
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

// 前進一格（不可出界／不可穿牆）
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

  const nx = selfPlayer.x + f.dx;
  const ny = selfPlayer.y + f.dy;

  const size = room.map_size;

  // 邊界檢查
  if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
    // 出界：不更新
    return;
  }

  // 牆壁檢查
  if (window.isWall(mapGrid, nx, ny)) {
    // 牆壁：不更新
    return;
  }

  const { error } = await window._supabase
    .from("players")
    .update({ x: nx, y: ny })
    .eq("id", selfPlayer.id);

  if (error) {
    console.error("更新座標失敗", error);
    return;
  }

  selfPlayer.x = nx;
  selfPlayer.y = ny;
  updateViewCells();
}

// Realtime 監聽 players 更新
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
