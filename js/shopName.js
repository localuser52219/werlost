// js/shopName.js
// 含 30 種店舖類型 + 各自的 Emoji

const PREFIX_LIST = [
  '大家樂','大快活','翠華','太興','譚仔','三哥','麥當當','KFC','吉野家','壽司郎',
  '百佳','惠康','萬寧','屈臣氏','7-Eleven','OK便利','日本城','實惠','Donki','759',
  '豐澤','百老匯','蘇寧','莎莎','卓悅','奇華','美心','東海堂','聖安娜','馬會'
];

// 各種類加入 emoji（強烈建議）
const TYPE_LIST = [
  '咖啡☕','麵包🥐','藥房💊','便利🛒','診所⚕️','書店📘','文具✏️','花店🌸','茶館🍵','冰室🧊',
  '餐室🍱','早餐🥚','超市🏪','百貨🛍️','手機📱','服裝👗','玩具🧸','五金🔧','報攤📰','雜貨🧂',
  '水果🍎','麵舖🍜','點心🍡','甜品🍰','生活🧴','市集🎪','零食🍿','飲品🥤','湯品🍲','麵食🍝'
];

const SUFFIX_LIST = [
  '分店','旗艦店','特賣場','專門店','部','站','中心','天地','世界','總店',
  '坊','倉','屋','軒','館','閣','樓','室','座','匯',
  '角落','食堂','廚房','工坊','地帶','小築','車仔檔','辦館','士多','點'
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
window.generateMap = generateMap;
window.isWall = isWall;
window.hashToInt = hashToInt;
