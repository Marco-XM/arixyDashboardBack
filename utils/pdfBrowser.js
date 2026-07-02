// Puppeteer launcher that works both on Vercel serverless and locally.
//
// On serverless (Vercel / AWS Lambda) we use puppeteer-core + @sparticuz/chromium,
// which ships a Chromium build small enough to fit the function bundle. Locally we
// point puppeteer-core at an installed Chrome/Chromium (or the PUPPETEER_EXECUTABLE_PATH
// env var) so developers don't need the ~300MB full puppeteer download.

let chromium;
let puppeteer;
try {
  chromium = require('@sparticuz/chromium');
  puppeteer = require('puppeteer-core');
} catch (err) {
  console.warn('PDF: puppeteer-core / @sparticuz/chromium not installed yet.', err.message);
}

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_REGION);

// Common local Chrome locations by platform (best-effort fallback for dev).
function localChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const fs = require('fs');
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

async function launchBrowser() {
  if (!puppeteer) {
    throw new Error('PDF generation is unavailable: puppeteer-core is not installed.');
  }

  if (isServerless && chromium) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  const executablePath = localChromePath();
  if (!executablePath) {
    // Last resort: let @sparticuz resolve a bundled binary even locally.
    if (chromium) {
      return puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }
    throw new Error('No local Chrome found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary.');
  }

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

// Render an HTML string to a PDF Buffer (A4). Always closes the browser.
async function htmlToPdfBuffer(html, options = {}) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      ...options,
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = { launchBrowser, htmlToPdfBuffer };
