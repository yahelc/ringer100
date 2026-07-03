const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors',
    ]
  });
  const page = await browser.newPage();

  const apiCalls = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('json')) {
      try {
        const body = await response.text();
        apiCalls.push({ url, status: response.status(), bodyLen: body.length, body: body.substring(0, 5000) });
      } catch(e) {}
    }
  });

  await page.goto('https://nbarankings.theringer.com/rankings', { waitUntil: 'networkidle', timeout: 45000 });

  console.log('=== JSON API CALLS FOUND ===');
  for (const call of apiCalls) {
    console.log(`\nURL: ${call.url}`);
    console.log(`Status: ${call.status} | Body length: ${call.bodyLen}`);
    console.log(`Body preview: ${call.body}`);
    console.log('---');
  }

  const title = await page.title();
  console.log('\n=== PAGE TITLE ===');
  console.log(title);

  const content = await page.evaluate(() => document.body.innerText);
  console.log('\n=== PAGE TEXT (first 5000 chars) ===');
  console.log(content.substring(0, 5000));

  await browser.close();
})();
