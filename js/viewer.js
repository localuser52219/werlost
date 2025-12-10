// /js/viewer.js

(function () {
  // 讀取 URL 參數
  const params = new URLSearchParams(window.location.search);

  // 新版使用 ?room=，舊版可能還有 ?code=
  const roomFromRoom = params.get("room");
  const roomFromCode = params.get("code");

  // 優先使用 room，其次才是 code
  const roomCode = roomFromRoom || roomFromCode || "";

  // 取得畫面元素
  const errorEl = document.getElementById("viewer-error");
  const mainEl = document.getElementById("viewer-main");
  const roomCodeEl = document.getElementById("room-code");
  const playerAStatusEl = document.getElementById("player-a-status");
  const playerBStatusEl = document.getElementById("player-b-status");

  // 方便之後除錯用的簡單 log
  function logDebug(message, extra) {
    if (window.location.search.includes("debug=1")) {
      console.log("[viewer]", message, extra || "");
    }
  }

  // 沒有帶房間代碼時的處理
  if (!roomCode) {
    logDebug("No room code in URL");

    if (errorEl) {
      // 改用 ?room= 提示
      errorEl.textContent = "URL 缺少 ?room= 房間代碼";
    }

    if (mainEl) {
      // 隱藏主畫面，避免顯示空白狀態
      mainEl.style.display = "none";
    }

    return;
  }

  // 若只有 ?code= 而沒有 ?room=，自動把網址改寫成用 room（向後相容）
  if (roomFromCode && !roomFromRoom) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("room", roomFromCode);
      // 不會重新整理，只更新網址列
      window.history.replaceState(null, "", url.toString());
      logDebug("Replaced ?code= with ?room=", roomFromCode);
    } catch (err) {
      logDebug("Failed to replace URL params", err);
    }
  }

  // 有房間代碼時，清空錯誤訊息並顯示主畫面
  if (errorEl) {
    errorEl.textContent = "";
  }
  if (mainEl) {
    mainEl.style.display = "";
  }

  // 顯示房間代碼
  if (roomCodeEl) {
    roomCodeEl.textContent = roomCode;
  }

  // 更新頁面標題，方便舞台或投影辨識
  try {
    document.title = "迷路追蹤器 觀眾端 Viewer – 房間 " + roomCode;
  } catch (err) {
    logDebug("Failed to set document.title", err);
  }

  // 初始化玩家狀態文字（如果 HTML 裏還是空的話）
  if (playerAStatusEl && !playerAStatusEl.textContent.trim()) {
    playerAStatusEl.textContent = "尚未有玩家資料";
  }
  if (playerBStatusEl && !playerBStatusEl.textContent.trim()) {
    playerBStatusEl.textContent = "尚未有玩家資料";
  }

  // 之後如果你要接 Supabase 或其他即時資料來源，
  // 可以在這個位置開始加上連線與訂閱邏輯，
  // 例如根據 roomCode 去訂閱房間資料，
  // 然後更新 playerAStatusEl / playerBStatusEl 的內容。
})();
