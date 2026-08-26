// 점수/임계값을 여기서만 조정 가능하게 상수로 분리한다.
const SCORE_START = 100;
const KEYWORD_DENSITY_LIMIT = 1 / 120; // 100자당 mainKeyword가 이 비율보다 자주 나오면 과다반복
const PRODUCTNAME_DENSITY_LIMIT = 1 / 150;
const REPEATED_SENTENCE_START_THRESHOLD = 3; // 같은 문장 시작(앞 6자)이 이 횟수 이상 반복되면 경고

const FAKE_PURCHASE_PATTERNS = [
  /제가\s*(?:직접\s*)?샀(?:는데|더니|어요)/,
  /제가\s*구매(?:했는데|했더니|해봤)/,
  /직접\s*구입해\s*봤/,
];
const FAKE_USE_PATTERNS = [
  /제가\s*(?:직접\s*)?써\s*봤는데/,
  /제가\s*써본\s*결과/,
  /실제로\s*사용해\s*본\s*후기/,
  /써보니까/,
  /사용해보니/,
  /며칠\s*(?:써|사용해)\s*보니/,
];
const FAKE_RELATION_PATTERNS = [
  /(?:엄마|아빠|아내|와이프|남편|친구|아이|애들|동생|형|누나|언니|오빠)(?:가|는|한테|께서)?.{0,20}(?:써봤|사용해봤|좋다고\s*했|추천해서|사줬는데|물어봤)/,
];
const UNVERIFIED_EFFECT_PATTERNS = [
  /효과(?:를|가)?\s*(?:봤|있었|느꼈)/,
  /(?:피부|몸)\s*(?:가|이)\s*(?:좋아졌|개선됐)/,
  /확실히\s*(?:좋아졌|나아졌)/,
];
const EXAGGERATION_PATTERNS = [
  /국내\s*최초/, /업계\s*최고/, /압도적/, /완벽한/, /무조건/, /100%\s*(?:만족|보장)/, /최고의\s*선택/,
];
const AI_CLICHE_PHRASES = [
  '무엇보다', '이러한 이유로', '다양한 매력을 가진', '여러분께 소개', '지금 바로 만나보세요',
  '다양한 장점을 자랑하는', '놓치지 마세요', '한번 알아보겠습니다',
];

