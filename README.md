# 迷路城市｜Lost City Game

兩位玩家在同一個虛構城市迷路，只能透過電話溝通「前面左邊右邊見到的店舖」，最後嘗試找到對方。

本 repo 提供：
- 玩家端：`index.html`
- 觀眾端大地圖：`viewer.html`

資料庫與即時同步使用 Supabase。

---

## 1. 必要條件

1. 已建立 Supabase 專案。
2. 在 Supabase 建好以下資料表（Postgres）：

```sql
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  seed text not null,
  status text not null default 'waiting',
  map_size int not null default 25,
  created_at timestamptz default now()
);

alter table public.rooms
  add constraint rooms_map_size_check
  check (map_size in (10,25,50));

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null,
  role text not null,
  x integer not null,
  y integer not null,
  direction smallint not null,
  updated_at timestamptz default now()
);

alter table public.players
  add constraint players_unique_room_role
  unique (room_id, role);

alter table public.players
  add constraint players_direction_check
  check (direction between 0 and 3);
