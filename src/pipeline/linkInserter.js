/**
 * 링크를 본문 전체에 뿌리지 않고 딱 두 곳(중후반 1회, CTA 1회)에만 넣는다.
 * "장점" 섹션 끝 부분과 "CTA" 섹션에 삽입한다.
 */
function insertAffiliateLink(body, affiliateUrl, linkLabel = '상품 보러가기') {
  if (!affiliateUrl) throw new Error('affiliateUrl이 없습니다.');

  const midInsertAfter = '장점';
  const ctaSection = 'CTA';

  let out = body;

  if (out.includes(midInsertAfter)) {
    // "장점" 섹션 본문이 끝나고 다음 섹션 헤더가 나오기 직전에 1회 삽입.
    const idx = out.indexOf(midInsertAfter);
    const nextHeaderIdx = findNextSectionHeader(out, idx + midInsertAfter.length);
    const insertAt = nextHeaderIdx === -1 ? out.length : nextHeaderIdx;
    out = out.slice(0, insertAt) + `\n\n${linkLabel}: ${affiliateUrl}\n\n` + out.slice(insertAt);
  } else {
    // 구조가 예상과 다르면 본문 끝에 1회만 붙이고 CTA 삽입은 아래에서 별도 처리한다.
    out += `\n\n${linkLabel}: ${affiliateUrl}\n`;
  }

  if (out.includes(ctaSection)) {
    out += `\n\n${linkLabel}: ${affiliateUrl}`;
  }

  return out;
}

function findNextSectionHeader(text, fromIdx) {
  const headers = ['구매 전 확인할 점', '어떤 사람에게 맞는지', '정리', 'CTA'];
  let min = -1;
  for (const h of headers) {
    const i = text.indexOf(h, fromIdx);
    if (i !== -1 && (min === -1 || i < min)) min = i;
  }
  return min;
}

function insertDisclosure(body, disclosureText) {
  if (!disclosureText) {
    throw new Error('제휴 고지 문구가 설정되지 않았습니다. 사용자가 고지문구를 먼저 입력해야 합니다.');
  }
  // 고지문구는 네이버 정책상 눈에 잘 띄게, 보통 글 최상단이나 최하단에 둔다. 최상단에 배치.
  return `${disclosureText}\n\n${body}`;
}

module.exports = { insertAffiliateLink, insertDisclosure };
