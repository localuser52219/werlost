// js/admin.js
// 房間控制台：建立 / 重設房間，並產生 Player / Viewer 連結
// 新版功能：
// 1. 根據地圖大小控制牆壁密度（由 generateMap 決定）。
// 2. 建房間前先用 generateMap + BFS 檢查，保證玩家 A / B 之間有可通路。
// 3. 起點一定落在可行走格（road），且不會太近。

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
      // 太近，換一對
      continue;
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

// 尋找一個「有路可通的」地圖佈局（seed + A/B 起點）
function findValidLayout(mapSize, baseSeed) {
  if (typeof window.generateMap !== "function" ||
      typeof window.isWall !== "function") {
    return { ok: false, error: "generateMap / isWall 未載入" };
  }

  const maxSeedAttempts = 10;   // 嘗試不同 seed 的上限
  const maxPairAttempts = 80;   // 在同一張圖上試不同起點對的上限

  for (let sAttempt = 0; sAttempt < maxSeedAttempts; sAttempt++) {
    let seed;
    if (baseSeed && baseSeed.trim() !== "") {
      seed = baseSeed.trim();
      if (sAttempt > 0) {
        seed = baseSeed.trim() + "_" + sAttempt;
      }
    } else {
      seed = "seed-" + Math.random().toString(36).slice(2, 10);
    }

    const mapGrid = window.generateMap(seed, mapSize);
    const pos = findStartPositions(mapGrid, mapSize, maxPairAttempts);
    if (!pos) {
      // 這張圖找不到合適的 A/B 起點，換下一個 seed
      continue;
    }

    return {
      ok: true,
      seed,
      mapGrid,
      ax: pos.ax,
      ay: pos.ay,
      bx: pos.bx,
      by: pos.by
    };
  }

  return { ok: false, error: "多次嘗試仍找不到可互通的起點" };
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

  // 1. 先在前端生成一個「有路可通」的 seed + 起點
  const layout = findValidLayout(mapSize, baseSeed);

  if (!layout.ok) {
    console.error(layout.error);
    statusEl.textContent = "生成可互通地圖失敗，請重試或更改地圖大小 / seed";
    return;
  }

  const finalSeed = layout.seed;
  const startAX = layout.ax;
  const startAY = layout.ay;
  const startBX = layout.bx;
  const startBY = layout.by;

  // 更新 seed 輸入框為實際使用的 seed，方便日後重現
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
      // 已存在 → 更新 seed / map_size / status
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
      // 新房間 → 插入
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

    // 3. 為 A / B 設定起點與方向（方向用隨機）
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

    statusEl.textContent =
      `房間 ${room.code} 已建立 / 重設完成 ｜ seed = ${room.seed} ｜ 地圖 ${room.map_size}×${room.map_size} ` +
      `｜ A 起點 (${startAX},${startAY}) ｜ B 起點 (${startBX},${startBY})`;

    // 4. 產生 Player / Viewer 連結
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
