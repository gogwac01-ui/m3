require('dotenv').config();
const express = require('express');
const path = require('path');
const { runPipeline, PipelineError } = require('./pipeline/index');
const { generateTitlesAndBody, QualityHoldError } = require('./pipeline/contentGenerator');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 1차 MVP: 링크 -> 결과 전체 생성
app.post('/api/generate', async (req, res) => {
  const { shoppingConnectUrl, disclosureText, knownProductNameHint } = req.body || {};
  if (!shoppingConnectUrl) return res.status(400).json({ error: 'shoppingConnectUrl이 필요합니다.' });
  if (!disclosureText) return res.status(400).json({ error: '제휴 고지 문구(disclosureText)가 필요합니다.' });

  try {
    const result = await runPipeline({ shoppingConnectUrl, disclosureText, imageLinkLabel: '상품 보러가기', knownProductNameHint });
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof PipelineError) {
      return res.status(422).json({
        ok: false,
        stage: e.stage,
        code: e.code,
        message: e.message,
        requiresManualInput: !!e.requiresManualInput,
        extracted: e.extracted || null,
      });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: '알 수 없는 오류' });
  }
});

// 상품 정보 추출 실패 시 사용자가 상품명/이미지를 직접 입력해서 이어가는 엔드포인트
app.post('/api/generate-manual', async (req, res) => {
  const { extracted, disclosureText } = req.body || {};
  if (!extracted?.productName) return res.status(400).json({ error: 'productName이 필요합니다.' });
  if (!Array.isArray(extracted.images) || !extracted.images.length) {
    return res.status(400).json({ error: 'images가 최소 1장 필요합니다.' });
  }
  if (!disclosureText) return res.status(400).json({ error: '제휴 고지 문구가 필요합니다.' });

  try {
    const { generateKeywords } = require('./pipeline/keywordGenerator');
    const { selectAndPlaceImages } = require('./pipeline/imagePlacer');
    const { insertAffiliateLink, insertDisclosure } = require('./pipeline/linkInserter');
    const { checkQuality } = require('./pipeline/qualityGuard');

    extracted.dataSource = 'manual';
    const keywords = generateKeywords(extracted);
    const { titles, body, structure } = await generateTitlesAndBody(extracted, keywords);
    const imageResult = await selectAndPlaceImages(extracted.images, body, structure);
    const bodyWithLink = insertAffiliateLink(body, extracted.affiliateUrl, '상품 보러가기');
    const finalBody = insertDisclosure(bodyWithLink, disclosureText);

    const quality = checkQuality({ titles, body: finalBody, extracted, keywords, affiliateUrl: extracted.affiliateUrl, disclosureText });
    if (!quality.passed) {
      console.log(`[NAVER BLOG][QUALITY HOLD] stage=manualGenerate issues=${quality.issues.join(' | ')}`);
      return res.status(422).json({ ok: false, message: `최종 품질 검증 실패: ${quality.issues.join(', ')}`, quality });
    }

    res.json({
      ok: true,
      result: {
        titles,
        mainKeyword: keywords.mainKeyword,
        subKeywords: keywords.subKeywords,
        longTailKeywords: keywords.longTailKeywords,
        searchIntent: keywords.searchIntent,
        body: finalBody,
        thumbnail: imageResult.thumbnail,
        bodyImages: imageResult.bodyImages,
        imagePlacements: imageResult.placements,
        excludedImages: imageResult.excludedBreakdown,
        affiliateUrl: extracted.affiliateUrl,
        disclosureText,
        quality,
        extracted,
      },
    });
  } catch (e) {
    console.log(`[NAVER BLOG][QUALITY HOLD] stage=manualGenerate reason=${e.message}`);
    res.status(422).json({ ok: false, message: e.message });
  }
});

// 12. 일부 문단 재작성 (섹션 단위로만 다시 생성, 나머지 본문은 그대로 유지)
app.post('/api/regenerate-section', async (req, res) => {
  const { extracted, sectionName, currentBody } = req.body || {};
  if (!extracted || !sectionName || !currentBody) {
    return res.status(400).json({ error: 'extracted, sectionName, currentBody가 모두 필요합니다.' });
  }
  // MVP 범위: 섹션 재작성은 본문 전체를 다시 만들고 해당 섹션만 교체하는 대신,
  // 우선 "전체 재생성" 경로를 재사용한다. 진짜 섹션 단위 재작성(부분 diff)은 2차 작업으로 남긴다.
  return res.status(501).json({
    ok: false,
    message: '섹션 단위 재작성은 1차 MVP 범위 밖입니다(전체 재생성만 지원). 2차 작업에서 구현 예정.',
  });
});

const PORT = process.env.PORT || 4300;
app.listen(PORT, () => console.log(`[naver-blog-gen] listening on :${PORT}`));
