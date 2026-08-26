// Railway injects environment variables directly, so dotenv is optional in production.
try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { runPipeline, PipelineError } = require('./pipeline/index');
const { generateTitlesAndBody, QualityHoldError } = require('./pipeline/contentGenerator');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const runtimeSecretsPath = process.env.RUNTIME_SECRETS_FILE || '/tmp/m3-runtime-secrets.json';
const allowedSecretNames = ['OPENAI_API_KEY', 'NAVER_SEARCH_CLIENT_ID', 'NAVER_SEARCH_CLIENT_SECRET'];

function loadRuntimeSecrets() {
  try {
    if (!fs.existsSync(runtimeSecretsPath)) return;
    const saved = JSON.parse(fs.readFileSync(runtimeSecretsPath, 'utf8'));
    for (const name of allowedSecretNames) {
      if (saved[name] && !process.env[name]) process.env[name] = String(saved[name]);
    }
  } catch (e) {
    console.error('[Admin] runtime secrets load failed:', e.message);
  }
}
loadRuntimeSecrets();

function adminAuthorized(req) {
  const expected = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return true;
  const supplied = String(req.get('x-admin-password') || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!adminAuthorized(req)) return res.status(401).json({ ok: false, error: '관리자 비밀번호가 올바르지 않습니다.' });
  next();
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
  const configured = (name) => Boolean(String(process.env[name] || '').trim());
  res.json({
    ok: true,
    passwordRequired: Boolean(String(process.env.ADMIN_PASSWORD || '').trim()),
    services: {
      openai: configured('OPENAI_API_KEY'),
      naverSearchClientId: configured('NAVER_SEARCH_CLIENT_ID'),
      naverSearchClientSecret: configured('NAVER_SEARCH_CLIENT_SECRET'),
    },
    ready: configured('OPENAI_API_KEY') && configured('NAVER_SEARCH_CLIENT_ID') && configured('NAVER_SEARCH_CLIENT_SECRET'),
  });
});

app.post('/api/admin/secrets', requireAdmin, (req, res) => {
  const body = req.body || {};
  const saved = {};
  try {
    if (fs.existsSync(runtimeSecretsPath)) Object.assign(saved, JSON.parse(fs.readFileSync(runtimeSecretsPath, 'utf8')));
  } catch (_) {}

  let changed = 0;
  for (const name of allowedSecretNames) {
    const value = String(body[name] || '').trim();
    if (!value) continue;
    process.env[name] = value;
    saved[name] = value;
    changed++;
  }
  if (!changed) return res.status(400).json({ ok: false, error: '저장할 API 값을 입력해 주세요.' });

  try {
    fs.writeFileSync(runtimeSecretsPath, JSON.stringify(saved), { mode: 0o600 });
  } catch (e) {
    console.error('[Admin] runtime secrets persist failed:', e.message);
  }
  res.json({ ok: true, changed, message: 'API 설정이 현재 서버에 적용되었습니다.' });
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
