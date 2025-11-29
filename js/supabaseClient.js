// Supabase 連線設定
// 注意：anon key 必須用你在 Supabase 介面「Rotate」後的最新 key

const SUPABASE_URL = "https://njrsyuluozjgxgucleci.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qcnN5dWx1b3pqZ3hndWNsZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDQ3OTEsImV4cCI6MjA3ODY4MDc5MX0.Y7tGY-s6iNdSq7D46sf4dVJh6qKDuTYrXWgX-NJGG_4";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Supabase URL 或 KEY 未設定");
}

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 暴露在 global，讓其他檔案可用
window._supabase = _supabase;