function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function splitSentences(text) {
  return clean(text).split(/(?<=[.!?다])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function countMatches(text, patterns) {
  const hits = [];
  for (const p of patterns) {
    const found = text.match(p);
    if (found) hits.push(found[0]);
  }
  return hits;
}

function extractNumbersFromKnownData(extracted) {
  const known = new Set();
  const pushNumbers = (s) => {
    const nums = String(s || '').match(/\d+/g);
    if (nums) nums.forEach((n) => known.add(n));
  };
  pushNumbers(extracted.price);
  pushNumbers(extracted.productName);
  pushNumbers(extracted.description);
  pushNumbers(extracted.category);
  if (extracted.travel) {
    pushNumbers(extracted.travel.duration);
    pushNumbers(extracted.travel.departureDate);
    pushNumbers(extracted.travel.returnDate);
  }
  return known;
}

const NUMERIC_UNITS = ['mAh', 'GB', 'TB', 'mg', 'ml', 'kg', 'cm', 'mm', '개월', '단계', '시간', '%', '원', '분', '일', '년', 'g', 'L', 'W', 'V', '개', '매', '장', '배', '회'];
const UNIT_ALTERNATION = NUMERIC_UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NUMBER_WITH_UNIT_RE = new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${UNIT_ALTERNATION})(?![a-zA-Z0-9가-힣])`, 'g');

function extractNumberUnitPairsFromKnownData(extracted) {
  const known = new Set();
  const pushPairs = (s) => {
    const matches = String(s || '').match(NUMBER_WITH_UNIT_RE);
    if (matches) matches.forEach((m) => known.add(m.replace(/\s+/g, '')));
  };
  pushPairs(extracted.price);
  pushPairs(extracted.productName);
  pushPairs(extracted.description);
  pushPairs(extracted.category);
  if (extracted.travel) {
    pushPairs(extracted.travel.duration);
    pushPairs(extracted.travel.departureDate);
    pushPairs(extracted.travel.returnDate);
  }
  return known;
}

function findUnverifiedNumberUnitPairs(body, extracted) {
  const known = extractNumberUnitPairsFromKnownData(extracted);
  const bodyMatches = body.match(NUMBER_WITH_UNIT_RE) || [];
  const normalized = bodyMatches.map((m) => m.replace(/\s+/g, ''));
  return [...new Set(normalized)].filter((m) => !known.has(m));
}

function findUnverifiedNumbers(body, extracted) {
  const known = extractNumbersFromKnownData(extracted);
  const bodyNumbers = body.match(/\d+/g) || [];
  return [...new Set(bodyNumbers)].filter((n) => n.length >= 3 && !known.has(n));
}

function countKeywordDensity(body, keyword) {
  if (!keyword) return 0;
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const count = (body.match(re) || []).length;
  return count / Math.max(1, body.length);
}

function findRepeatedSentences(sentences) {
  const seen = new Map();
  const dups = [];
  for (const s of sentences) {
    const key = s.toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [k, c] of seen) {
    if (c > 1 && k.length > 5) dups.push({ sentence: k, count: c });
  }
  return dups;
}

function findRepeatedSentenceStarts(sentences) {
  const starts = new Map();
  for (const s of sentences) {
    const key = s.slice(0, 6);
    if (!key) continue;
    starts.set(key, (starts.get(key) || 0) + 1);
  }
  return [...starts.entries()].filter(([, c]) => c >= REPEATED_SENTENCE_START_THRESHOLD);
}

function checkQuality({ titles, body, extracted, keywords, affiliateUrl, disclosureText }) {
  let score = SCORE_START;
  const issues = [];
  const warnings = [];
  const allText = [...(titles || []), body].join('\n');

  const fakePurchase = countMatches(allText, FAKE_PURCHASE_PATTERNS);
  const fakeUse = countMatches(allText, FAKE_USE_PATTERNS);
  const fakeRelation = countMatches(allText, FAKE_RELATION_PATTERNS);
  if (fakePurchase.length) { issues.push(`허위 구매 경험: ${fakePurchase.join(', ')}`); score -= 40; }
  if (fakeUse.length) { issues.push(`허위 사용 경험: ${fakeUse.join(', ')}`); score -= 40; }
  if (fakeRelation.length) { issues.push(`제공되지 않은 가족/지인 경험: ${fakeRelation.join(', ')}`); score -= 40; }

  const unverifiedEffect = countMatches(body, UNVERIFIED_EFFECT_PATTERNS);
  if (unverifiedEffect.length) { warnings.push(`검증되지 않은 효능 표현: ${unverifiedEffect.join(', ')}`); score -= 10; }

  const unverifiedNumbers = findUnverifiedNumbers(body, extracted);
  const unverifiedNumberUnits = findUnverifiedNumberUnitPairs(body, extracted);
  const allUnverifiedNumbers = [...new Set([...unverifiedNumbers, ...unverifiedNumberUnits])];
  if (allUnverifiedNumbers.length) {
    issues.push(`상품정보에 없는 숫자/용량/인증 추정치: ${allUnverifiedNumbers.join(', ')}`);
    score -= 20;
  }

  const exaggeration = countMatches(allText, EXAGGERATION_PATTERNS);
  if (exaggeration.length) { warnings.push(`과장 광고 표현: ${exaggeration.join(', ')}`); score -= 10; }

  const kwDensity = countKeywordDensity(body, keywords?.mainKeyword);
  if (kwDensity > KEYWORD_DENSITY_LIMIT) { warnings.push(`메인 키워드 밀도 과다 (${(kwDensity * 100).toFixed(2)}%)`); score -= 10; }

  const nameDensity = countKeywordDensity(body, extracted?.productName);
  if (nameDensity > PRODUCTNAME_DENSITY_LIMIT) { warnings.push(`상품명 밀도 과다 (${(nameDensity * 100).toFixed(2)}%)`); score -= 10; }

  const sentences = splitSentences(body);
  const dupSentences = findRepeatedSentences(sentences);
  if (dupSentences.length) { warnings.push(`동일 문장 반복 ${dupSentences.length}건`); score -= 5 * dupSentences.length; }
  const dupStarts = findRepeatedSentenceStarts(sentences);
  if (dupStarts.length) { warnings.push(`동일 문장 시작 과다 반복: ${dupStarts.map(([k, c]) => `"${k}"x${c}`).join(', ')}`); score -= 5 * dupStarts.length; }

  const cliches = AI_CLICHE_PHRASES.filter((p) => allText.includes(p));
  if (cliches.length) { warnings.push(`AI 상투 문구: ${cliches.join(', ')}`); score -= 5 * cliches.length; }

  if (!affiliateUrl || !body.includes(affiliateUrl)) { issues.push('본문에 affiliateUrl이 없습니다(또는 destinationUrl로 잘못 대체됐을 수 있음)'); score -= 20; }
  if (!disclosureText || !body.includes(disclosureText)) { issues.push('본문에 제휴 고지 문구가 없습니다'); score -= 20; }

  const bodyLen = body.replace(/\s/g, '').length;
  if (bodyLen < 1000) { issues.push(`본문 길이 부족 (${bodyLen}자)`); score -= 20; }
  else if (bodyLen < 1500) { warnings.push(`본문이 목표(1500자) 대비 짧음 (${bodyLen}자) — 정보가 부족해서일 수 있음`); score -= 5; }

  const coreToken = clean(extracted?.productName).split(/\s+/).find((t) => t.length >= 2);
  if (coreToken && !body.includes(coreToken)) { issues.push(`본문에 상품명 핵심 토큰("${coreToken}")이 전혀 등장하지 않음 — 다른 상품 글일 가능성`); score -= 30; }

  score = Math.max(0, Math.min(100, score));
  const passed = issues.length === 0;
  return { passed, score, issues, warnings };
}

module.exports = { checkQuality, findUnverifiedNumberUnitPairs, findUnverifiedNumbers, NUMBER_WITH_UNIT_RE };
