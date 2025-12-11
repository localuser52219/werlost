// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer 最終版
// 需求：
// - URL ?room=xxx（相容 ?code=xxx）
// - 從 Supabase 讀取 rooms / players
// - 用 generateMap(seed, map_size) 產生牆壁
// - 用 getShopName(seed, x, y) 產生店舖名稱
// - 以玩家 A 為中心顯示最多 25×25 地圖
// - 顯示玩家 A / B、終點位置
// - 顯示兩玩家附近店舖列表
// - 每 1 秒輪詢更新

(function () {
  // 最大視窗尺寸（格數）
  const MAX_VIEW_SIZE = 25;
  // 玩家附近店舖搜尋半徑（曼哈頓距離）
  const NEAR_SHOP_RADIUS = 2;
  // 輪詢間隔（毫秒）
  const POLL_INTERVAL_MS = 1000;

  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (_) {
      // 忽略除錯錯誤
    }
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

    function showError(message) {
      if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.style.display = message ? "block" : "none";
      }
    }

    function hideMain() {
      if (mainEl) mainEl.style.display = "none";
    }

    function showMain() {
      if (mainEl) mainEl.style.display = "";
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

    // 無房間代碼：直接錯誤
    if (!roomCode) {
      logDebug("No room code in URL");
      showError("URL 缺少 ?room= 房間代碼");
      hideMain();
      return;
    }

    // 相容舊版 ?code=
    if (roomFromCode && !roomFromRoom) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("room", roomFromCode);
        window.history.replaceState(null, "", url.toString());
        logDebug("Replaced ?code= with ?room=", roomFromCode);
      } catch (err) {
        logDebug("Failed to replace URL params", err);
      }
    }

    // 顯示主畫面
    showError("");
    showMain();

    if (roomCodeEl) roomCodeEl.textContent = roomCode;
    try {
      document.title = "迷路追蹤器 觀眾端 Viewer – 房間 " + roomCode;
    } catch (err) {
      logDebug("Failed to set document.title", err);
    }

    ensureDefaultText();

    // Supabase client 來自 js/supabaseClient.js
    function getSupabase() {
      const client = window._supabase;
      if (!client) {
        console.error("[viewer] window._supabase 未初始化，請確認 supabaseClient.js 已正確載入");
      }
      return client;
    }

    let pollTimer = null;
    let isFetching = false;
    let lastRoomId = null;
    let lastSeed = null;
    let lastMapSize = null;
    let lastMap = null;

    // ===== 1. 讀取遊戲狀態 =====
    async function fetchAndRender(currentRoomCode) {
      if (isFetching) return;
      const supabase = getSupabase();
      if (!supabase) {
        showError("Supabase 未初始化，請檢查腳本載入順序");
        return;
      }

      isFetching = true;

      try {
        // 1A. rooms：根據 code 找房間
        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .select("id, code, seed, status, map_size, goal_shop, goal_x, goal_y")
          .eq("code", currentRoomCode)
          .maybeSingle();

        if (roomError) {
          logDebug("Room fetch error", roomError);
          showError("讀取房間資料失敗（Supabase）");
          isFetching = false;
          return;
        }

        if (!room) {
          showError("找不到房間：" + currentRoomCode);
          isFetching = false;
          return;
        }

        // 1B. players：找該房間所有玩家
        const { data: players, error: playersError } = await supabase
          .from("players")
          .select("id, room_id, role, x, y, updated_at")
          .eq("room_id", room.id);

        if (playersError) {
          logDebug("Players fetch error", playersError);
          showError("讀取玩家資料失敗（Supabase）");
          isFetching = false;
          return;
        }

        const playerA = players?.find(
          (p) => String(p.role).toUpperCase() === "A"
        ) || null;
        const playerB = players?.find(
          (p) => String(p.role).toUpperCase() === "B"
        ) || null;

        // 1C. 準備地圖
        const seed = room.seed || String(room.id) || "default-seed";
        const mapSize =
          typeof room.map_size === "number" && room.map_size > 0
            ? room.map_size
            : MAX_VIEW_SIZE;

        if (
          lastRoomId !== room.id ||
          lastSeed !== seed ||
          lastMapSize !== mapSize ||
          !lastMap
        ) {
          if (typeof window.generateMap === "function") {
            lastMap = window.generateMap(seed, mapSize);
            lastRoomId = room.id;
            lastSeed = seed;
            lastMapSize = mapSize;
            logDebug("Generated map", { seed, mapSize });
          } else {
            lastMap = null;
            console.error(
              "[viewer] generateMap 未定義，請確認已載入 js/shopName.js"
            );
          }
        }

        const gameState = {
          room,
          seed,
          mapSize,
          map: lastMap,
          playerA,
          playerB,
        };

        renderGameState(gameState);
        showError("");
      } catch (err) {
        logDebug("Unexpected fetch error", err);
        showError("讀取遊戲狀態時發生未預期錯誤");
      } finally {
        isFetching = false;
      }
    }

    // ===== 2. 更新畫面 =====
    function renderGameState(state) {
      const { room, seed, mapSize, map, playerA, playerB } = state;

      // 2A. 玩家文字
      if (playerAStatusEl) {
        if (
          playerA &&
          typeof playerA.x === "number" &&
          typeof playerA.y === "number"
        ) {
          playerAStatusEl.textContent = `位置 (${playerA.x}, ${playerA.y})`;
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
          playerBStatusEl.textContent = `位置 (${playerB.x}, ${playerB.y})`;
        } else {
          playerBStatusEl.textContent = "尚未有玩家資料";
        }
      }

      // 2B. 終點文字
      const destX = room.goal_x;
      const destY = room.goal_y;
      const destName = room.goal_shop;

      if (destinationStatusEl) {
        if (typeof destX === "number" && typeof destY === "number") {
          const label = destName || "目的地";
          destinationStatusEl.textContent = `${label}（${destX}, ${destY}）`;
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

      // 2C. 附近店舖列表（以虛擬店名生成）
      updateNearbyShopsList(
        seed,
        map,
        mapSize,
        playerA,
        playerAShopsEl,
        "A"
      );
      updateNearbyShopsList(
        seed,
        map,
        mapSize,
        playerB,
        playerBShopsEl,
        "B"
      );

      // 2D. 地圖顯示
      renderMapView(seed, map, mapSize, playerA, playerB, destX, destY);
    }

    function updateNearbyShopsList(seed, map, mapSize, player, listEl, label) {
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

      const MAX_LIST = 8;
      shops.slice(0, MAX_LIST).forEach((s) => {
        const li = document.createElement("li");
        li.textContent = `${s.name}（${s.x}, ${s.y}，距離 ${s.dist}）`;
        listEl.appendChild(li);
      });
    }

    function renderMapView(
      seed,
      map,
      mapSize,
      playerA,
      playerB,
      destX,
      destY
    ) {
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

          const isDest =
            typeof destX === "number" &&
            typeof destY === "number" &&
            destX === x &&
            destY === y;

          const labelSpan = document.createElement("span");
          labelSpan.className = "map-cell-label";

          let label = "";
          if (isA) label = "A";
          if (isB) label = "B";
          if (isDest) label = "終";

          labelSpan.textContent = label;
          cell.appendChild(labelSpan);

          const coordSpan = document.createElement("span");
          coordSpan.className = "map-cell-coord";
          coordSpan.textContent = `${x},${y}`;
          cell.appendChild(coordSpan);

          if (isWallCell) {
            cell.classList.add("map-cell--wall");
          }
          if (isA) {
            cell.classList.add("map-cell--player-a");
          }
          if (isB) {
            cell.classList.add("map-cell--player-b");
          }
          if (isDest) {
            cell.classList.add("map-cell--destination");
          }

          mapGridEl.appendChild(cell);
        }
      }
    }

    // ===== 3. 啟動輪詢 =====
    fetchAndRender(roomCode); // 立即載入一次

    const supabase = getSupabase();
    if (!supabase) {
      // 沒有 Supabase client，無法輪詢
      return;
    }

    const timer = window.setInterval(function () {
      fetchAndRender(roomCode);
    }, POLL_INTERVAL_MS);

    // 離開頁面時清除
    window.addEventListener("beforeunload", function () {
      if (timer) {
        clearInterval(timer);
      }
    });
  });
})();
