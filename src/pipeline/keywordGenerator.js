/**
 * 추출된 상품 정보만을 근거로 키워드를 구성한다.
 * 상품 페이지에 없는 속성(효능/인증 등)을 키워드에 임의로 붙이지 않는다.
 * productType이 'travel'이면 목적지/여행사 중심으로, 'shopping'이면 브랜드 중심으로 구성한다.
 */
function generateKeywords(extracted) {
  const { productName, brand, category, productType, travel, seller } = extracted;

  if (!productName) {
    throw new Error('productName이 없어 키워드를 생성할 수 없습니다.');
  }

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const nameTokens = clean(productName)
    .replace(/[[\](){}]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);

  if (productType === 'travel') {
    const destination = travel?.destination ? clean(travel.destination) : null;
    const mainKeyword = destination ? `${destination} 여행` : clean(productName);

    const subKeywords = [];
    if (destination) subKeywords.push(destination);
    if (seller) subKeywords.push(clean(seller));
    if (category) subKeywords.push(clean(category));
    nameTokens.slice(0, 3).forEach((t) => subKeywords.push(t));

    const longTailKeywords = [];
    if (destination) longTailKeywords.push(`${destination} 패키지여행`);
    if (destination) longTailKeywords.push(`${destination} 여행 가격`);
    if (destination && seller) longTailKeywords.push(`${destination} ${clean(seller)} 후기`);
    longTailKeywords.push(`${mainKeyword} 일정`);

    const searchIntent = extracted.price ? 'transactional' : 'informational';

    return {
      mainKeyword,
      subKeywords: [...new Set(subKeywords)].filter(Boolean),
      longTailKeywords: [...new Set(longTailKeywords)].filter(Boolean),
      searchIntent,
    };
  }

  const mainKeyword = brand ? `${clean(brand)} ${nameTokens[0] || ''}`.trim() : clean(productName);

  const subKeywords = [];
  if (category) subKeywords.push(clean(category));
  if (brand) subKeywords.push(clean(brand));
  nameTokens.slice(1, 4).forEach((t) => subKeywords.push(t));

  const longTailKeywords = [];
  if (brand && nameTokens[0]) longTailKeywords.push(`${clean(brand)} ${nameTokens[0]} 추천`);
  if (category) longTailKeywords.push(`${clean(category)} 고르는 법`);
  longTailKeywords.push(`${mainKeyword} 후기`);
  longTailKeywords.push(`${mainKeyword} 가격`);

  const searchIntent = extracted.price ? 'transactional' : 'informational';

  return {
    mainKeyword,
    subKeywords: [...new Set(subKeywords)].filter(Boolean),
    longTailKeywords: [...new Set(longTailKeywords)].filter(Boolean),
    searchIntent,
  };
}

module.exports = { generateKeywords };
