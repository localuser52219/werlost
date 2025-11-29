// js/admin.js
// 房間控制台：建立 / 重設房間，並產生 Player / Viewer 連結
// 穩定版：
// 1. 優先使用 generateMap + BFS，保證 A/B 可互通。
// 2. 如果多次嘗試失敗，啟動「後備模式」：全道路地圖，A/B 一定互通。

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("createResetBtn");
  if (btn) btn.addEventListener("click", createOrResetRoom);
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

// 在給定的 map 上，嘗試找到一對可互通的起點 (A,B)
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
    if (manhattan < minDist) {
      continue; // 太近，再抽一對
    }

    if (canReach(mapGrid, size, a.x, a.y, b.x, b.y)) {
      return {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y
      };
    }
  }

  return null;
}

// 後備模式：生成「全道路」地圖的起點（不依賴 generateMap）
function fallbackStartPositions(size) {
  const margin = 1; // 不貼邊
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
  // 實在抽不到就硬給兩個角落
  return { ax: 1, ay: 1, bx: size - 2, by: size - 2 };
}

// 主流程：建立 / 重設房間
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

  // 優先嘗試：有牆的 map + BFS 保證可達
  for (let sAttempt = 0; sAttempt < maxSeedAttempts; sAttempt++) {
    let seed;
    if (baseSeed && baseSeed !== "") {
      seed = baseSeed;
      if (sAttempt > 0) seed = baseSeed + "_" + sAttempt;
    } else {
      seed = "seed-" + Math.random().toString(36).slice(2, 10);
    }

    const mapGrid = window.generateMap(seed, mapSize);
    const pos = findStartPositions(mapGrid, mapSize, maxPairAttempts);
    if (!pos) {
      continue; // 換下一個 seed
    }

    finalSeed = seed;
    startAX = pos.ax;
    startAY = pos.ay;
    startBX = pos.bx;
    startBY = pos.by;
    usedFallback = false;
    break;
  }

  // 如果多次嘗試仍失敗，啟動後備模式：全道路地圖
  if (finalSeed === null) {
    usedFallback = true;
    finalSeed =
      (baseSeed && baseSeed !== "")
        ? baseSeed + "_fallback"
        : "seed-fallback-" + Math.random().toString(36).slice(2, 10);

    const pos = fallbackStartPositions(mapSize);
    startAX = pos.ax;
    startAY = pos.ay;
    startBX = pos.bx;
    startBY = pos.by;
  }

  // 把實際用到的 seed 填回輸入框，方便重現
  if (seedInput) {
    seedInput.value = finalSeed;
  }

  try {
    // 2. 查詢是否已存在此房間
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

    const dirA = randomInt(0, 3); // 0 北,1 東,2 南,3 西
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
            direction: dirA
          },
          {
            room_id: room.id,
            name: "PlayerB",
            role: "B",
            x: startBX,
            y: startBY,
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
      ? "（已使用後備模式：此房間地圖視為全道路、無牆，A/B 必定可互通）"
      : "（使用隨機牆壁地圖，已確認 A/B 可互通）";

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
