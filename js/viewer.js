// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer（修正還原版）

(function () {
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  let supabaseClient = null;

  const CLUSTER_BLOCK_SIZE = 5;
  const POLL_INTERVAL_MS = 2000; // 放寬一點避免太頻繁
  const REALTIME_CHANNEL_PREFIX = "viewer_room_";

  // 工具：Debug log
  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (_) {}
  }

  // 工具：Hash
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

  // 計算群集 ID
  function getClusterId(seed, x, y) {
    const block = 5;
    const cx = Math.floor(x / block);
    const cy = Math.floor(y / block);
    const g = hashToIntSafe(seed + ":cluster:" + cx + ":" + cy);
    return g % 6; 
  }

  // 取得群集顯示名稱（大字）
  function getClusterTypeLabel(seed, x, y) {
    // 這裡直接呼叫 getShopName，它會回傳完整店名，我們只取「種類」或簡化顯示
    if (typeof window.getShopName === "function") {
      const name = window.getShopName(seed, x, y);
      // 簡單處理：只取中間的 emoji 或店名關鍵字
      // 但為了簡單，直接顯示該區塊第一間店的名字作為代表
      return name;
    }
    return "";
  }

  // 計算終點
  function computeGoal(seed, mapSize, roomId) {
    const baseSeed = seed || String(roomId) || "default-seed";
    const h = hashToIntSafe(baseSeed + ":goal");
    const x = h % mapSize;
    const y = Math.floor(h / mapSize) % mapSize;
    return { x, y };
  }

  // 取得玩家交叉點位置 (ix, iy 優先)
  function getPlayerIntersection(p) {
    if (!p) return { ix: null, iy: null };
    const ix = (p.ix !== null && p.ix !== undefined) ? p.ix : (p.x !== null ? p.x : null);
    const iy = (p.iy !== null && p.iy !== undefined) ? p.iy : (p.y !== null ? p.y : null);
    return { ix, iy };
  }

  // 計算視野 Set (x,y)
  function buildFovSet(player, mapSize) {
    const { ix, iy } = getPlayerIntersection(player);
    if (ix === null || iy === null) return new Set();

    let dir = Number.isInteger(player?.direction) ? player.direction : 2;
    dir = ((dir % 4) + 4) % 4;

    const offsets = [];
    // 根據 js/player.js 的定義：
    // 0=北(上方兩格), 1=東(右方兩格), 2=南(下方兩格), 3=西(左方兩格)
    // 且格子座標相對於交叉點 (ix, iy) 的位置
    if (dir === 0) { // 北
      offsets.push({dx:-1, dy:-1}, {dx:0, dy:-1}, {dx:-1, dy:-2}, {dx:0, dy:-2});
    } else if (dir === 1) { // 東
      offsets.push({dx:1, dy:-1}, {dx:1, dy:0}, {dx:2, dy:-1}, {dx:2, dy:0});
    } else if (dir === 2) { // 南
      offsets.push({dx:-1, dy:0}, {dx:0, dy:0}, {dx:-1, dy:1}, {dx:0, dy:1});
    } else { // 西
      offsets.push({dx:-1, dy:-1}, {dx:-1, dy:0}, {dx:-2, dy:-1}, {dx:-2, dy:0});
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
    const map = ["↑ 北", "→ 東", "↓ 南", "← 西"];
    return map[d] || "未知";
  }

  function arrowForDirection(dir) {
    const d = Number.isInteger(dir) ? dir : null;
    const map = ["↑", "→", "↓", "←"];
    return map[d] || "●";
  }

  // --- 主流程 ---
  document.addEventListener("DOMContentLoaded", function () {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get("room") || params.get("code") || "";

    const errorEl = document.getElementById("viewer-error");
    const mainEl = document.getElementById("viewer-main");
    const roomCodeEl = document.getElementById("room-code");
    const mapGridEl = document.getElementById("map-grid");
    const mapLabelLayerEl = document.getElementById("map-labels");
    const playerLayerEl = document.getElementById("player-layer");

    const playerAStatusEl = document.getElementById("player-a-status");
    const playerBStatusEl = document.getElementById("player-b-status");
    const playerAShopsEl = document.getElementById("player-a-shops");
    const playerBShopsEl = document.getElementById("player-b-shops");
    const destinationStatusEl = document.getElementById("destination-status");

    function showError(msg) {
      if (errorEl) {
        errorEl.textContent = msg || "";
        errorEl.style.display = msg ? "block" : "none";
      }
    }

    // 初始化 Supabase
    if (!window.supabase) {
      showError("Supabase library 未載入，請檢查網路或 CDN。");
      return;
    }
    // 建立獨立的 Client
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (!roomCode) {
      showError("請在網址後方輸入 ?room=房間代碼");
      if(mainEl) mainEl.style.display = "none";
      return;
    }
    if(roomCodeEl) roomCodeEl.textContent = roomCode;

    let isFetching = false;
    let pollTimer = null;
    let realtimeChannel = null;
    let lastRoomId = null;
    let lastMap = null;
    let lastSeed = null;
    let lastMapSize = null;

    async function fetchAndRender() {
      if (isFetching) return;
      isFetching = true;
      try {
        // 1. 抓房間
        const { data: room, error: roomError } = await supabaseClient
          .from("rooms").select("*").eq("code", roomCode).maybeSingle();

        if (roomError || !room) {
          showError(roomError ? "讀取錯誤" : "找不到房間：" + roomCode);
          isFetching = false;
          return;
        }

        // 2. 抓玩家
        const { data: players, error: playersError } = await supabaseClient
          .from("players").select("*").eq("room_id", room.id);

        if (playersError) {
          isFetching = false; return;
        }

        const playerA = players?.find(p => p.role === "A");
        const playerB = players?.find(p => p.role === "B");

        const seed = room.seed || "default";
        const mapSize = room.map_size || 25;

        // 生成地圖 (若變更)
        if (!lastMap || lastSeed !== seed || lastMapSize !== mapSize) {
          if (typeof window.generateMap === "function") {
            lastMap = window.generateMap(seed, mapSize);
            lastSeed = seed;
            lastMapSize = mapSize;
          }
        }

        // 確保 Realtime
        ensureRealtime(room.id);

        // 計算目標
        let destX = room.goal_x, destY = room.goal_y;
        if (destX === undefined || destY === undefined || destX === null) {
          const g = computeGoal(seed, mapSize, room.id);
          destX = g.x; destY = g.y;
        }

        // 渲染畫面
        renderAll({
          room, seed, mapSize, map: lastMap,
          playerA, playerB, destX, destY
        });
        showError(""); // 清除錯誤

      } catch(e) {
        console.error(e);
        showError("發生未預期錯誤");
      } finally {
        isFetching = false;
      }
    }

    function ensureRealtime(roomId) {
      const channelName = REALTIME_CHANNEL_PREFIX + roomId;
      if (realtimeChannel) return; // 已訂閱

      realtimeChannel = supabaseClient.channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, 
          () => fetchAndRender())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, 
          () => fetchAndRender())
        .subscribe();
      logDebug("Realtime 訂閱成功", channelName);
    }

    function renderAll(state) {
      const { seed, mapSize, map, playerA, playerB, destX, destY } = state;
      
      const posA = getPlayerIntersection(playerA);
      const posB = getPlayerIntersection(playerB);

      // 更新文字狀態
      if(playerAStatusEl) playerAStatusEl.textContent = 
        posA.ix !== null ? `(${posA.ix}, ${posA.iy}) ${formatDirection(playerA.direction)}` : "未加入";
      if(playerBStatusEl) playerBStatusEl.textContent = 
        posB.ix !== null ? `(${posB.ix}, ${posB.iy}) ${formatDirection(playerB.direction)}` : "未加入";
      
      if(destinationStatusEl) {
        // 取得終點店名
        const destName = (typeof window.getShopName === "function") 
          ? window.getShopName(seed, destX, destY) : `(${destX}, ${destY})`;
        destinationStatusEl.textContent = `${destName} (${destX}, ${destY})`;
      }

      // 更新視野列表
      const fovA = buildFovSet(playerA, mapSize);
      const fovB = buildFovSet(playerB, mapSize);
      updateShopList(playerAShopsEl, fovA, seed);
      updateShopList(playerBShopsEl, fovB, seed);

      // 繪製地圖
      renderMapGrid(state, fovA, fovB);
    }

    function updateShopList(el, fovSet, seed) {
      if(!el) return;
      el.innerHTML = "";
      if(fovSet.size === 0) {
        el.innerHTML = "<li>無視野</li>"; return;
      }
      const arr = Array.from(fovSet).slice(0, 4); // 最多顯示4個
      arr.forEach(coord => {
        const [x, y] = coord.split(',').map(Number);
        const name = window.getShopName ? window.getShopName(seed, x, y) : "???";
        const li = document.createElement("li");
        li.textContent = name;
        el.appendChild(li);
      });
    }

    function renderMapGrid(state, fovA, fovB) {
      const { mapSize, seed, map, destX, destY, playerA, playerB } = state;
      if (!mapGridEl) return;

      // 如果地圖大小變更，重繪 Grid
      // 簡單起見，每次都清空重繪 DOM 雖然效能較差但最穩
      mapGridEl.innerHTML = "";
      mapLabelLayerEl.innerHTML = "";
      playerLayerEl.innerHTML = "";

      // 設定 Grid Columns
      mapGridEl.style.gridTemplateColumns = `repeat(${mapSize}, 1fr)`;

      // 繪製格子
      for (let y = 0; y < mapSize; y++) {
        for (let x = 0; x < mapSize; x++) {
          const cell = document.createElement("div");
          cell.className = "map-cell";
          
          // 牆壁或道路
          const isWall = window.isWall ? window.isWall(map, x, y) : false;
          if (isWall) {
            cell.classList.add("map-cell--wall");
          } else {
            const cid = getClusterId(seed, x, y);
            cell.classList.add(`map-cell--cluster-${cid}`);
          }

          // 視野
          const key = x + "," + y;
          if (fovA.has(key) || fovB.has(key)) {
            cell.classList.add("map-cell--fov");
          }

          // 終點
          if (x === destX && y === destY) {
            cell.classList.add("map-cell--goal");
            cell.textContent = "★";
          }
          
          mapGridEl.appendChild(cell);
        }
      }

      // 繪製區域文字 (Cluster Labels)
      // 每 5x5 一個大標籤
      const blocks = Math.ceil(mapSize / CLUSTER_BLOCK_SIZE);
      for(let cy=0; cy<blocks; cy++){
        for(let cx=0; cx<blocks; cx++){
          const x0 = cx * CLUSTER_BLOCK_SIZE;
          const y0 = cy * CLUSTER_BLOCK_SIZE;
          if(x0 >= mapSize || y0 >= mapSize) continue;

          // 取得該區域名稱
          const labelText = getClusterTypeLabel(seed, x0, y0);
          if(!labelText) continue;

          // 計算位置百分比
          const w = Math.min(CLUSTER_BLOCK_SIZE, mapSize - x0);
          const h = Math.min(CLUSTER_BLOCK_SIZE, mapSize - y0);
          
          const label = document.createElement("div");
          label.className = "map-cluster-label";
          // 簡化：只取前兩個字當大標題 (例如 "銀樹")
          label.textContent = labelText.substring(0, 2); 
          
          label.style.left = (x0 / mapSize * 100) + "%";
          label.style.top = (y0 / mapSize * 100) + "%";
          label.style.width = (w / mapSize * 100) + "%";
          label.style.height = (h / mapSize * 100) + "%";
          
          mapLabelLayerEl.appendChild(label);
        }
      }

      // 繪製玩家 (Overlay)
      function drawPlayer(p, cls) {
        const { ix, iy } = getPlayerIntersection(p);
        if (ix === null) return;
        
        // 取得 map-grid 的實際大小來計算 pixel 位置會比較準確
        // 但這裡用百分比: ix 介於 0~mapSize
        // 格線是畫在 cell 之間。第 0 條線在最左。第 mapSize 條線在最右。
        // Grid 寬度 = mapSize * cellWidth
        // 交叉點 ix 對應的 left% = (ix / mapSize) * 100%
        
        const dot = document.createElement("div");
        dot.className = "player-dot " + cls;
        dot.style.left = (ix / mapSize * 100) + "%";
        dot.style.top = (iy / mapSize * 100) + "%";
        
        // 箭頭
        dot.textContent = arrowForDirection(p.direction);
        playerLayerEl.appendChild(dot);
      }

      drawPlayer(playerA, "player-dot-a");
      drawPlayer(playerB, "player-dot-b");
    }

    // 啟動
    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, POLL_INTERVAL_MS);
  });
})();
