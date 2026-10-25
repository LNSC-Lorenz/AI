const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  const htmlPath = path.join(__dirname, 'jira.html');
  const outPath = path.resolve(__dirname, '..', 'Jira-Usage.pdf');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 500));
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    width: '210mm',
    height: '297mm',
    preferCSSPageSize: true,
  });
  await browser.close();
  console.log('PDF written to:', outPath);
})().catch((e) => { console.error(e); process.exit(1); });
