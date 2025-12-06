// 玩家 marker：畫在「交叉點」上，與前方 2×2 視野對應
function drawPlayerMarker(ctx, p, n, cell) {
  const pos = getPlayerPos(p);
  const px = pos.x;
  const py = pos.y;

  // 交叉點座標（用交叉點索引 0..n-1）
  if (px < 0 || px >= n || py < 0 || py >= n) return;

  let color = "gray";
  if (p.role === "A") color = "red";
  else if (p.role === "B") color = "blue";

  // 交叉點在格線交叉位置，不在格子中心
  const nodeX = px * cell;
  const nodeY = py * cell;
  const radius = cell * 0.3;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(nodeX, nodeY, radius, 0, Math.PI * 2);
  ctx.fill();

  const dirVec = [
    { dx: 0, dy: -1 }, // 北
    { dx: 1, dy: 0 },  // 東
    { dx: 0, dy: 1 },  // 南
    { dx: -1, dy: 0 }  // 西
  ];
  const forward = dirVec[p.direction] || dirVec[0];

  const arrowLen = cell * 0.5;
  const tipX = nodeX + forward.dx * arrowLen;
  const tipY = nodeY + forward.dy * arrowLen;

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nodeX, nodeY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}
