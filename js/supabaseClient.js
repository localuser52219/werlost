// js/supabaseClient.js
// 負責建立全域 Supabase client：window._supabase

// 你的 Supabase 專案資訊（照你提供的）
const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

// 用 CDN 版 supabase-js 時，createClient 會掛在 window.supabase
// 你目前已在 index.html / viewer / admin 引入 supabase-js（如未引入，需在 HTML 加 <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>）

(function initSupabaseClient() {
  try {
    if (!window.supabase || !window.supabase.createClient) {
      console.error("supabase-js 未載入：請確認 HTML 有引入 CDN 腳本。");
      return;
    }
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window._supabase = client;
    console.log("Supabase client 初始化完成");
  } catch (err) {
    console.error("初始化 Supabase client 失敗", err);
  }
})();
