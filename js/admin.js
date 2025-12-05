// js/admin.js
// 控制台：建立 / 重設房間 + 清除全部資料
// 第 1 步：players 位置同時寫 x,y 以及 ix,iy（暫時當作格子中心）

document.addEventListener("DOMContentLoaded", () => {
  const createBtn = document.getElementById("createResetBtn");
  const clearBtn = document.getElementById("clearAllBtn");

  if (createBtn) createBtn.addEventListener("click", createOrResetRoom);
  if (clearBtn) clearBtn.addEventListener("click", clearAllData);
});

// 工具：整數亂數 [min, max]
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// BFS：檢查 A(x1,y1) 能否走到 B(x2,y2)
function canReach(mapGrid, size, ax, ay, bx, by) {
  const visited = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );
  const queue = [];
  queue.push([ax, ay]);
  visited[ay][ax] = true;

  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    if (x === bx && y === by) return true;

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      if (visited[ny][nx]) continue;
      if (window.isWall(mapGrid, nx, ny)) continue;
      visited[ny][nx] = true;
      queue.push([nx, ny]);
    }
  }
  return false;
}

// 在給定 map 上找一對「可互通」的 A/B 起點
function findStartPositions(mapGrid, size, maxPairAttempts) {
  const roadCells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!window.isWall(mapGrid, x, y)) {
        roadCells.push({ x, y });
      }
    }
  }
  if (roadCells.length < 2) return null;

  const minDist = Math.floor(size / 3); // 避免起點太近

  for (let i = 0; i < maxPairAttempts; i++) {
    const idxA = randomInt(0, roadCells.length - 1);
    let idxB = randomInt(0, roadCells.length - 1);
    if (roadCells.length > 1) {
      while (idxB === idxA) {
        idxB = randomInt(0, roadCells.length - 1);
      }
    }

    const a = roadCells[idxA];
    const b = roadCells[idxB];

    const manhattan =
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (manhattan < minDist) continue;

    if (canReach(mapGrid, size, a.x, a.y, b.x, b.y)) {
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    }
  }

  return null;
}

// 後備模式：全道路地圖下的 A/B 起點
function fallbackStartPositions(size) {
  const margin = 1;
  const minDist = Math.floor(size / 3);

  for (let i = 0; i < 100; i++) {
    const ax = randomInt(margin, size - 1 - margin);
    const ay = randomInt(margin, size - 1 - margin);
    let bx = randomInt(margin, size - 1 - margin);
    let by = randomInt(margin, size - 1 - margin);

    if (size > 2) {
      while (bx === ax && by === ay) {
        bx = randomInt(margin, size - 1 - margin);
        by = randomInt(margin, size - 1 - margin);
      }
    }

    const manhattan = Math.abs(ax - bx) + Math.abs(ay - by);
    if (manhattan >= minDist) {
      return { ax, ay, bx, by };
    }
  }
  return { ax: 1, ay: 1, bx: size - 2, by: size - 2 };
}

