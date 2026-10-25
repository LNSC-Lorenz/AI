const path = require('path');
const puppeteer = require('puppeteer');

const [, , input, output] = process.argv;
const inPath = path.resolve(input);
const outPath = output ? path.resolve(output) : inPath.replace(/\.[^.]+$/, '') + '.pdf';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.goto('file:///' + inPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
  });
  await browser.close();
  console.log('PDF written to:', outPath);
})().catch((e) => { console.error(e); process.exit(1); });
