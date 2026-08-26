// 기준값은 여기서만 조정하면 되게 상수로 분리한다.
const MIN_CONFIDENCE_TO_ACCEPT = 0.6;
const STOPWORDS = new Set(['제품', '상품', '아이템', '용품', '세트', '정품', '신상', '기획', '한정', '무료배송']);

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function tokenize(s) {
  return clean(s)
    .replace(/[[\](){}]/g, ' ')
    .split(/[\s,/·\-_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function overlapRatio(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB.map((t) => t.toLowerCase()));
  const matched = tokensA.filter((t) => setB.has(t.toLowerCase()));
  const base = Math.min(tokensA.length, tokensB.length);
  return matched.length / base;
}

function validateProduct({ extracted, knownProductName }) {
  const source = extracted?.dataSource || 'direct';
  const warnings = [];
  const evidence = { nameMatched: false, brandMatched: null, categoryMatched: null };

  if (!extracted || !extracted.productName) {
    return { valid: false, confidence: 0, source, warnings: ['productName 없음'], evidence };
  }

  if (source === 'manual') {
    return { valid: true, confidence: 1.0, source, warnings: [], evidence: { nameMatched: true, brandMatched: null, categoryMatched: null } };
  }

  if (source !== 'search-fallback') {
    evidence.nameMatched = true;
    return { valid: true, confidence: 0.95, source: extracted.hasJsonLd === false ? 'opengraph' : 'jsonld', warnings: [], evidence };
  }

  if (!knownProductName) {
    warnings.push('검색 시드(knownProductName)가 없어 신뢰도를 계산할 근거가 부족합니다.');
    return { valid: false, confidence: 0.2, source, warnings, evidence };
  }

  const seedTokens = tokenize(knownProductName);
  const nameTokens = tokenize(extracted.productName);
  const nameOverlap = overlapRatio(seedTokens, nameTokens);
  evidence.nameMatched = nameOverlap >= 0.5;

  let brandMatched = null;
  if (extracted.brand) {
    const brandToken = clean(extracted.brand).toLowerCase();
    brandMatched = seedTokens.some((t) => t.toLowerCase() === brandToken);
  }
  evidence.brandMatched = brandMatched;

  let categoryMatched = null;
  if (extracted.category) {
    const catTokens = tokenize(extracted.category);
    categoryMatched = catTokens.some((ct) => seedTokens.some((st) => st.toLowerCase() === ct.toLowerCase()));
  }
  evidence.categoryMatched = categoryMatched;

  let confidence = nameOverlap;
  if (brandMatched === true) confidence = Math.min(1, confidence + 0.15);
  if (brandMatched === false) confidence = Math.max(0, confidence - 0.2);
  if (categoryMatched === true) confidence = Math.min(1, confidence + 0.05);

  if (nameOverlap < 0.5) warnings.push(`상품명 토큰 겹침이 낮습니다 (${(nameOverlap * 100).toFixed(0)}%)`);
  if (brandMatched === false) warnings.push('검색 시드에 없던 브랜드가 검색 결과에 등장합니다 — 다른 상품일 가능성');

  const valid = confidence >= MIN_CONFIDENCE_TO_ACCEPT;

  return { valid, confidence: Number(confidence.toFixed(2)), source, warnings, evidence };
}

module.exports = { validateProduct, MIN_CONFIDENCE_TO_ACCEPT, tokenize, overlapRatio };
