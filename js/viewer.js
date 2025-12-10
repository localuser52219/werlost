// /js/viewer.js

(function () {
  // 方便開關除錯訊息：在網址加上 ?debug=1 即可在 console 看到 log
  function logDebug(message, extra) {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        console.log("[viewer]", message, extra || "");
      }
    } catch (err) {
      // 若 URLSearchParams 出錯，直接忽略除錯功能
    }
  }

  // DOM 準備好才開始操作
  document.addEventListener("DOMContentLoaded", function () {
    const params = new URLSearchParams(window.location.search);

    // 新版標準參數：?room=
    const roomFromRoom = params.get("room");
    // 舊版相容參數：?code=
    const roomFromCode = params.get("code");

    // 優先使用 room，其次才是 code
    const roomCode = roomFromRoom || roomFromCode || "";

    // 抓取視圖中的元素
    const errorEl = document.getElementById("viewer-error");
    const mainEl = document.getElementById("viewer-main");
    const roomCodeEl = document.getElementById("room-code");
    const playerAStatusEl = document.getElementById("player-a-status");
    const playerBStatusEl = document.getElementById("player-b-status");
    const destinationStatusEl = document.getElementById("destination-status");

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

    // 一開始先設定預設狀態（避免完全空白）
    ensureDefaultText();

    // 若沒有任何房間代碼，直接顯示錯誤並隱藏主畫面
    if (!roomCode) {
      logDebug("No room code in URL");
      showError("URL 缺少 ?room= 房間代碼");
      hideMain();
      return;
    }

    // 若使用的是舊版 ?code= 而無 ?room=，自動把網址改成 ?room=
    if (roomFromCode && !roomFromRoom) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("room", roomFromCode);
        // 不重新整理頁面，只改網址列，方便之後複製使用
        window.history.replaceState(null, "", url.toString());
        logDebug("Replaced ?code= with ?room=", roomFromCode);
      } catch (err) {
        logDebug("Failed to replace URL params", err);
      }
    }

    // 有房間代碼：清除錯誤訊息，顯示主畫面
    showError("");
    showMain();

    // 顯示房間代碼
    if (roomCodeEl) {
      roomCodeEl.textContent = roomCode;
    }

    // 更新頁面標題，方便投影端、控制端識別
    try {
      document.title = "迷路追蹤器 觀眾端 Viewer – 房間 " + roomCode;
    } catch (err) {
      logDebug("Failed to set document.title", err);
    }

    // 再確認一次預設文字（若 HTML 有改動或被清空）
    ensureDefaultText();

    // ===== 後續擴充入口 =====
    // 若你日後接 Supabase / Firebase / WebSocket / Polling：
    // 1. 以 roomCode 為 key 訂閱房間資料。
    // 2. 收到更新時，對下列元素改寫 textContent：
    //    - playerAStatusEl.textContent = "玩家 A 某某狀態";
    //    - playerBStatusEl.textContent = "玩家 B 某某狀態";
    //    - destinationStatusEl.textContent = "某某目的地";
    // 3. 若連線失敗，可呼叫 showError("某某錯誤訊息") 提示工作人員。
  });
})();
