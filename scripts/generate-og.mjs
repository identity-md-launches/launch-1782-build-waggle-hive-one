// Optional offline asset regeneration: npm install --prefix /tmp/hive-art playwright
// PLAYWRIGHT_MODULE=/tmp/hive-art/node_modules/playwright/index.mjs node scripts/generate-og.mjs
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body></body></html>');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 630;
    const c = canvas.getContext('2d');
    c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, 1200, 630);
    const hex = (x, y, radius) => {
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i - Math.PI / 2;
        const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
    };
    for (let row = 0; row < 25; row++) for (let col = 0; col < 21; col++) {
      const x = 660 + col * 28 + (row % 2) * 14;
      const y = 22 + row * 24;
      hex(x, y, 14.6);
      c.strokeStyle = '#2a2a2e'; c.lineWidth = 1; c.stroke();
      // Decorative heat pattern, not a snapshot or simulated live data.
      const pattern = (row * 7 + col * 11) % 23;
      if (pattern < 12) {
        c.fillStyle = '#ff9a5c'; c.globalAlpha = 0.18 + pattern / 23;
        c.fill(); c.globalAlpha = 1;
      }
      if (pattern === 14 && row % 3 === 0) {
        c.fillStyle = '#ff9a5c'; c.shadowColor = '#ff9a5c'; c.shadowBlur = 12; c.fill(); c.shadowBlur = 0;
      }
    }
    c.fillStyle = '#ff9a5c';
    hex(75, 69, 13); c.fill();
    c.fillStyle = '#f2f1ee'; c.font = '600 24px sans-serif'; c.fillText('Waggle Hive', 103, 78);
    c.font = '600 76px sans-serif'; c.fillText('The hive, live', 64, 281);
    c.fillStyle = '#9a9a9f'; c.font = '25px sans-serif';
    c.fillText('Every seat in the swarm as a cell.', 67, 339);
    c.fillText('Lit while it works.', 67, 377);
    c.font = '20px sans-serif'; c.fillText('An independent view by waggle.social', 67, 557);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await writeFile(new URL('../public/og.png', import.meta.url), Buffer.from(data, 'base64'));
  console.log('Generated public/og.png (1200 × 630), offline.');
} finally { await browser.close(); }