// 建立 / 重設房間
async function createOrResetRoom() {
  const codeInput = document.getElementById("roomCode");
  const mapSizeSelect = document.getElementById("mapSize");
  const seedInput = document.getElementById("seedInput");
  const statusEl = document.getElementById("status");
  const linksEl = document.getElementById("links");

  const code = codeInput.value.trim();
  const mapSize = parseInt(mapSizeSelect.value, 10);
  const baseSeed = seedInput.value.trim();

  if (!code) {
    statusEl.textContent = "請輸入房間代碼";
    return;
  }

  if (!window._supabase) {
    statusEl.textContent = "Supabase 尚未初始化";
    return;
  }

  if (typeof window.generateMap !== "function" ||
      typeof window.isWall !== "function") {
    statusEl.textContent = "錯誤：js/shopName.js 未正確載入（需要 generateMap / isWall）";
    return;
  }

  statusEl.textContent = "生成地圖與起點中…";

  const maxSeedAttempts = 10;
  const maxPairAttempts = 80;

  let finalSeed = null;
  let startAX = null;
  let startAY = null;
  let startBX = null;
  let startBY = null;
  let usedFallback = false;

  // 優先使用：有牆地圖 + BFS
  for (let sAttempt = 0; sAttempt < maxSeedAttempts; sAttempt++) {
    let seed;
    if (baseSeed) {
      seed = baseSeed;
      if (sAttempt > 0) seed = baseSeed + "_" + sAttempt;
    } else {
      seed = "seed-" + Math.random().toString(36).slice(2, 10);
    }

    const mapGrid = window.generateMap(seed, mapSize);
    const pos = findStartPositions(mapGrid, mapSize, maxPairAttempts);
    if (!pos) continue;

    finalSeed = seed;
    startAX = pos.ax;
    startAY = pos.ay;
    startBX = pos.bx;
    startBY = pos.by;
    usedFallback = false;
    break;
  }

  // 若多次失敗 → 後備模式（全道路）
  if (finalSeed === null) {
    usedFallback = true;
    finalSeed = baseSeed
      ? baseSeed + "_fallback"
      : "seed-fallback-" + Math.random().toString(36).slice(2, 10);

    const pos = fallbackStartPositions(mapSize);
    startAX = pos.ax;
    startAY = pos.ay;
    startBX = pos.bx;
    startBY = pos.by;
  }

  if (seedInput) seedInput.value = finalSeed;

  try {
    // rooms upsert
    const { data: existingRoom, error: roomErr } = await window._supabase
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (roomErr) {
      console.error(roomErr);
      statusEl.textContent = "讀取房間時出錯";
      return;
    }

    let room = null;

    if (existingRoom) {
      const { data: updated, error: updErr } = await window._supabase
        .from("rooms")
        .update({
          seed: finalSeed,
          map_size: mapSize,
          status: "waiting"
        })
        .eq("id", existingRoom.id)
        .select()
        .single();

      if (updErr) {
        console.error(updErr);
        statusEl.textContent = "更新房間失敗";
        return;
      }
      room = updated;
    } else {
      const { data: inserted, error: insErr } = await window._supabase
        .from("rooms")
        .insert({
          code: code,
          seed: finalSeed,
          map_size: mapSize,
          status: "waiting"
        })
        .select()
        .single();

      if (insErr) {
        console.error(insErr);
        statusEl.textContent = "建立房間失敗";
        return;
      }
      room = inserted;
    }

    // players upsert：位置同時寫 x,y 以及 ix,iy
    const dirA = randomInt(0, 3);
    const dirB = randomInt(0, 3);

    const { error: upErr } = await window._supabase
      .from("players")
      .upsert(
        [
          {
            room_id: room.id,
            name: "PlayerA",
            role: "A",
            x: startAX,
            y: startAY,
            ix: startAX,
            iy: startAY,
            direction: dirA
          },
          {
            room_id: room.id,
            name: "PlayerB",
            role: "B",
            x: startBX,
            y: startBY,
            ix: startBX,
            iy: startBY,
            direction: dirB
          }
        ],
        { onConflict: "room_id,role" }
      );

    if (upErr) {
      console.error(upErr);
      statusEl.textContent = "建立 / 更新玩家失敗";
      return;
    }

    const modeText = usedFallback
      ? "（後備模式：視為全道路地圖）"
      : "（已確認 A/B 可互通）";

    statusEl.textContent =
      `房間 ${room.code} 已建立 / 重設完成 ｜ seed = ${room.seed} ｜ ` +
      `地圖 ${room.map_size}×${room.map_size} ｜ ` +
      `A 起點 (${startAX},${startAY}) ｜ B 起點 (${startBX},${startBY})\n` +
      modeText;

    const origin = window.location.origin;
    const playerAUrl =
      origin + "/index.html?room=" + encodeURIComponent(code) + "&role=A";
    const playerBUrl =
      origin + "/index.html?room=" + encodeURIComponent(code) + "&role=B";
    const viewerUrl =
      origin + "/viewer.html?room=" + encodeURIComponent(code);

    if (linksEl) {
      linksEl.innerHTML = `
        <div>玩家 A：</div>
        <a href="${playerAUrl}" target="_blank">${playerAUrl}</a>
        <div>玩家 B：</div>
        <a href="${playerBUrl}" target="_blank">${playerBUrl}</a>
        <div>觀眾端 Viewer：</div>
        <a href="${viewerUrl}" target="_blank">${viewerUrl}</a>
      `;
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = "未知錯誤";
  }
}

// 清除全部 rooms + players
async function clearAllData() {
  const statusEl = document.getElementById("status");
  const linksEl = document.getElementById("links");

  const ok = confirm(
    "⚠️ 確定要清除所有房間與玩家資料嗎？\n此動作不可復原！"
  );
  if (!ok) return;

  if (!window._supabase) {
    statusEl.textContent = "Supabase 尚未初始化";
    return;
  }

  statusEl.textContent = "刪除中…";

  try {
    await window._supabase.from("players").delete().neq("id", 0);
    await window._supabase.from("rooms").delete().neq("id", 0);

    statusEl.textContent = "已清除所有紀錄（rooms + players）。";
    if (linksEl) linksEl.innerHTML = "尚未建立房間。";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "刪除資料時出現錯誤。";
  }
}
