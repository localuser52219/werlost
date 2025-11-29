// 店舖名稱詞庫
const PREFIX_LIST = [
  '亮星','銀樹','紅門','青潮','黃道','白羽','深空','微光','松竹','石橋',
  '日出','星河','紫光','雲頂','山城','港景','街角','海風','竹影','晴町',
  '木葉','霧峰','光輝','川流','新月','鐵街','雨巷','東南','北灣','西港'
];

const TYPE_LIST = [
  '咖啡','麵包','藥房','便利','診所','書店','文具','花店','茶館','冰室',
  '餐室','早餐','超市','百貨','手機','服裝','玩具','五金','報攤','雜貨',
  '水果','麵舖','點心','甜品','生活','市集','零食','飲品','湯品','麵食'
];

const SUFFIX_LIST = [
  '舖','店','館','小屋','工房','中心','堂','商號','之森','站',
  '坊','市場','部屋','街角','樓','倉','屋','軒','雜舖','基地',
  '廚房','工作室','集','社','巷','庭','街屋','園','港','棚'
];

// 字串轉整數 hash（用作所有決定的基礎）
function hashToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// 簡單 pseudo-random（根據 seed 決定，確保可重現）
function createRng(seedStr) {
  let state = hashToInt(seedStr);
  if (state === 0) state = 1;
  return function() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296; // [0,1)
  };
}

// 店舖名：帶「區域群聚」效果
function getShopName(seed, x, y) {
  const base = hashToInt(seed + ':' + x + ':' + y);

  // 前綴／後綴基本照舊
  const p = base % PREFIX_LIST.length;
  const s = Math.floor(base / 31) % SUFFIX_LIST.length;

  // 把地圖切成較大的 block，例如 5x5，一個 block 會有「主題店類」
  const blockSize = 5;
  const cx = Math.floor(x / blockSize);
  const cy = Math.floor(y / blockSize);

  const clusterHash = hashToInt(seed + ':cluster:' + cx + ':' + cy);
  const dominantTypeIndex = clusterHash % TYPE_LIST.length;

  // 70% 機率採用此區域主題；30% 隨機另一種，避免完全一樣
  const rand = Math.floor(base / (31 * 31)) % 100;
  let typeIndex;
  if (rand < 70) {
    typeIndex = dominantTypeIndex;
  } else {
    // 選一個不同於 dominant 的 type
    const offset = 1 + (clusterHash % (TYPE_LIST.length - 1));
    typeIndex = (dominantTypeIndex + offset) % TYPE_LIST.length;
  }

  return PREFIX_LIST[p] + TYPE_LIST[typeIndex] + SUFFIX_LIST[s];
}

// 生成地圖：road / wall
// 結果為 MapGrid: map[y][x] = { type: 'road' | 'wall' }
function generateMap(seed, size) {
  const map = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      row.push({ type: 'road' });
    }
    map.push(row);
  }

  // 用 seed 生成少量短牆
  const rng = createRng(seed + ':walls');
  const maxSegments = Math.floor(size * 1.5); // 例如 10x10 約 15 段，25x25 約 37 段

  for (let i = 0; i < maxSegments; i++) {
    const length = 2 + Math.floor(rng() * 3); // 牆長 2~4 格
    const horizontal = rng() < 0.5;
    const startX = Math.floor(rng() * size);
    const startY = Math.floor(rng() * size);

    for (let step = 0; step < length; step++) {
      const x = startX + (horizontal ? step : 0);
      const y = startY + (horizontal ? 0 : step);
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      map[y][x].type = 'wall';
    }
  }

  return map;
}

// 工具：判斷某格是否牆（超出地圖一律視為牆／不可通行）
function isWall(map, x, y) {
  if (!map || map.length === 0) return true;
  const sizeY = map.length;
  const sizeX = map[0].length;
  if (x < 0 || x >= sizeX || y < 0 || y >= sizeY) return true;
  return map[y][x].type === 'wall';
}

// 暴露給其他檔案使用
window.getShopName = getShopName;
window.generateMap = generateMap;
window.isWall = isWall;
window.hashToInt = hashToInt; // 如有需要可用
