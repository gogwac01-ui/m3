const axios = require('axios');
const { resolveFinalUrl } = require('./linkResolver');
const { extractProductInfo } = require('./productExtractor');

/**
 * 검색 프로바이더 인터페이스: query(string) -> Promise<Array<{title, link}>>
 * 네이버 검색 오픈API를 기본으로 쓰되, 다른 프로바이더로 쉽게 교체 가능하게 분리한다.
 * (Google Programmable Search / Bing Search API 등으로 바꾸려면 이 함수만 갈아끼우면 된다)
 */
async function naverSearchProvider(query, { display = 8 } = {}) {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다.');
  }

  // 쇼핑 검색을 우선 쓴다 — 상품 페이지일 확률이 가장 높다.
  const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
    params: { query, display },
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    timeout: 10000,
  });

  const items = res.data?.items || [];
  return items.map((it) => ({
    title: String(it.title || '').replace(/<[^>]+>/g, ''), // 네이버 검색 결과는 <b> 태그가 섞여 온다
    link: it.link,
  }));
}

const DOMAIN_PRIORITY = [
  'danawa.com',
  'enuri.com',
  'ohou.se',
  'kream.co.kr',
  '11st.co.kr',
  'gmarket.co.kr',
  'auction.co.kr',
];

function sortByDomainPriority(candidates) {
  const rank = (url) => {
    try {
      const host = new URL(url).hostname;
      const idx = DOMAIN_PRIORITY.findIndex((d) => host.includes(d));
      return idx === -1 ? DOMAIN_PRIORITY.length : idx;
    } catch (e) {
      return DOMAIN_PRIORITY.length + 1;
    }
  };
  return [...candidates].sort((a, b) => rank(a.link) - rank(b.link));
}

async function extractWithSearchFallback({
  knownProductName,
  provider = naverSearchProvider,
  resolveFn = resolveFinalUrl,
  extractFn = extractProductInfo,
}) {
  if (!knownProductName) {
    return {
      extracted: null,
      missing: ['productName'],
      source: 'search-fallback',
      candidatesTried: 0,
      failReason: 'NO_SEARCH_SEED',
    };
  }

  let candidates;
  try {
    candidates = await provider(knownProductName);
  } catch (e) {
    return {
      extracted: null,
      missing: [],
      source: 'search-fallback',
      candidatesTried: 0,
      failReason: `SEARCH_PROVIDER_ERROR: ${e.message}`,
    };
  }

  candidates = sortByDomainPriority(candidates).slice(0, 5);

  let triedCount = 0;
  for (const cand of candidates) {
    triedCount += 1;
    try {
      const resolved = await resolveFn(cand.link, { timeout: 8000 });
      const { extracted, missing } = extractFn(resolved.html, resolved.finalUrl);
      if (!missing.length) {
        extracted.searchFallbackSourceTitle = cand.title;
        return { extracted, missing: [], source: 'search-fallback', candidatesTried: triedCount };
      }
    } catch (e) {
      continue;
    }
  }

  return {
    extracted: null,
    missing: ['productName', 'images'],
    source: 'search-fallback',
    candidatesTried: triedCount,
    failReason: 'ALL_CANDIDATES_FAILED',
  };
}

module.exports = { extractWithSearchFallback, naverSearchProvider, sortByDomainPriority };
