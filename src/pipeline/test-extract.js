const { resolveFinalUrl, LinkResolveError } = require('./linkResolver');
const { extractProductInfo } = require('./productExtractor');

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('사용법: node src/pipeline/test-extract.js <쇼핑커넥트_링크>');
    process.exit(1);
  }

  console.log(`[STEP 2] 링크 확인 중: ${url}`);
  let resolved;
  try {
    resolved = await resolveFinalUrl(url);
  } catch (e) {
    if (e instanceof LinkResolveError) {
      console.log(`[NAVER BLOG][PRODUCT EXTRACT FAILED] 링크 확인 실패: code=${e.code} message=${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  console.log(`[STEP 2] 최종 URL: ${resolved.finalUrl}  (status=${resolved.status})`);

  console.log(`[STEP 3-4] 상품 정보 추출 중...`);
  const { extracted, missing, hasJsonLd } = extractProductInfo(resolved.html, resolved.finalUrl);
  extracted.affiliateUrl = url;

  console.log(`[STEP 3-4] JSON-LD Product 스키마 발견: ${hasJsonLd}`);
  console.log(JSON.stringify(extracted, null, 2));

  if (missing.length) {
    console.log(`[NAVER BLOG][PRODUCT EXTRACT FAILED] 누락 필드: ${missing.join(', ')}`);
    process.exit(3);
  }

  console.log('[STEP 3-4] 추출 성공');
}

main().catch((e) => {
  console.error('예상치 못한 오류:', e);
  process.exit(1);
});
