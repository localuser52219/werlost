// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer（交叉點 + 2×2 視野 + 全圖 + 群集顏色）

(function () {
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  // 玩家附近店舖：上、下、左、右四格
  const NEAR_OFFSETS = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ];

  const POLL_INTERVAL_MS = 1000;

  if (!window.supabase) {
    console.error("[viewer] Supabase CDN 未載入");
    return;
  }
  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  if (
    typeof window.generateMap !== "function" ||
    typeof window.getShopName !== "function" ||
    typeof window.isWall !== "function"
  ) {
    console.error(
      "[viewer] 未找到 generateMap / getShopName / isWall，請確認已載入 js/shopName.js"
    );
  }

  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (_) {}
  }

  // 優先用 shopName.js 的 hashToInt
  function hashToIntSafe(str) {
    if (typeof window.hashToInt === "function") {
      return window.hashToInt(str);
    }
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  // 群集 ID：每 5×5 一個 cluster
  function getClusterId(seed, x, y) {
    const block = 5;
    const cx = Math.floor(x / block);
    const cy = Math.floor(y / block);
    const g = hashToIntSafe(seed + ":cluster:" + cx + ":" + cy);
    return g % 6; // 0..5 → 六個群集
  }

  // 終點：由 seed + room.id 決定（除非 DB 已有 goal_x/goal_y）
  function computeGoal(seed, mapSize, roomId) {
    const baseSeed = seed || String(roomId) || "default-seed";
    const h = hashToIntSafe(baseSeed + ":goal");
    const x = h % mapSize;
    const y = Math.floor(h / mapSize) % mapSize;
    return { x, y };
  }

  // 從 players 列中拿交叉點座標（ix/iy 優先，否則 x/y）
  function getPlayerIntersection(p) {
    if (!p) return { ix: null, iy: null };
    const ix =
      p.ix !== null && p.ix !== undefined
        ? p.ix
        : p.x !== null && p.x !== undefined
        ? p.x
        : null;
    const iy =
      p.iy !== null && p.iy !== undefined
        ? p.iy
        : p.y !== null && p.y !== undefined
        ? p.y
        : null;
    return { ix, iy };
  }

  // 根據 direction（0=↑,1=→,2=↓,3=←）計算交叉點前方 2×2 視野
  // 注意：這裡完全是「畫面邏輯」，確保視野與箭咀方向一致
  function buildFovSet(player, mapSize) {
    const { ix, iy } = getPlayerIntersection(player);
    if (ix === null || iy === null) return new Set();

    let dir = Number.isInteger(player?.direction) ? player.direction : 2;
    dir = ((dir % 4) + 4) % 4;

    const offsets = [];

    if (dir === 2) {
      // ↓ 南：交叉點下方 2×2
      offsets.push(
        { dx: 0, dy: -1 },
        { dx: -1, dy: -1 },
        { dx: 0, dy: -2 },
        { dx: -1, dy: -2 }
      );
    } else if (dir === 0) {
      // ↑ 北：交叉點上方 2×2
      offsets.push(
        { dx: -1, dy: 1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 2 },
        { dx: 0, dy: 2 }
      );
    } else if (dir === 1) {
      // → 東：交叉點右方 2×2
      offsets.push(
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 2, dy: 0 },
        { dx: 2, dy: 1 }
      );
    } else {
      // 3 ← 西：交叉點左方 2×2
      offsets.push(
        { dx: -1, dy: 0 },
        { dx: -1, dy: -1 },
        { dx: -2, dy: 0 },
        { dx: -2, dy: -1 }
      );
    }

    const set = new Set();
    for (const o of offsets) {
      const x = ix + o.dx;
      const y = iy + o.dy;
      if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) continue;
      set.add(x + "," + y);
    }
    return set;
  }

  function formatDirection(dir) {
    const d = Number.isInteger(dir) ? dir : null;
    if (d === 0) return "↑ 北";
    if (d === 1) return "→ 東";
    if (d === 2) return "↓ 南";
    if (d === 3) return "← 西";
    return "未知";
  }

  function arrowForDirection(dir) {
    const d = Number.isInteger(dir) ? dir : null;
    if (d === 0) return "↑";
    if (d === 1) return "→";
    if (d === 2) return "↓";
    if (d === 3) return "←";
    return "●";
  }

  document.addEventListener("DOMContentLoaded", function () {
    const params = new URLSearchParams(window.location.search);
    const roomFromRoom = params.get("room");
    const roomFromCode = params.get("code");
    const roomCode = roomFromRoom || roomFromCode || "";

    const errorEl = document.getElementById("viewer-error");
    const mainEl = document.getElementById("viewer-main");
    const roomCodeEl = document.getElementById("room-code");
    const mapGridEl = document.getElementById("map-grid");
    const playerLayerEl = document.getElementById("player-layer");

    const playerAStatusEl = document.getElementById("player-a-status");
    const playerBStatusEl = document.getElementById("player-b-status");
    const playerAShopsEl = document.getElementById("player-a-shops");
    const playerBShopsEl = document.getElementById("player-b-shops");

    const destinationStatusEl = document.getElementById("destination-status");
    const destinationExtraEl = document.getElementById("destination-extra");

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg || "";
      errorEl.style.display = msg ? "block" : "none";
    }

    function showMain() {
      if (mainEl) mainEl.style.display = "";
    }

    function hideMain() {
      if (mainEl) mainEl.style.display = "none";
    }

    function ensureDefaultText() {
      if (playerAStatusEl && !playerAStatusEl.textContent.trim()) {
        playerAStatusEl.textContent = "尚未有玩家資料";
      }
      if (playerBStatusEl && !playerBStatusEl.textContent.trim()) {
        playerBStatusEl.textContent = "尚未有玩家資料";
      }
      if (destinationStatusEl && !destinationStatusEl.textContent.trim()) {
        destinationStatusEl.textContent = "尚未設定";
      }
    }

    ensureDefaultText();

    if (!roomCode) {
      showError("URL 缺少 ?room= 房間代碼");
      hideMain();
      return;
    }

    if (roomFromCode && !roomFromRoom) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("room", roomFromCode);
        window.history.replaceState(null, "", url.toString());
        logDebug("Replaced ?code= with ?room=", roomFromCode);
      } catch (e) {
        logDebug("Failed to replace URL params", e);
      }
    }

    showMain();
    showError("");
    if (roomCodeEl) roomCodeEl.textContent = roomCode;
    try {
      document.title = "迷路追蹤器 觀眾端 Viewer – 房間 " + roomCode;
    } catch (_) {}

    let isFetching = false;
    let pollTimer = null;
    let lastRoomId = null;
    let lastSeed = null;
    let lastMapSize = null;
    let lastMap = null;

    async function fetchAndRender(code) {
      if (isFetching) return;
      isFetching = true;

      try {
        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .select("*")
          .eq("code", code)
          .maybeSingle();

        if (roomError) {
          logDebug("Room fetch error", roomError);
          showError("讀取房間資料失敗（Supabase）");
          isFetching = false;
          return;
        }
        if (!room) {
          showError("找不到房間：" + code);
          isFetching = false;
          return;
        }

        const { data: players, error: playersError } = await supabase
          .from("players")
          .select("*")
          .eq("room_id", room.id);

        if (playersError) {
          logDebug("Players fetch error", playersError);
          showError("讀取玩家資料失敗（Supabase）");
          isFetching = false;
          return;
        }

        const playerA =
          players?.find((p) => String(p.role).toUpperCase() === "A") || null;
        const playerB =
          players?.find((p) => String(p.role).toUpperCase() === "B") || null;

        const seed = room.seed || String(room.id) || "default-seed";
        const mapSize =
          typeof room.map_size === "number" && room.map_size > 0
            ? room.map_size
            : 25; // fallback

        if (
          !lastMap ||
          lastRoomId !== room.id ||
          lastSeed !== seed ||
          lastMapSize !== mapSize
        ) {
          if (typeof window.generateMap === "function") {
            lastMap = window.generateMap(seed, mapSize);
            lastRoomId = room.id;
            lastSeed = seed;
            lastMapSize = mapSize;
            logDebug("Generated map", { seed, mapSize });
          } else {
            lastMap = null;
            console.error("[viewer] generateMap 未定義");
          }
        }

        let destX =
          typeof room.goal_x === "number" ? room.goal_x : undefined;
        let destY =
          typeof room.goal_y === "number" ? room.goal_y : undefined;
        if (
          typeof destX !== "number" ||
          typeof destY !== "number" ||
          isNaN(destX) ||
          isNaN(destY)
        ) {
          const goal = computeGoal(seed, mapSize, room.id);
          destX = goal.x;
          destY = goal.y;
        }

        renderState({
          room,
          seed,
          mapSize,
          map: lastMap,
          playerA,
          playerB,
          destX,
          destY
        });
        showError("");
      } catch (e) {
        logDebug("Unexpected fetch error", e);
        showError("讀取遊戲狀態時發生未預期錯誤");
      } finally {
        isFetching = false;
      }
    }

    function renderState(state) {
      const {
        room,
        seed,
        mapSize,
        map,
        playerA,
        playerB,
        destX,
        destY
      } = state;

      const posA = getPlayerIntersection(playerA);
      const posB = getPlayerIntersection(playerB);

      if (playerAStatusEl) {
        if (posA.ix !== null && posA.iy !== null) {
          playerAStatusEl.textContent = `交叉點座標 (${posA.ix}, ${posA.iy})，面向 ${formatDirection(
            playerA?.direction
          )}`;
        } else {
          playerAStatusEl.textContent = "尚未有玩家資料";
        }
      }

      if (playerBStatusEl) {
        if (posB.ix !== null && posB.iy !== null) {
          playerBStatusEl.textContent = `交叉點座標 (${posB.ix}, ${posB.iy})，面向 ${formatDirection(
            playerB?.direction
          )}`;
        } else {
          playerBStatusEl.textContent = "尚未有玩家資料";
        }
      }

      let goalName = "";
      if (
        typeof destX === "number" &&
        typeof destY === "number" &&
        typeof window.getShopName === "function"
      ) {
        goalName = window.getShopName(seed, destX, destY);
      } else if (room.goal_shop) {
        goalName = room.goal_shop;
      }

      if (destinationStatusEl) {
        if (typeof destX === "number" && typeof destY === "number") {
          destinationStatusEl.textContent = goalName
            ? `${goalName} ★（${destX}, ${destY}）`
            : `終點 ★（${destX}, ${destY}）`;
        } else {
          destinationStatusEl.textContent = "尚未設定";
        }
      }

      if (destinationExtraEl) {
        destinationExtraEl.innerHTML = "";
        if (posA.ix !== null && posA.iy !== null) {
          const distA =
            Math.abs(posA.ix - destX) + Math.abs(posA.iy - destY);
          const liA = document.createElement("li");
          liA.textContent = `玩家 A 的交叉點距離終點約 ${distA} 格。`;
          destinationExtraEl.appendChild(liA);
        }
        if (posB.ix !== null && posB.iy !== null) {
          const distB =
            Math.abs(posB.ix - destX) + Math.abs(posB.iy - destY);
          const liB = document.createElement("li");
          liB.textContent = `玩家 B 的交叉點距離終點約 ${distB} 格。`;
          destinationExtraEl.appendChild(liB);
        }
      }

      updateNearbyShops(seed, map, mapSize, posA, playerAShopsEl);
      updateNearbyShops(seed, map, mapSize, posB, playerBShopsEl);

      const fovSetA = buildFovSet(playerA, mapSize);
      const fovSetB = buildFovSet(playerB, mapSize);
      const fovUnion = new Set([...fovSetA, ...fovSetB]);

      renderMap(
        seed,
        map,
        mapSize,
        posA,
        posB,
        playerA,
        playerB,
        destX,
        destY,
        fovUnion
      );
    }

    function updateNearbyShops(seed, map, mapSize, pos, listEl) {
      if (!listEl) return;
      listEl.innerHTML = "";

      if (pos.ix === null || pos.iy === null) {
        const li = document.createElement("li");
        li.textContent = "尚未有玩家座標";
        listEl.appendChild(li);
        return;
      }

      if (!map || !Array.isArray(map) || !map[0]) {
        const li = document.createElement("li");
        li.textContent = "地圖尚未載入";
        listEl.appendChild(li);
        return;
      }

      const shops = [];
      const seen = new Set();
      const hasIsWall = typeof window.isWall === "function";
      const hasGetShopName = typeof window.getShopName === "function";

      for (const off of NEAR_OFFSETS) {
        const x = pos.ix + off.dx;
        const y = pos.iy + off.dy;

        if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) continue;

        if (hasIsWall && window.isWall(map, x, y)) continue;

        let name = "";
        if (hasGetShopName) {
          name = window.getShopName(seed, x, y);
        } else {
          name = `店舖 (${x}, ${y})`;
        }

        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        shops.push({ x, y, name });
      }

      if (shops.length === 0) {
        const li = document.createElement("li");
        li.textContent = "附近沒有可顯示的店舖";
        listEl.appendChild(li);
        return;
      }

      shops.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = `${s.name}（${s.x}, ${s.y}）`;
        listEl.appendChild(li);
      });
    }

    function renderMap(
      seed,
      map,
      mapSize,
      posA,
      posB,
      playerA,
      playerB,
      destX,
      destY,
      fovSet
    ) {
      if (!mapGridEl || !playerLayerEl) return;
      mapGridEl.innerHTML = "";
      playerLayerEl.innerHTML = "";

      if (!map || !Array.isArray(map) || !map[0]) {
        const warn = document.createElement("div");
        warn.style.fontSize = "0.85rem";
        warn.style.opacity = "0.8";
        warn.textContent = "地圖尚未生成。";
        mapGridEl.appendChild(warn);
        return;
      }

      // 全圖顯示
      mapGridEl.style.gridTemplateColumns = `repeat(${mapSize}, 1fr)`;

      const hasIsWall = typeof window.isWall === "function";

      for (let y = mapSize - 1; y >= 0; y--) {
        for (let x = 0; x < mapSize; x++) {
          const cell = document.createElement("div");
          cell.className = "map-cell";

          const isWallCell = hasIsWall ? window.isWall(map, x, y) : false;
          const isGoal =
            typeof destX === "number" &&
            typeof destY === "number" &&
            destX === x &&
            destY === y;

          if (!isWallCell) {
            const cid = getClusterId(seed, x, y);
            cell.classList.add("map-cell--cluster-" + cid);
          } else {
            cell.classList.add("map-cell--wall");
          }

          if (fovSet && fovSet.has(x + "," + y)) {
            cell.classList.add("map-cell--fov");
          }

          if (isGoal) {
            cell.classList.add("map-cell--goal");
            const labelSpan = document.createElement("span");
            labelSpan.className = "map-cell-label";
            labelSpan.textContent = "★";
            cell.appendChild(labelSpan);
          }

          mapGridEl.appendChild(cell);
        }
      }

      // 玩家圓點：畫在交叉點（格線交叉處）
      function drawPlayerDot(pos, player, cls) {
        if (pos.ix === null || pos.iy === null) return;
        const dot = document.createElement("div");
        dot.className = "player-dot " + cls;

        // 左下角 (0,0)，右上角 (mapSize, mapSize)
        const leftPercent = (pos.ix / mapSize) * 100;
        const topPercent = ((mapSize - pos.iy) / mapSize) * 100;

        dot.style.left = leftPercent + "%";
        dot.style.top = topPercent + "%";
        dot.textContent = arrowForDirection(player?.direction);
        playerLayerEl.appendChild(dot);
      }

      drawPlayerDot(posA, playerA, "player-dot-a");
      drawPlayerDot(posB, playerB, "player-dot-b");
    }

    // 啟動輪詢
    fetchAndRender(roomCode);
    pollTimer = window.setInterval(function () {
      fetchAndRender(roomCode);
    }, POLL_INTERVAL_MS);

    window.addEventListener("beforeunload", function () {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    });
  });
})();
