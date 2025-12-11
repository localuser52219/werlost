// js/shopName.js
// 含 30 種店舖類型 + 各自的 Emoji

const PREFIX_LIST = [
  '亮星','銀樹','紅門','青潮','黃道','白羽','深空','微光','松竹','石橋',
  '日出','星河','紫光','雲頂','山城','港景','街角','海風','竹影','晴町',
  '木葉','霧峰','光輝','川流','新月','鐵街','雨巷','東南','北灣','西港'
];

// 各種類加入 emoji（強烈建議）
const TYPE_LIST = [
  '咖啡☕','麵包🥐','藥房💊','便利🛒','診所⚕️','書店📘','文具✏️','花店🌸','茶館🍵','冰室🧊',
  '餐室🍱','早餐🥚','超市🏪','百貨🛍️','手機📱','服裝👗','玩具🧸','五金🔧','報攤📰','雜貨🧂',
  '水果🍎','麵舖🍜','點心🍡','甜品🍰','生活🧴','市集🎪','零食🍿','飲品🥤','湯品🍲','麵食🍝'
];

const SUFFIX_LIST = [
  '舖','店','館','小屋','工房','中心','堂','商號','之森','站',
  '坊','市場','部屋','街角','樓','倉','屋','軒','雜舖','基地',
  '廚房','工作室','集','社','巷','庭','街屋','園','港','棚'
];

function hashToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function createRng(seedStr) {
  let state = hashToInt(seedStr);
  if (state === 0) state = 1;
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// 群聚生成 + emoji 店名
function getShopName(seed, x, y) {
  const base = hashToInt(seed + ':' + x + ':' + y);

  const p = base % PREFIX_LIST.length;
  const s = Math.floor(base / 31) % SUFFIX_LIST.length;

  const block = 5; // 建議不變
  const cx = Math.floor(x / block);
  const cy = Math.floor(y / block);
  const groupSeed = hashToInt(seed + ':cluster:' + cx + ':' + cy);
  const dominant = groupSeed % TYPE_LIST.length;

  const r = Math.floor(base / (31 * 31)) % 100;

  let idx;
  if (r < 70) idx = dominant;
  else idx = (dominant + 1 + (groupSeed % (TYPE_LIST.length - 1))) % TYPE_LIST.length;

  return PREFIX_LIST[p] + TYPE_LIST[idx] + SUFFIX_LIST[s];
}

function getShopTypeName(seed, x, y) {
  const block = 5;
  const cx = Math.floor(x / block);
  const cy = Math.floor(y / block);
  const groupSeed = hashToInt(seed + ':cluster:' + cx + ':' + cy);
  const dominant = groupSeed % TYPE_LIST.length;
  return TYPE_LIST[dominant];
}

// 軟牆生成與無封死迷宮
function generateMap(seed, size) {
  const map = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'road' }))
  );

  const rng = createRng(seed + ':wall');
  const wallRatio = size === 10 ? 0.035 : size === 25 ? 0.06 : 0.08;
  const total = size * size;
  const segments = Math.max(1, Math.floor(total * wallRatio / 3));

  for (let i = 0; i < segments; i++) {
    const horizontal = rng() < 0.5;
    const len = 2 + Math.floor(rng() * 3);
    const sx = Math.floor(rng() * size);
    const sy = Math.floor(rng() * size);
    for (let k = 0; k < len; k++) {
      const x = sx + (horizontal ? k : 0);
      const y = sy + (horizontal ? 0 : k);
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      map[y][x].type = 'wall';
    }
  }

  return map;
}

function isWall(map, x, y) {
  if (!map || !map[0]) return true;
  const H = map.length;
  const W = map[0].length;
  if (x < 0 || x >= W || y < 0 || y >= H) return true;
  return map[y][x].type === 'wall';
}

window.getShopName = getShopName;
window.getShopTypeName = getShopTypeName;
window.generateMap = generateMap;
window.isWall = isWall;
window.hashToInt = hashToInt;
