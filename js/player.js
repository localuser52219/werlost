// 玩家端邏輯：加入房間、顯示三格視野、移動、Realtime

let room = null;        // rooms 表的一列
let selfPlayer = null;  // players 表中自己的那列
let mapGrid = null;     // 目前只作尺寸參考，可之後加入牆、障礙等

// 生成單純「可走道路」的地圖（之後可改為有牆）
function generateMap(size) {
  const map = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      row.push({ type: 'road' });
    }
    map.push(row);
  }
  return map;
}

// 綁定 UI
document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinBtn");
  const turnLeftBtn = document.getElementById("turnLeft");
  const turnRightBtn = document.getElementById("turnRight");
  const moveForwardBtn = document.getElementById("moveForward");

  joinBtn.addEventListener("click", joinRoom);
  turnLeftBtn.addEventListener("click", () => turn(-1));
  turnRightBtn.addEventListener("click", () => turn(1));
  moveForwardBtn.addEventListener("click", () => moveForward());
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

  // 1. 查詢 rooms
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
  mapGrid = generateMap(room.map_size);

  // 2. 查詢 players 中自己那列
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

// 更新視野（左前 / 前方 / 右前）
function updateViewCells() {
  if (!room || !selfPlayer) return;

  const x = selfPlayer.x;
  const y = selfPlayer.y;
  const d = selfPlayer.direction;  // 0北 1東 2南 3西

  // 四個方向的單位向量
  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];

  const forward = dirVec[d];
  const left = dirVec[(d + 3) % 4];
  const right = dirVec[(d + 1) % 4];

  const front = { x: x + forward.dx, y: y + forward.dy };
  const leftFront = {
    x: front.x + left.dx,
    y: front.y + left.dy
  };
  const rightFront = {
    x: front.x + right.dx,
    y: front.y + right.dy
  };

  const frontName = window.getShopName(room.seed, front.x, front.y);
  const leftName = window.getShopName(room.seed, leftFront.x, leftFront.y);
  const rightName = window.getShopName(room.seed, rightFront.x, rightFront.y);

  document.getElementById("frontCell").textContent = frontName;
  document.getElementById("leftCell").textContent = leftName;
  document.getElementById("rightCell").textContent = rightName;
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

  // 即時更新本地狀態（Realtime 回來時也會覆蓋）
  selfPlayer.direction = newDir;
  updateViewCells();
}

// 前進一格
async function moveForward() {
  if (!selfPlayer) return;

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

  // 目前未做邊界/牆檢查，之後可以用 mapGrid 限制
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
      payload => {
        const row = payload.new;
        if (!selfPlayer) return;

        if (row.id === selfPlayer.id) {
          // 自己
          selfPlayer = row;
          updateViewCells();
        } else {
          // 對手（目前只輸出 log，需要可再用）
          console.log("對方位置更新：", row);
        }
      }
    )
    .subscribe(status => {
      console.log("Realtime status:", status);
    });
}
