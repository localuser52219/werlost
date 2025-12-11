// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer（修正版）
// 主要改動：
// 1. Supabase 查詢改用 .select("*")，避免未知欄位造成 400 Bad Request
// 2. 終點改為：由 seed + room 唯一抽出一個店舖位置，並在地圖以 ★ 顯示
// 3. 終點店名由 getShopName(seed, goalX, goalY) 產生，無須 DB 欄位

(function () {
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  const MAX_VIEW_SIZE = 25;
  const NEAR_SHOP_RADIUS = 2; // 玩家周圍四格 → 曼哈頓距離 1~2
  const POLL_INTERVAL_MS = 1000;
  const FOV_RANGE = 4; // 視野距離

  // ---------- 基礎檢查 ----------
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

  // hash 工具：優先用 shopName.js 提供的 hashToInt，否則用本地版本
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

  // 由 seed + room.id 決定一個終點座標（確保 deterministic）
  function computeGoal(seed, mapSize, roomId) {
    const baseSeed = seed || String(roomId) || "default-seed";
    const h = hashToIntSafe(baseSeed + ":goal");
    const x = h % mapSize;
    const y = Math.floor(h / mapSize) % mapSize;
    return { x, y };
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

    // 相容舊 ?code=
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

    // ---------- 1. 讀取 rooms / players ----------
    async function fetchAndRender(code) {
      if (isFetching) return;
      isFetching = true;

      try {
        // rooms：用 * 避免因欄位名稱不符導致 400
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

        // players：同樣用 *
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
        const mapSizeRaw =
          typeof room.map_size === "number" && room.map_size > 0
            ? room.map_size
            : null;
        const mapSize = mapSizeRaw || MAX_VIEW_SIZE;

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

        // 終點：若 DB 沒有 goal_x / goal_y，就用 computeGoal 決定
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
          destY,
        });
        showError("");
      } catch (e) {
        logDebug("Unexpected fetch error", e);
        showError("讀取遊戲狀態時發生未預期錯誤");
      } finally {
        isFetching = false;
      }
    }

    // ---------- 2. 更新畫面 ----------
    function renderState(state) {
      const { room, seed, mapSize, map, playerA, playerB, destX, destY } =
        state;

      // 2A. 玩家文字狀態
      if (playerAStatusEl) {
        if (
          playerA &&
          typeof playerA.x === "number" &&
          typeof playerA.y === "number"
        ) {
          playerAStatusEl.textContent = `位置 (${playerA.x}, ${playerA.y}) 面向 ${formatDirection(
            playerA.direction
          )}`;
        } else {
          playerAStatusEl.textContent = "尚未有玩家資料";
        }
      }

      if (playerBStatusEl) {
        if (
          playerB &&
          typeof playerB.x === "number" &&
          typeof playerB.y === "number"
        ) {
          playerBStatusEl.textContent = `位置 (${playerB.x}, ${playerB.y}) 面向 ${formatDirection(
            playerB.direction
          )}`;
        } else {
          playerBStatusEl.textContent = "尚未有玩家資料";
        }
      }

      // 2B. 終點店名（由 getShopName 生成）
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
        if (
          playerA &&
          typeof playerA.x === "number" &&
          typeof playerA.y === "number" &&
          typeof destX === "number" &&
          typeof destY === "number"
        ) {
          const distA =
            Math.abs(playerA.x - destX) + Math.abs(playerA.y - destY);
          const liA = document.createElement("li");
          liA.textContent = `玩家 A 距離終點約 ${distA} 格（曼哈頓距離）。`;
          destinationExtraEl.appendChild(liA);
        }
        if (
          playerB &&
          typeof playerB.x === "number" &&
          typeof playerB.y === "number" &&
          typeof destX === "number" &&
          typeof destY === "number"
        ) {
          const distB =
            Math.abs(playerB.x - destX) + Math.abs(playerB.y - destY);
          const liB = document.createElement("li");
          liB.textContent = `玩家 B 距離終點約 ${distB} 格（曼哈頓距離）。`;
          destinationExtraEl.appendChild(liB);
        }
      }

      // 2C. 玩家附近店舖列表
      updateNearbyShops(
        seed,
        map,
        mapSize,
        playerA,
        playerAShopsEl,
        "A"
      );
      updateNearbyShops(
        seed,
        map,
        mapSize,
        playerB,
        playerBShopsEl,
        "B"
      );

      // 2D. 地圖顯示
      renderMap(seed, map, mapSize, playerA, playerB, destX, destY);
    }

    function formatDirection(dir) {
      const d = Number.isInteger(dir) ? dir : null;
      if (d === 0) return "↑";
      if (d === 1) return "→";
      if (d === 2) return "↓";
      if (d === 3) return "←";
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

    function inFov(player, x, y) {
      if (
        !player ||
        typeof player.x !== "number" ||
        typeof player.y !== "number"
      )
        return false;

      const dx = x - player.x;
      const dy = y - player.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist === 0 || dist > FOV_RANGE) return false;

      const dir = Number.isInteger(player.direction) ? player.direction : -1;

      if (dir === 0) {
        if (dy <= 0) return false;
        return Math.abs(dx) <= dy;
      } else if (dir === 2) {
        if (dy >= 0) return false;
        return Math.abs(dx) <= -dy;
      } else if (dir === 1) {
        if (dx <= 0) return false;
        return Math.abs(dy) <= dx;
      } else if (dir === 3) {
        if (dx >= 0) return false;
        return Math.abs(dy) <= -dx;
      }
      return false;
    }

    function updateNearbyShops(seed, map, mapSize, player, listEl, label) {
      if (!listEl) return;
      listEl.innerHTML = "";

      if (
        !player ||
        typeof player.x !== "number" ||
        typeof player.y !== "number"
      ) {
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

      const px = player.x;
      const py = player.y;
      const shopMap = new Map();
      const hasIsWall = typeof window.isWall === "function";
      const hasGetShopName = typeof window.getShopName === "function";

      for (let dx = -NEAR_SHOP_RADIUS; dx <= NEAR_SHOP_RADIUS; dx++) {
        for (let dy = -NEAR_SHOP_RADIUS; dy <= NEAR_SHOP_RADIUS; dy++) {
          const x = px + dx;
          const y = py + dy;

          if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) continue;

          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist === 0 || dist > NEAR_SHOP_RADIUS) continue;

          if (hasIsWall && window.isWall(map, x, y)) continue;

          let name = "";
          if (hasGetShopName) {
            name = window.getShopName(seed, x, y);
          } else {
            name = `店舖 (${x}, ${y})`;
          }

          const key = `${x},${y}`;
          if (!shopMap.has(key)) {
            shopMap.set(key, { x, y, dist, name });
          }
        }
      }

      const shops = Array.from(shopMap.values()).sort((a, b) => {
        if (a.dist !== b.dist) return a.dist - b.dist;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });

      if (shops.length === 0) {
        const li = document.createElement("li");
        li.textContent = "附近沒有可顯示的店舖";
        listEl.appendChild(li);
        return;
      }

      const MAX_LIST = 4;
      shops.slice(0, MAX_LIST).forEach((s) => {
        const li = document.createElement("li");
        li.textContent = `${s.name}（${s.x}, ${s.y}，距離 ${s.dist}）`;
        listEl.appendChild(li);
      });
    }

    function renderMap(seed, map, mapSize, playerA, playerB, destX, destY) {
      if (!mapGridEl) return;
      mapGridEl.innerHTML = "";

      if (!map || !Array.isArray(map) || !map[0]) {
        const warn = document.createElement("div");
        warn.style.fontSize = "0.85rem";
        warn.style.opacity = "0.8";
        warn.textContent = "地圖尚未生成。";
        mapGridEl.appendChild(warn);
        return;
      }

      const viewSize = Math.min(mapSize, MAX_VIEW_SIZE);

      let centerX;
      let centerY;
      if (
        playerA &&
        typeof playerA.x === "number" &&
        typeof playerA.y === "number"
      ) {
        centerX = playerA.x;
        centerY = playerA.y;
      } else {
        centerX = Math.floor(mapSize / 2);
        centerY = Math.floor(mapSize / 2);
      }

      const half = Math.floor(viewSize / 2);
      let startX = centerX - half;
      let startY = centerY - half;

      if (startX < 0) startX = 0;
      if (startY < 0) startY = 0;
      if (startX + viewSize > mapSize) startX = mapSize - viewSize;
      if (startY + viewSize > mapSize) startY = mapSize - viewSize;

      mapGridEl.style.gridTemplateColumns = `repeat(${viewSize}, 1fr)`;

      const hasIsWall = typeof window.isWall === "function";

      for (let y = startY + viewSize - 1; y >= startY; y--) {
        for (let x = startX; x < startX + viewSize; x++) {
          const cell = document.createElement("div");
          cell.className = "map-cell";

          const isWallCell = hasIsWall ? window.isWall(map, x, y) : false;

          const isA =
            playerA &&
            typeof playerA.x === "number" &&
            typeof playerA.y === "number" &&
            playerA.x === x &&
            playerA.y === y;

          const isB =
            playerB &&
            typeof playerB.x === "number" &&
            typeof playerB.y === "number" &&
            playerB.x === x &&
            playerB.y === y;

          const isGoal =
            typeof destX === "number" &&
            typeof destY === "number" &&
            destX === x &&
            destY === y;

          const labelSpan = document.createElement("span");
          labelSpan.className = "map-cell-label";

          let label = "";
          if (isA) label = arrowForDirection(playerA.direction);
          if (isB) label = arrowForDirection(playerB.direction);
          if (isGoal) label = "★";

          labelSpan.textContent = label;
          cell.appendChild(labelSpan);

          const coordSpan = document.createElement("span");
          coordSpan.className = "map-cell-coord";
          coordSpan.textContent = `${x},${y}`;
          cell.appendChild(coordSpan);

          if (isWallCell) cell.classList.add("map-cell--wall");
          if (isA) cell.classList.add("map-cell--player-a");
          if (isB) cell.classList.add("map-cell--player-b");
          if (isGoal) cell.classList.add("map-cell--goal");

          // 視野：以玩家 A 為主
          if (playerA && inFov(playerA, x, y)) {
            cell.classList.add("map-cell--fov");
          }

          mapGridEl.appendChild(cell);
        }
      }
    }

    // ---------- 3. 啟動輪詢 ----------
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
