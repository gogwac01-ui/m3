const axios = require('axios');
const crypto = require('crypto');

const MIN_IMAGE_BYTES = 8 * 1024; // 8KB 미만은 아이콘/장식용일 가능성이 커서 제외

// URL 경로/파일명에 흔히 아이콘·로고·배너·UI요소·광고 배너에 쓰이는 표시가 있으면 제외한다.
// 완벽한 판별은 아니고(파일명 규칙에 의존), 실제 이미지를 열어보지 않고 걸러내는 1차 필터다.
const EXCLUDE_URL_PATTERN = /(?:icon|logo|sprite|badge|btn[-_]|button|banner|ad[-_]|advert|thumb[-_]?s\b|favicon|placeholder)/i;

function looksLikeUiAsset(url) {
  try {
    const path = new URL(url).pathname;
    return EXCLUDE_URL_PATTERN.test(path);
  } catch (e) {
    return EXCLUDE_URL_PATTERN.test(url);
  }
}

/**
 * 이미지 URL들을 실제로 GET해서 크기를 확인하고,
 * URL 중복 · 내용(바이트) 중복 · 아이콘/로고/배너로 보이는 URL · 너무 작은 이미지를 제외한 뒤
 * 카테고리별 본문 구조(structure)에 순서대로 배치한다.
 * 원본 URL은 sourceUrl로 그대로 보관한다(사용권 확인용). 실제 이미지가 부족하면
 * 부족한 채로 반환한다 — AI 이미지로 임의 채우지 않는다.
 */
async function selectAndPlaceImages(images, body, structure) {
  const sectionHeaders = Array.isArray(structure) && structure.length
    ? structure
    : ['도입', '검색자가 궁금해할 문제', '상품 특징', '실제 활용 포인트', '장점', '구매 전 확인할 점', '어떤 사람에게 맞는지', '정리', 'CTA'];

  const seenUrl = new Set();
  const seenHash = new Set();
  const usable = [];
  let excludedUiAsset = 0;
  let excludedTooSmall = 0;
  let excludedDuplicateContent = 0;
  let excludedFetchFailed = 0;

  for (const url of images) {
    if (!url || seenUrl.has(url)) continue;
    seenUrl.add(url);

    if (looksLikeUiAsset(url)) {
      excludedUiAsset += 1;
      continue;
    }

    let bytes;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, maxContentLength: 20 * 1024 * 1024 });
      bytes = res.data;
    } catch (e) {
      excludedFetchFailed += 1;
      continue; // 접근 안 되는 이미지는 조용히 제외 (임의 대체 이미지로 채우지 않는다)
    }

    const sizeBytes = bytes?.length || 0;
    if (sizeBytes < MIN_IMAGE_BYTES) {
      excludedTooSmall += 1;
      continue;
    }

    // URL이 다르더라도 실제 바이트가 같으면(같은 이미지를 다른 CDN 경로로 중복 등록한 경우 등) 제외한다.
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (seenHash.has(hash)) {
      excludedDuplicateContent += 1;
      continue;
    }
    seenHash.add(hash);

    usable.push({ url, sizeBytes, sourceUrl: url, contentHash: hash });
  }

  const thumbnail = usable[0] || null;
  const bodyImages = usable.slice(1, 7); // 본문 3~6장 목표, 확보량에 따라 최대 6장

  const placements = [];
  const sectionsPresent = sectionHeaders.filter((h) => body.includes(h));
  let imgIdx = 0;
  for (const section of sectionsPresent) {
    if (imgIdx >= bodyImages.length) break;
    placements.push({ afterSection: section, image: bodyImages[imgIdx] });
    imgIdx += 1;
  }

  return {
    thumbnail,
    bodyImages,
    placements,
    excludedCount: images.length - usable.length,
    excludedBreakdown: {
      uiAsset: excludedUiAsset,
      tooSmall: excludedTooSmall,
      duplicateContent: excludedDuplicateContent,
      fetchFailed: excludedFetchFailed,
    },
  };
}

module.exports = { selectAndPlaceImages, looksLikeUiAsset };
