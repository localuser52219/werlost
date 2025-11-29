// admin.js
// 房間控制台：建立 / 重設房間，並產生 Player / Viewer 連結

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("createResetBtn");
  btn.addEventListener("click", createOrResetRoom);
});

async function createOrResetRoom() {
  const codeInput = document.getElementById("roomCode");
  const mapSizeSelect = document.getElementById("mapSize");
  const seedInput = document.getElementById("seedInput");
  const statusEl = document.getElementById("status");
  const linksEl = document.getElementById("links");

  const code = codeInput.value.trim();
  const mapSize = parseInt(mapSizeSelect.value, 10);
  let seed = seedInput.value.trim();

  if (!code) {
    statusEl.textContent = "請輸入房間代碼";
    return;
  }

  statusEl.textContent = "處理中…";

  if (!seed) {
    seed = "seed-" + Math.random().toString(36).slice(2, 10);
  }

  try {
    // 1) 先查是否已有此房間
    const { data: existingRoom, error: roomErr } = await window._supabase
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (roomErr) {
      console.error(roomErr);
      statusEl.textContent = "讀取房間時出錯";
      return;
    }

    let room = null;

    if (existingRoom) {
      // 已存在 → 更新 seed / map_size / status
      const { data: updated, error: updErr } = await window._supabase
        .from("rooms")
        .update({
          seed: seed,
          map_size: mapSize,
          status: "waiting"
        })
        .eq("id", existingRoom.id)
        .select()
        .single();

      if (updErr) {
        console.error(updErr);
        statusEl.textContent = "更新房間失敗";
        return;
      }
      room = updated;
    } else {
      // 新房間 → 插入
      const { data: inserted, error: insErr } = await window._supabase
        .from("rooms")
        .insert({
          code: code,
          seed: seed,
          map_size: mapSize,
          status: "waiting"
        })
        .select()
        .single();

      if (insErr) {
        console.error(insErr);
        statusEl.textContent = "建立房間失敗";
        return;
      }
      room = inserted;
    }

    // 2) 重設玩家 A / B 座標與方向
    const startAX = 1;
    const startAY = 1;
    const startBX = mapSize - 2;
    const startBY = mapSize - 2;

    const { error: upErr } = await window._supabase
      .from("players")
      .upsert(
        [
          {
            room_id: room.id,
            name: "PlayerA",
            role: "A",
            x: startAX,
            y: startAY,
            direction: 0 // 北
          },
          {
            room_id: room.id,
            name: "PlayerB",
            role: "B",
            x: startBX,
            y: startBY,
            direction: 2 // 南
          }
        ],
        { onConflict: "room_id,role" }
      );

    if (upErr) {
      console.error(upErr);
      statusEl.textContent = "建立 / 更新玩家失敗";
      return;
    }

    statusEl.textContent =
      `房間 ${room.code} 已建立 / 重設完成 ｜ seed = ${room.seed} ｜ map = ${room.map_size}×${room.map_size}`;

    // 3) 產生 Player / Viewer 連結
    const origin = window.location.origin;
    const playerAUrl = origin + "/index.html?room=" + encodeURIComponent(code) + "&role=A";
    const playerBUrl = origin + "/index.html?room=" + encodeURIComponent(code) + "&role=B";
    const viewerUrl = origin + "/viewer.html?room=" + encodeURIComponent(code);

    linksEl.innerHTML = `
      <div>玩家 A：</div>
      <a href="${playerAUrl}" target="_blank">${playerAUrl}</a>
      <div>玩家 B：</div>
      <a href="${playerBUrl}" target="_blank">${playerBUrl}</a>
      <div>觀眾端 Viewer：</div>
      <a href="${viewerUrl}" target="_blank">${viewerUrl}</a>
    `;
  } catch (e) {
    console.error(e);
    statusEl.textContent = "未知錯誤";
  }
}
