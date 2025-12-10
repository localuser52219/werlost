// /js/viewer.js

(function () {
  // ===== 0. Supabase 設定（你一定要改成自己的值） =====
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  // 利用 CDN 提供的全域 window.supabase 建立 client
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (_) {}
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
    const destinationStatusEl = document.getElementById("destination-status");
    const destinationExtraEl = document.getElementById("destination-extra");
    const playerAShopsEl = document.getElementById("player-a-shops");
    const playerBShopsEl = document.getElementById("player-b-shops");

    function showError(message) {
      if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.style.display = message ? "block" : "none";
      }
    }

    function hideMain() {
      if (mainEl) {
        mainEl.style.display = "none";
      }
    }

    function showMain() {
      if (mainEl) {
        mainEl.style.display = "";
      }
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

    // 沒有房間代碼：直接錯誤
    if (!roomCode) {
      logDebug("No room code in URL");
      showError("URL 缺少 ?room= 房間代碼");
      hideMain();
      return;
    }

    // 相容舊的 ?code=
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

    // 有房間：顯示主畫面
    showError("");
    showMain();

    if (roomCodeEl) {
      roomCodeEl.textContent = roomCode;
    }

    try {
      document.title = "迷路追蹤器 觀眾端 Viewer – 房間 " + roomCode;
    } catch (err) {
      logDebug("Failed to set document.title", err);
    }

    ensureDefaultText();

    // ===== 1. 從 Supabase 讀取遊戲狀態 =====

    async function fetchGameState(currentRoom) {
      try {
        // 1A. 讀取房間狀態（玩家位置＋終點）
        const { data: roomData, error: roomError } = await supabase
          .from("werlost_rooms") // TODO: 換成你的表名
          .select("*")
          .eq("room", currentRoom)
          .maybeSingle();

        if (roomError) {
          logDebug("Room fetch error", roomError);
          showError("讀取房間狀態失敗（Supabase）");
          return;
        }

        if (!roomData) {
          showError("找不到房間資料：" + currentRoom);
          return;
        }

        // 1B. 讀取房間店舖資料
        const { data: shopsData, error: shopsError } = await supabase
          .from("werlost_shops") // TODO: 換成你的表名
          .select("*")
          .eq("room", currentRoom);

        if (shopsError) {
          logDebug("Shops fetch error", shopsError);
          showError("讀取店舖資料失敗（Supabase）");
          return;
        }

        showError(""); // 成功讀到資料，清除錯誤
        updateView(roomData, shopsData || []);
      } catch (err) {
        logDebug("Unexpected fetch error", err);
        showError("讀取遊戲狀態時發生未預期錯誤");
      }
    }

    // ===== 2. 更新畫面（玩家狀態＋附近店舖＋終點） =====

    function updateView(room, shops) {
      const {
        player_a_x,
        player_a_y,
        player_b_x,
        player_b_y,
        dest_x,
        dest_y,
        dest_name,
      } = room;

      // 2A. 玩家／終點文字狀態
      if (playerAStatusEl) {
        if (typeof player_a_x === "number" && typeof player_a_y === "number") {
          playerAStatusEl.textContent = `位置 (${player_a_x}, ${player_a_y})`;
        } else {
          playerAStatusEl.textContent = "尚未有玩家資料";
        }
      }

      if (playerBStatusEl) {
        if (typeof player_b_x === "number" && typeof player_b_y === "number") {
          playerBStatusEl.textContent = `位置 (${player_b_x}, ${player_b_y})`;
        } else {
          playerBStatusEl.textContent = "尚未有玩家資料";
        }
      }

      if (destinationStatusEl) {
        if (
          typeof dest_x === "number" &&
          typeof dest_y === "number" &&
          dest_name
        ) {
          destinationStatusEl.textContent = `${dest_name}，座標 (${dest_x}, ${dest_y})`;
        } else if (
          typeof dest_x === "number" &&
          typeof dest_y === "number"
        ) {
          destinationStatusEl.textContent = `目的地座標 (${dest_x}, ${dest_y})`;
        } else {
          destinationStatusEl.textContent = "尚未設定";
        }
      }

      if (destinationExtraEl) {
        destinationExtraEl.innerHTML = "";
        if (
          typeof player_a_x === "number" &&
          typeof player_a_y === "number" &&
          typeof dest_x === "number" &&
          typeof dest_y === "number"
        ) {
          const distA =
            Math.abs(player_a_x - dest_x) + Math.abs(player_a_y - dest_y);
          const li = document.createElement("li");
          li.textContent = `玩家 A 與終點的距離（曼哈頓距離）約為 ${distA} 格。`;
          destinationExtraEl.appendChild(li);
        }
      }

      // 2B. 玩家附近店舖列表（距離 <= 2 格）
      function listNearbyShops(playerX, playerY, targetEl) {
        if (!targetEl) return;
        targetEl.innerHTML = "";

        if (typeof playerX !== "number" || typeof playerY !== "number") {
          return;
        }

        const nearby = shops
          .map((shop) => {
            const dx = shop.x - playerX;
            const dy = shop.y - playerY;
            const dist = Math.abs(dx) + Math.abs(dy); // 曼哈頓距離
            return { shop, dist };
          })
          .filter((item) => item.dist <= 2)
          .sort((a, b) => a.dist - b.dist);

        nearby.forEach(({ shop, dist }) => {
          const li = document.createElement("li");
          const name = shop.name || shop.short_name || "店舖";
          li.textContent = `${name}（座標 ${shop.x}, ${shop.y}，距離 ${dist}）`;
          targetEl.appendChild(li);
        });

        if (nearby.length === 0) {
          const li = document.createElement("li");
          li.textContent = "附近兩格內沒有店舖";
          targetEl.appendChild(li);
        }
      }

      listNearbyShops(player_a_x, player_a_y, playerAShopsEl);
      listNearbyShops(player_b_x, player_b_y, playerBShopsEl);

      // 2C. 地圖顯示（以玩家 A 為中心）

      if (!mapGridEl) return;

      mapGridEl.innerHTML = "";

      if (typeof player_a_x !== "number" || typeof player_a_y !== "number") {
        const warn = document.createElement("div");
        warn.style.fontSize = "0.85rem";
        warn.style.opacity = "0.8";
        warn.textContent = "玩家 A 尚未有座標，無法顯示地圖。";
        mapGridEl.appendChild(warn);
        return;
      }

      const size = 9; // 9x9 地圖
      const radius = (size - 1) / 2;
      const centerX = player_a_x;
      const centerY = player_a_y;

      for (let dy = radius; dy >= -radius; dy--) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cellX = centerX + dx;
          const cellY = centerY + dy;

          const cell = document.createElement("div");
          cell.className = "map-cell";

          const labelSpan = document.createElement("span");
          labelSpan.className = "map-cell-label";
          let label = "";
          let type = "";

          // 玩家／終點
          const isA = cellX === player_a_x && cellY === player_a_y;
          const isB =
            typeof player_b_x === "number" &&
            typeof player_b_y === "number" &&
            cellX === player_b_x &&
            cellY === player_b_y;
          const isDest =
            typeof dest_x === "number" &&
            typeof dest_y === "number" &&
            cellX === dest_x &&
            cellY === dest_y;

          if (isA) {
            label = "A";
            type = "player-a";
          } else if (isB) {
            label = "B";
            type = "player-b";
          }

          if (isDest) {
            // 若剛好玩家在終點，顯示「終」
            label = "終";
            type = "destination";
          }

          // 店舖（只取第一間）
          const shopInCell = shops.find(
            (s) => s.x === cellX && s.y === cellY
          );
          if (shopInCell) {
            label =
              shopInCell.short_name ||
              shopInCell.name?.charAt(0) ||
              (label || "店");
            if (!type) {
              type = "shop";
            }
          }

          labelSpan.textContent = label;
          cell.appendChild(labelSpan);

          const coordSpan = document.createElement("span");
          coordSpan.className = "map-cell-coord";
          coordSpan.textContent = `${cellX},${cellY}`;
          cell.appendChild(coordSpan);

          if (type) {
            cell.classList.add("map-cell--" + type);
          }

          mapGridEl.appendChild(cell);
        }
      }
    }

    // ===== 3. 啟動讀取 =====
    fetchGameState(roomCode);
  });
})();
