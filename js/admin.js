// js/admin.js（含清除資料功能）

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("createResetBtn").addEventListener("click", createOrResetRoom);
  document.getElementById("clearAllBtn").addEventListener("click", clearAllData);
});

// 刪除全部資料（rooms + players）
async function clearAllData() {
  const yes = confirm("⚠️ 你確定要清除所有房間與玩家資料嗎？\n此動作不可回復！");
  if (!yes) return;

  const statusEl = document.getElementById("status");
  statusEl.textContent = "刪除中…";

  try {
    // 先刪 players，再刪 rooms（避免外鍵失敗）
    await window._supabase.from("players").delete().neq("id", 0);
    await window._supabase.from("rooms").delete().neq("id", 0);

    statusEl.textContent = "已清除所有記錄（rooms + players）。";
    document.getElementById("links").innerHTML = "尚未建立房間。";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "刪除資料時出現錯誤。";
  }
}
