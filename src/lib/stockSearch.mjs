const A_SHARE_CLASSES = new Set(['AStock', '23']);

export function isAShareQuotationRow(row) {
  const code = String(row?.Code || '');
  const quoteId = String(row?.QuoteID || '');
  const classify = String(row?.Classify || '');
  const validCode = /^(?:[03689]\d{5}|[48]\d{5})$/.test(code);
  return validCode && (A_SHARE_CLASSES.has(classify) || /^[01]\.\d{6}$/.test(quoteId));
}
