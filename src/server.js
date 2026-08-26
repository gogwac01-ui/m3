// Railway injects environment variables directly, so dotenv is optional in production.
try { require('dotenv').config(); } catch (_) {}
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

// 관리자 페이지. Railway Variables 자체를 노출하지 않고 설정 상태만 보여준다.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/api/admin/status', (req, res) => {
  const configured = (name) => Boolean(String(process.env[name] || '').trim());
  res.json({
    ok: true,
    services: {
      openai: configured('OPENAI_API_KEY'),
      naverSearchClientId: configured('NAVER_SEARCH_CLIENT_ID'),
      naverSearchClientSecret: configured('NAVER_SEARCH_CLIENT_SECRET'),
    },
    ready: configured('OPENAI_API_KEY') && configured('NAVER_SEARCH_CLIENT_ID') && configured('NAVER_SEARCH_CLIENT_SECRET'),
  });
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
      return res.status(422).json({ ok: false, stage: e.stage, code: e.code, message: e.message, details: e.details || null });
    }
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || 'internal error' });
  }
});

app.post('/api/generate-content', async (req, res) => {
  const { product, keywords, disclosureText } = req.body || {};
  if (!product) return res.status(400).json({ error: 'product가 필요합니다.' });
  try {
    const result = await generateTitlesAndBody({ product, keywords: keywords || [], disclosureText: disclosureText || '' });
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof QualityHoldError) return res.status(422).json({ ok: false, code: 'QUALITY_HOLD', message: e.message });
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || 'internal error' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => console.log(`naver-blog-gen listening on :${port}`));
