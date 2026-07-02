/**
 * Convert a number to its English word representation.
 * Supports integers and decimals up to trillions.
 * (Ported verbatim from the Acerta project's PDF engine.)
 */
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

const CURRENCY_NAMES = {
  EGP: { singular: 'Egyptian Pound', plural: 'Egyptian Pounds', cents: 'Piastres' },
  USD: { singular: 'US Dollar',       plural: 'US Dollars',       cents: 'Cents' },
  EUR: { singular: 'Euro',             plural: 'Euros',             cents: 'Cents' },
  GBP: { singular: 'British Pound',   plural: 'British Pounds',   cents: 'Pence' },
  SAR: { singular: 'Saudi Riyal',     plural: 'Saudi Riyals',     cents: 'Halalas' },
  AED: { singular: 'UAE Dirham',      plural: 'UAE Dirhams',      cents: 'Fils' },
  KWD: { singular: 'Kuwaiti Dinar',   plural: 'Kuwaiti Dinars',   cents: 'Fils' },
  QAR: { singular: 'Qatari Riyal',    plural: 'Qatari Riyals',    cents: 'Dirhams' },
  JOD: { singular: 'Jordanian Dinar', plural: 'Jordanian Dinars', cents: 'Fils' },
  LBP: { singular: 'Lebanese Pound',  plural: 'Lebanese Pounds',  cents: 'Piastres' },
};

function chunkToWords(n) {
  if (n === 0) return '';
  let str = '';
  if (n >= 100) {
    str += ones[Math.floor(n / 100)] + ' Hundred';
    n %= 100;
    if (n > 0) str += ' and ';
  }
  if (n >= 20) {
    str += tens[Math.floor(n / 10)];
    n %= 10;
    if (n > 0) str += '-' + ones[n];
  } else if (n > 0) {
    str += ones[n];
  }
  return str;
}

function numberToWords(value) {
  if (value === null || value === undefined || value === '') return '';
  let num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : Number(value);
  if (isNaN(num)) return String(value);
  if (num === 0) return 'Zero';

  let prefix = '';
  if (num < 0) {
    prefix = 'Negative ';
    num = Math.abs(num);
  }

  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  if (intPart === 0) {
    let result = 'Zero';
    if (decPart > 0) result += ' and ' + chunkToWords(decPart) + '/100';
    return prefix + result;
  }

  const chunks = [];
  let remaining = intPart;
  while (remaining > 0) {
    chunks.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i] === 0) continue;
    let part = chunkToWords(chunks[i]);
    if (scales[i]) part += ' ' + scales[i];
    parts.push(part);
  }

  let result = parts.join(', ');
  if (decPart > 0) result += ' and ' + chunkToWords(decPart) + '/100';

  return prefix + result;
}

function numberToWordsWithCurrency(value, currencyCode) {
  if (value === null || value === undefined || value === '') return '';
  let num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : Number(value);
  if (isNaN(num)) return String(value);

  const curr = CURRENCY_NAMES[(currencyCode || 'USD').toUpperCase()] || { singular: currencyCode || '', plural: currencyCode || '', cents: 'Cents' };
  const intPart = Math.floor(Math.abs(num));
  const centPart = Math.round((Math.abs(num) - intPart) * 100);
  const prefix = num < 0 ? 'Negative ' : '';

  const intWords = intPart === 0 ? 'Zero' : numberToWords(intPart);
  const mainLabel = intPart === 1 ? curr.singular : curr.plural;
  let result = `${prefix}${intWords} ${mainLabel}`;
  if (centPart > 0) {
    result += ` and ${numberToWords(centPart)} ${curr.cents}`;
  }
  return result;
}

module.exports = { numberToWords, numberToWordsWithCurrency, CURRENCY_NAMES };
