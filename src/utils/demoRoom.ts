/**
 * SENTRA Demonstration Room Generator
 * Creates an authentic indoor visual environment for testing, simulation,
 * and environments where browser webcam permission is restricted or unavailable.
 */

export function generateDemoRoomDataUrl(panOffset = 0): string {
  const width = 960;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const ox = panOffset;

  // 1. Background Wall (Warm contemporary greige)
  const wallGrad = ctx.createLinearGradient(0, 0, 0, height * 0.65);
  wallGrad.addColorStop(0, '#e5e7eb');
  wallGrad.addColorStop(1, '#d1d5db');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, width, height * 0.65);

  // Baseboard
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(0, height * 0.64, width, height * 0.02);

  // 2. Flooring (Warm hardwood parquet with perspective vanishing lines)
  const floorGrad = ctx.createLinearGradient(0, height * 0.65, 0, height);
  floorGrad.addColorStop(0, '#a16207');
  floorGrad.addColorStop(1, '#713f12');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, height * 0.65, width, height * 0.35);

  // Floor plank perspective lines
  ctx.strokeStyle = 'rgba(67, 36, 6, 0.4)';
  ctx.lineWidth = 2;
  for (let x = -width; x < width * 2; x += 90) {
    ctx.beginPath();
    ctx.moveTo(width / 2 + ox * 0.5, height * 0.65);
    ctx.lineTo(x + ox, height);
    ctx.stroke();
  }

  // 3. Open Doorway (Right side, clear pathway)
  const doorX = 660 + ox;
  const doorY = 120;
  const doorW = 210;
  const doorH = height * 0.65 - 120;

  // Door frame
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(doorX - 10, doorY - 10, doorW + 20, doorH + 10);

  // Inner illuminated hallway
  const hallGrad = ctx.createLinearGradient(doorX, doorY, doorX + doorW, doorY + doorH);
  hallGrad.addColorStop(0, '#fef3c7');
  hallGrad.addColorStop(1, '#fde68a');
  ctx.fillStyle = hallGrad;
  ctx.fillRect(doorX, doorY, doorW, doorH);

  // Doorway floor transition line
  ctx.fillStyle = '#d97706';
  ctx.fillRect(doorX, height * 0.64, doorW, 8);

  // 4. Study Desk / Table (Center-left)
  const tableX = 140 + ox;
  const tableY = 380;
  const tableW = 460;
  const tableH = 190;

  // Table Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(tableX + tableW / 2, height * 0.65 + 150, tableW * 0.52, 28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Table Legs
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(tableX + 25, tableY + 50, 14, 210);
  ctx.fillRect(tableX + tableW - 39, tableY + 50, 14, 210);
  ctx.fillRect(tableX + 70, tableY + 30, 12, 190);
  ctx.fillRect(tableX + tableW - 82, tableY + 30, 12, 190);

  // Table Top (Rich Walnut Wood Grain)
  const tableGrad = ctx.createLinearGradient(tableX, tableY, tableX + tableW, tableY + 50);
  tableGrad.addColorStop(0, '#854d0e');
  tableGrad.addColorStop(0.5, '#a16207');
  tableGrad.addColorStop(1, '#713f12');
  ctx.fillStyle = tableGrad;
  ctx.beginPath();
  ctx.roundRect(tableX, tableY, tableW, 46, 8);
  ctx.fill();

  // 5. Blue Insulated Water Bottle on the desk (Key Target)
  const bottleX = tableX + 230;
  const bottleY = tableY - 120;
  const bottleW = 38;
  const bottleH = 124;

  // Bottle shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(bottleX + bottleW / 2, tableY + 12, 22, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bottle body
  const bottleGrad = ctx.createLinearGradient(bottleX, bottleY, bottleX + bottleW, bottleY);
  bottleGrad.addColorStop(0, '#0284c7');
  bottleGrad.addColorStop(0.3, '#38bdf8');
  bottleGrad.addColorStop(0.8, '#0369a1');
  bottleGrad.addColorStop(1, '#075985');
  ctx.fillStyle = bottleGrad;
  ctx.beginPath();
  ctx.roundRect(bottleX, bottleY + 22, bottleW, bottleH - 22, [4, 4, 10, 10]);
  ctx.fill();

  // Bottle Cap / Lid
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(bottleX + 4, bottleY, bottleW - 8, 22, [6, 6, 2, 2]);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(bottleX + 8, bottleY + 14, bottleW - 16, 4);

  // 6. Spectacles / Reading Glasses on Table
  const specX = tableX + 110;
  const specY = tableY + 8;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3.5;

  // Left frame
  ctx.beginPath();
  ctx.arc(specX, specY, 13, 0, Math.PI * 2);
  ctx.stroke();

  // Right frame
  ctx.beginPath();
  ctx.arc(specX + 34, specY, 13, 0, Math.PI * 2);
  ctx.stroke();

  // Bridge
  ctx.beginPath();
  ctx.moveTo(specX + 13, specY);
  ctx.lineTo(specX + 21, specY);
  ctx.stroke();

  // Temples / Arms
  ctx.beginPath();
  ctx.moveTo(specX - 13, specY);
  ctx.lineTo(specX - 25, specY - 8);
  ctx.moveTo(specX + 47, specY);
  ctx.lineTo(specX + 59, specY - 8);
  ctx.stroke();

  // 7. Office Chair (Left side)
  const chairX = 40 + ox;
  const chairY = 320;

  // Chair Back
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(chairX, chairY, 90, 130, 16);
  ctx.fill();

  // Chair Seat
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(chairX - 10, chairY + 130, 110, 32, 10);
  ctx.fill();

  // Chair Pole & Base
  ctx.fillStyle = '#64748b';
  ctx.fillRect(chairX + 40, chairY + 162, 12, 130);
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(chairX + 46, chairY + 295, 36, 0, Math.PI);
  ctx.fill();

  // 8. Watermark badge indicator
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.beginPath();
  ctx.roundRect(16, 16, 210, 36, 10);
  ctx.fill();

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px "Atkinson Hyperlegible", sans-serif';
  ctx.fillText('SENTRA Simulation Room', 28, 39);

  return canvas.toDataURL('image/jpeg', 0.88);
}
