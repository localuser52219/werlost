// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer（對齊交叉點模型與 2×2 視野）

(function () {
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  // 顯示視窗大小（格數）：玩家 A 為中心，最大顯示 13×13
  const MAX_VIEW_SIZE = 13;

  // 玩家附近店舖：只取上、下、左、右四格
  const NEAR_OFFSETS = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ];

  const POLL_INTERVAL_MS = 1000;

  const FOV_RANGE = 2; // 只用來過濾交叉點視野格的距離（實際 2×2 已由公式決定）

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

  // 優先使用 shopName.js 的 hashToInt
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

  // 以 5×5 block 作群集，壓成 0..5 六類顏色
  function getClusterId(seed, x, y) {
    const block = 5;
    const cx = Math.floor(x / block);
    const cy = Math.floor(y / block);
    const g = hashToIntSafe(seed + ":cluster:" + cx + ":" + cy);
    return g % 6;
  }

  // 由 seed + room.id 決定一個終點座標（deterministic）
  function computeGoal(seed, mapSize, roomId) {
    const baseSeed = seed || String(roomId) || "default-seed";
    const h = hashToIntSafe(baseSeed + ":goal");
    const x = h % mapSize;
    const y = Math.floor(h / mapSize) % mapSize;
    return { x, y };
  }

  // 從 players 列中取得交叉點座標
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

  // 與 player.js 相同的視野公式：交叉點 (ix,iy) → 前方左右 2×2 cell
  // dir: 0=北,1=東,2=南,3=西
  function getFovCells(ix, iy, dir) {
    if (ix === null || iy === null) return null;

    if (dir === 0) {
      // 北：上方兩格列
      return {
        leftNear: { x: ix - 1, y: iy - 1 },
        rightNear: { x: ix, y: iy - 1 },
        leftFar: { x: ix - 1, y: iy - 2 },
        rightFar: { x: ix, y: iy - 2 }
      };
    } else if (dir === 1) {
      // 東：右邊兩格列
      return {
        leftNear: { x: ix, y: iy - 1 }, // 左 = 北
        rightNear: { x: ix, y: iy }, // 右 = 南
        leftFar: { x: ix + 1, y: iy - 1 },
        rightFar: { x: ix + 1, y: iy }
      };
    } else if (dir === 2) {
      // 南：下方兩格列
      return {
        leftNear: { x: ix, y: iy }, // 左 = 東
        rightNear: { x: ix - 1, y: iy }, // 右 = 西
        leftFar: { x: ix, y: iy + 1 },
        rightFar: { x: ix - 1, y: iy + 1 }
      };
    } else {
      // 3 = 西：左邊兩格列
      return {
        leftNear: { x: ix - 1, y: iy }, // 左 = 南
        rightNear: { x: ix - 1, y: iy - 1 }, // 右 = 北
        leftFar: { x: ix - 2, y: iy },
        rightFar: { x: ix - 2, y: iy - 1 }
      };
    }
  }

  function buildFovSet(player, mapSize) {
    const { ix, iy } = getPlayerIntersection(player);
    const dir = Number.isInteger(player?.direction) ? player.direction : 0;
    const f = getFovCells(ix, iy, dir);
    const set = new Set();
    if (!f) return set;

    const cells = [f.leftNear, f.rightNear, f.leftFar, f.rightFar];
    for (const c of cells) {
      if (!c) continue;
      if (
        c.x < 0 ||
        c.x >= mapSize ||
        c.y < 0 ||
        c.y >= mapSize
      )
        continue;
      const dist =
        Math.abs(c.x - (ix ?? 0)) + Math.abs(c.y - (iy ?? 0));
      if (dist > FOV_RANGE + 2) continue; // 安全限制一下
      set.add(c.x + "," + c.y);
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
            : MAX_VIEW_SIZE;

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

        // 終點：若 DB 無 goal_x / goal_y，則由 seed 抽一個
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

      // 玩家文字：明確寫「交叉點 ix / iy」
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

      // 終點店名
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

      // 玩家附近四格店舖（正上、正下、正左、正右）
      updateNearbyShops(
        seed,
        map,
        mapSize,
        posA,
        playerAShopsEl
      );
      updateNearbyShops(
        seed,
        map,
        mapSize,
        posB,
        playerBShopsEl
      );

      // 地圖（含群集顏色／視野／終點／玩家箭嘴）
      const fovSet = buildFovSet(playerA, mapSize);
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
        fovSet
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

      // 以玩家 A 交叉點為中心（如果沒有 A，就用地圖中央）
      let centerX;
      let centerY;
      if (posA.ix !== null && posA.iy !== null) {
        centerX = posA.ix;
        centerY = posA.iy;
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

      // 將交叉點轉成「代表格子」來畫箭嘴，用簡化方式：就近貼在交叉點右上方格
      function intersectionToCell(pos) {
        if (pos.ix === null || pos.iy === null) return null;
        let cx = pos.ix;
        let cy = pos.iy - 1; // 右上 NE cell
        if (cx < 0) cx = 0;
        if (cx >= mapSize) cx = mapSize - 1;
        if (cy < 0) cy = 0;
        if (cy >= mapSize) cy = mapSize - 1;
        return { x: cx, y: cy };
      }

      const cellA = intersectionToCell(posA);
      const cellB = intersectionToCell(posB);

      for (let y = startY + viewSize - 1; y >= startY; y--) {
        for (let x = startX; x < startX + viewSize; x++) {
          const cell = document.createElement("div");
          cell.className = "map-cell";

          const isWallCell = hasIsWall ? window.isWall(map, x, y) : false;

          const isA =
            cellA &&
            cellA.x === x &&
            cellA.y === y;

          const isB =
            cellB &&
            cellB.x === x &&
            cellB.y === y;

          const isGoal =
            typeof destX === "number" &&
            typeof destY === "number" &&
            destX === x &&
            destY === y;

          if (!isWallCell) {
            const clusterId = getClusterId(seed, x, y);
            cell.classList.add("map-cell--cluster-" + clusterId);
          }

          if (isWallCell) {
            cell.classList.remove(
              "map-cell--cluster-0",
              "map-cell--cluster-1",
              "map-cell--cluster-2",
              "map-cell--cluster-3",
              "map-cell--cluster-4",
              "map-cell--cluster-5"
            );
            cell.classList.add("map-cell--wall");
          }

          const labelSpan = document.createElement("span");
          labelSpan.className = "map-cell-label";

          let label = "";
          if (isA) label = arrowForDirection(playerA?.direction);
          if (isB) label = arrowForDirection(playerB?.direction);
          if (isGoal) label = "★";

          labelSpan.textContent = label;
          cell.appendChild(labelSpan);

          // 視野（只標示玩家 A 的 2×2 格）
          if (fovSet && fovSet.has(x + "," + y)) {
            cell.classList.add("map-cell--fov");
          }

          if (isA) cell.classList.add("map-cell--player-a");
          if (isB) cell.classList.add("map-cell--player-b");
          if (isGoal) cell.classList.add("map-cell--goal");

          mapGridEl.appendChild(cell);
        }
      }
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
