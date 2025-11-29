// 店舖名稱詞庫（可之後再擴充）
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

// 將字串轉為整數 hash
function hashToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// 以 seed + (x,y) 產生穩定店舖名
function getShopName(seed, x, y) {
  const base = hashToInt(seed + ':' + x + ':' + y);

  const p = base % PREFIX_LIST.length;
  const t = Math.floor(base / 31) % TYPE_LIST.length;
  const s = Math.floor(base / (31 * 31)) % SUFFIX_LIST.length;

  return PREFIX_LIST[p] + TYPE_LIST[t] + SUFFIX_LIST[s];
}

// 暴露給其他檔案使用
window.getShopName = getShopName;
