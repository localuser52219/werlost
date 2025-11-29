// viewer.js
// 觀眾端：顯示整張地圖＋玩家位置，並即時更新

let room = null;
let players = [];

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("joinViewer")
    .addEventListener("click", joinViewer);

  // 支援 URL 參數 ?room=CODE
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

  const { data: ps, error: ep } = await window._supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id);

  if (ep) {
    s.textContent = "讀取玩家失敗";
    console.error(ep);
    return;
  }
  players = ps || [];

  s.textContent = `房間 ${room.code}｜地圖 ${room.map_size}×${room.map_size}`;
  drawMap();
  setupRealtimeViewer();
}

function drawMap() {
  if (!room) return;
  const cvs = document.getElementById("mapCanvas");
  const ctx = cvs.getContext("2d");
  const n = room.map_size;
  const cell = 20;

  cvs.width = n * cell;
  cvs.height = n * cell;

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  // grid
  ctx.strokeStyle = "#ddd";
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

  // players
  players.forEach(p => {
    if (p.x < 0 || p.x >= n || p.y < 0 || p.y >= n) return;
    ctx.fillStyle = p.role === "A" ? "red" : "blue";
    ctx.fillRect(p.x * cell + 2, p.y * cell + 2, cell - 4, cell - 4);
  });
}

function setupRealtimeViewer() {
  if (!room) return;

  window._supabase
    .channel("viewer_" + room.id)
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
        const idx = players.findIndex(p => p.id === row.id);
        if (idx >= 0) {
          players[idx] = row;
        } else {
          players.push(row);
        }
        drawMap();
      }
    )
    .subscribe();
}
