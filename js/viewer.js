// js/viewer.js
// 迷路追蹤器 觀眾端 Viewer（修正版：正方格/正確分類/視野修正）

(function () {
  const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

  let supabaseClient = null;

  const CLUSTER_BLOCK_SIZE = 5;
  const POLL_INTERVAL_MS = 2000;
  const REALTIME_CHANNEL_PREFIX = "viewer_room_";

  // 從 shopName.js 複製來的類型列表，用於正確分類群集
  const TYPE_LIST = [
    '咖啡☕','麵包🥐','藥房💊','便利🛒','診所⚕️','書店📘','文具✏️','花店🌸','茶館🍵','冰室🧊',
    '餐室🍱','早餐🥚','超市🏪','百貨🛍️','手機📱','服裝👗','玩具🧸','五金🔧','報攤📰','雜貨🧂',
    '水果🍎','麵舖🍜','點心🍡','甜品🍰','生活🧴','市集🎪','零食🍿','飲品🥤','湯品🍲','麵食🍝'
  ];

  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (_) {}
  }

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

  // 計算群集顏色 ID (0-5)
  function getClusterId(seed, x, y) {
    const block = CLUSTER_BLOCK_SIZE;
    const cx = Math.floor(x / block);
    const cy = Math.floor(y / block);
    const g = hashToIntSafe(seed + ":cluster:" + cx + ":" + cy);
    return g % 6; 
  }

  // 取得群集的主要商店類型名稱 (修正：直接計算 Dominant Type)
  function getClusterTypeLabel(seed, x, y) {
    const block = CLUSTER_BLOCK_SIZE;
    const cx = Math.floor(x / block);
    const cy = Math.floor(y / block);
    
    // 計算該群集的種子
    const groupSeed = hashToIntSafe(seed + ':cluster:' + cx + ':' + cy);
    // 取餘數得到 dominant index
    const dominantIndex = groupSeed % TYPE_LIST.length;
    
    return TYPE_LIST[dominantIndex];
  }

  function computeGoal(seed, mapSize, roomId) {
    const baseSeed = seed || String(roomId) || "default-seed";
    const h = hashToIntSafe(baseSeed + ":goal");
    const x = h % mapSize;
    const y = Math.floor(h / mapSize) % mapSize;
    return { x, y };
  }

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
    // 修正：針對 dir=1 (東) 的偏移量修正
    // 0=北 (上方兩格)
    // 1=東 (右方兩格) -> 修正為 ix, iy (近) 與 ix+1, iy (遠)
    // 2=南 (下方兩格)
    // 3=西 (左方兩格)

    if (dir === 0) { // 北
      offsets.push({dx:-1, dy:-1}, {dx:0, dy:-1}, {dx:-1, dy:-2}, {dx:0, dy:-2});
    } else if (dir === 1) { // 東
      // 修正：原本可能是 ix+1 開始，現在改為從 ix 開始，與 player.js 邏輯一致
      // Near: (ix, iy-1), (ix, iy) -> dx=0
      // Far:  (ix+1, iy-1), (ix+1, iy) -> dx=1
      offsets.push({dx:0, dy:-1}, {dx:0, dy:0}, {dx:1, dy:-1}, {dx:1, dy:0});
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

    if (!window.supabase) {
      showError("Supabase library 未載入，請檢查網路或 CDN。");
      return;
    }
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
    let lastMap = null;
    let lastSeed = null;
    let lastMapSize = null;

    async function fetchAndRender() {
      if (isFetching) return;
      isFetching = true;
      try {
        const { data: room, error: roomError } = await supabaseClient
          .from("rooms").select("*").eq("code", roomCode).maybeSingle();

        if (roomError || !room) {
          showError(roomError ? "讀取錯誤" : "找不到房間：" + roomCode);
          isFetching = false;
          return;
        }

        const { data: players, error: playersError } = await supabaseClient
          .from("players").select("*").eq("room_id", room.id);

        if (playersError) {
          isFetching = false; return;
        }

        const playerA = players?.find(p => p.role === "A");
        const playerB = players?.find(p => p.role === "B");

        const seed = room.seed || "default";
        const mapSize = room.map_size || 25;

        if (!lastMap || lastSeed !== seed || lastMapSize !== mapSize) {
          if (typeof window.generateMap === "function") {
            lastMap = window.generateMap(seed, mapSize);
            lastSeed = seed;
            lastMapSize = mapSize;
          }
        }

        ensureRealtime(room.id);

        let destX = room.goal_x, destY = room.goal_y;
        if (destX === undefined || destY === undefined || destX === null) {
          const g = computeGoal(seed, mapSize, room.id);
          destX = g.x; destY = g.y;
        }

        renderAll({
          room, seed, mapSize, map: lastMap,
          playerA, playerB, destX, destY
        });
        showError("");

      } catch(e) {
        console.error(e);
        showError("發生未預期錯誤");
      } finally {
        isFetching = false;
      }
    }

    function ensureRealtime(roomId) {
      const channelName = REALTIME_CHANNEL_PREFIX + roomId;
      if (realtimeChannel) return;

      realtimeChannel = supabaseClient.channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, 
          () => fetchAndRender())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, 
          () => fetchAndRender())
        .subscribe();
    }

    function renderAll(state) {
      const { seed, mapSize, map, playerA, playerB, destX, destY } = state;
      
      const posA = getPlayerIntersection(playerA);
      const posB = getPlayerIntersection(playerB);

      if(playerAStatusEl) playerAStatusEl.textContent = 
        posA.ix !== null ? `(${posA.ix}, ${posA.iy}) ${formatDirection(playerA.direction)}` : "未加入";
      if(playerBStatusEl) playerBStatusEl.textContent = 
        posB.ix !== null ? `(${posB.ix}, ${posB.iy}) ${formatDirection(playerB.direction)}` : "未加入";
      
      if(destinationStatusEl) {
        const destName = (typeof window.getShopName === "function") 
          ? window.getShopName(seed, destX, destY) : `(${destX}, ${destY})`;
        destinationStatusEl.textContent = `${destName} (${destX}, ${destY})`;
      }

      const fovA = buildFovSet(playerA, mapSize);
      const fovB = buildFovSet(playerB, mapSize);
      updateShopList(playerAShopsEl, fovA, seed);
      updateShopList(playerBShopsEl, fovB, seed);

      renderMapGrid(state, fovA, fovB);
    }

    function updateShopList(el, fovSet, seed) {
      if(!el) return;
      el.innerHTML = "";
      if(fovSet.size === 0) {
        el.innerHTML = "<li>無視野</li>"; return;
      }
      const arr = Array.from(fovSet).slice(0, 4);
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

      mapGridEl.innerHTML = "";
      mapLabelLayerEl.innerHTML = "";
      playerLayerEl.innerHTML = "";

      mapGridEl.style.gridTemplateColumns = `repeat(${mapSize}, 1fr)`;

      for (let y = 0; y < mapSize; y++) {
        for (let x = 0; x < mapSize; x++) {
          const cell = document.createElement("div");
          cell.className = "map-cell";
          
          const isWall = window.isWall ? window.isWall(map, x, y) : false;
          if (isWall) {
            cell.classList.add("map-cell--wall");
          } else {
            const cid = getClusterId(seed, x, y);
            cell.classList.add(`map-cell--cluster-${cid}`);
          }

          const key = x + "," + y;
          if (fovA.has(key) || fovB.has(key)) {
            cell.classList.add("map-cell--fov");
          }

          if (x === destX && y === destY) {
            cell.classList.add("map-cell--goal");
            // 移除星星，只保留背景色
          }
          
          mapGridEl.appendChild(cell);
        }
      }

      const blocks = Math.ceil(mapSize / CLUSTER_BLOCK_SIZE);
      for(let cy=0; cy<blocks; cy++){
        for(let cx=0; cx<blocks; cx++){
          const x0 = cx * CLUSTER_BLOCK_SIZE;
          const y0 = cy * CLUSTER_BLOCK_SIZE;
          if(x0 >= mapSize || y0 >= mapSize) continue;

          // 使用新的邏輯取得「文具」、「食物」等類型
          const labelText = getClusterTypeLabel(seed, x0, y0);
          if(!labelText) continue;

          const w = Math.min(CLUSTER_BLOCK_SIZE, mapSize - x0);
          const h = Math.min(CLUSTER_BLOCK_SIZE, mapSize - y0);
          
          const label = document.createElement("div");
          label.className = "map-cluster-label";
          // 顯示完整類型文字（包含 Emoji），如 "文具✏️"
          label.textContent = labelText; 
          
          label.style.left = (x0 / mapSize * 100) + "%";
          label.style.top = (y0 / mapSize * 100) + "%";
          label.style.width = (w / mapSize * 100) + "%";
          label.style.height = (h / mapSize * 100) + "%";
          
          mapLabelLayerEl.appendChild(label);
        }
      }

      function drawPlayer(p, cls) {
        const { ix, iy } = getPlayerIntersection(p);
        if (ix === null) return;
        
        const dot = document.createElement("div");
        dot.className = "player-dot " + cls;
        dot.style.left = (ix / mapSize * 100) + "%";
        dot.style.top = (iy / mapSize * 100) + "%";
        
        dot.textContent = arrowForDirection(p.direction);
        playerLayerEl.appendChild(dot);
      }

      drawPlayer(playerA, "player-dot-a");
      drawPlayer(playerB, "player-dot-b");
    }

    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, POLL_INTERVAL_MS);
  });
})();
