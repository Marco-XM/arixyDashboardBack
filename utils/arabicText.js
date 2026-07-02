const path = require('path');
const fs = require('fs');

// Detect Arabic characters (used to flip text direction to RTL in the PDF).
function hasArabicText(text) {
  return !!text && /[؀-ۿ]/.test(text);
}

// Serverless Chromium may not ship an Arabic-capable font, so we embed Amiri
// directly into the document CSS as a base64 @font-face. Cached after first read.
let _fontCss = null;
function getArabicFontFaceCss() {
  if (_fontCss !== null) return _fontCss;
  try {
    const fontsDir = path.join(__dirname, '..', 'fonts');
    const reg = path.join(fontsDir, 'Amiri-Regular.ttf');
    const bold = path.join(fontsDir, 'Amiri-Bold.ttf');
    let css = '';
    if (fs.existsSync(reg)) {
      const b64 = fs.readFileSync(reg).toString('base64');
      css += `@font-face{font-family:'Amiri';font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
    }
    if (fs.existsSync(bold)) {
      const b64 = fs.readFileSync(bold).toString('base64');
      css += `@font-face{font-family:'Amiri';font-style:normal;font-weight:700;src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
    }
    _fontCss = css;
  } catch (err) {
    console.warn('Could not embed Arabic font:', err.message);
    _fontCss = '';
  }
  return _fontCss;
}

module.exports = { hasArabicText, getArabicFontFaceCss };
