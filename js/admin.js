<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>迷路城市｜房間控制台</title>
  <style>
    body{font-family:sans-serif;padding:20px;margin:0;background:#f5f5f5;}
    h1{margin:0 0 10px;font-size:22px;}
    .box{border:1px solid #ccc;background:#fff;padding:10px;margin-top:10px;box-sizing:border-box;}
    label{display:block;font-size:14px;margin:4px 0;}
    input,select{padding:4px 6px;font-size:14px;}
    button{margin:6px 0;padding:6px 14px;font-size:14px;cursor:pointer;}
    #status{font-size:13px;color:#555;margin-top:4px;white-space:pre-line;}
    .links a{display:block;font-size:12px;word-break:break-all;margin:2px 0;}
    .small{font-size:12px;color:#666;}
  </style>
</head>
<body>
  <h1>迷路城市｜房間控制台</h1>

  <div class="box">
    <h2 style="margin:0 0 6px;font-size:16px;">建立 / 重設房間</h2>

    <label>
      房間代碼（例如 TEST01）：
      <input id="roomCode"/>
    </label>

    <label>
      地圖大小：
      <select id="mapSize">
        <option value="10">10 × 10（牆較少）</option>
        <option value="25" selected>25 × 25</option>
        <option value="50">50 × 50</option>
      </select>
    </label>

    <label>
      地圖種子 seed（可留空自動生成；10×10 建議固定 seed 方便重現）：
      <input id="seedInput"/>
    </label>

    <p class="small">
      系統會依以下步驟自動處理：<br/>
      1. 根據地圖大小生成牆壁（10×10 牆較少）。<br/>
      2. 在可行走格中隨機選擇玩家 A / B 起點。<br/>
      3. 以 BFS 檢查 A / B 是否有路可通，若沒有會重新生成。<br/>
      4. 只在確認可互通後才建立 / 重設房間。
    </p>

    <button id="createResetBtn">建立 / 重設房間</button>
    <div id="status"></div>
  </div>

  <div class="box">
    <h2 style="margin:0 0 6px;font-size:16px;">快速進入連結</h2>
    <div id="links" class="links small">
      尚未建立房間。
    </div>
  </div>

  <div class="box small">
    <p>其他頁面直接網址：</p>
    <ul>
      <li>玩家端：<code>/index.html</code></li>
      <li>觀眾端：<code>/viewer.html</code></li>
    </ul>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="js/supabaseClient.js"></script>
  <script src="js/shopName.js"></script>
  <script src="js/admin.js"></script>
</body>
</html>
