// utils/numberToWords.js

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
              'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
              'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function convertGroup(n) {
  let str = '';
  if (n >= 100) {
    str += ones[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    str += tens[Math.floor(n / 10)] + ' ';
    n %= 10;
  }
  if (n > 0) {
    str += ones[n] + ' ';
  }
  return str.trim();
}

export function numberToWords(num) {
  if (num === 0) return 'Zero';

  const isNegative = num < 0;
  num = Math.abs(num);

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  let str = '';
  let scaleIndex = 0;
  let tempInt = integerPart;

  if (tempInt === 0) {
    str = 'Zero ';
  } else {
    const parts = [];
    while (tempInt > 0) {
      const group = tempInt % 1000;
      if (group !== 0) {
        const groupStr = convertGroup(group);
        parts.push(groupStr + (scales[scaleIndex] ? ' ' + scales[scaleIndex] : ''));
      }
      tempInt = Math.floor(tempInt / 1000);
      scaleIndex++;
    }
    str = parts.reverse().join(' ').trim() + ' ';
  }

  str = (isNegative ? 'Negative ' : '') + str.trim();

  if (decimalPart > 0) {
    str += ` and ${decimalPart}/100`;
  }

  return str + ' Only';
}
