const axios = require('axios');

/**
 * 쇼핑커넥트(또는 기타 단축/제휴) 링크를 실제로 요청해서
 * 최종적으로 도달하는 상품 페이지 URL을 확인한다.
 * axios의 redirect 추적 기능을 그대로 쓰되, 실패 지점을 명확히 구분해서 던진다.
 */
async function resolveFinalUrl(shoppingConnectUrl, opts = {}) {
  const timeout = opts.timeout || 10000;
  const maxRedirects = opts.maxRedirects ?? 10;

  if (!shoppingConnectUrl || typeof shoppingConnectUrl !== 'string') {
    throw new LinkResolveError('INVALID_INPUT', '입력된 링크가 없거나 문자열이 아닙니다.');
  }
  let url;
  try {
    url = new URL(shoppingConnectUrl.trim());
  } catch (e) {
    throw new LinkResolveError('INVALID_URL', `URL 형식이 아닙니다: ${shoppingConnectUrl}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new LinkResolveError('INVALID_PROTOCOL', `http/https만 허용됩니다: ${url.protocol}`);
  }

  const hops = [url.toString()];
  try {
    const res = await axios.get(url.toString(), {
      timeout,
      maxRedirects,
      // 최종 응답 헤더/본문을 받기 위해 리다이렉트는 axios가 자동으로 따라가게 둔다.
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const finalUrl = res.request?.res?.responseUrl || res.config?.url || url.toString();
    hops.push(finalUrl);

    if (res.status >= 400) {
      throw new LinkResolveError(
        'HTTP_ERROR',
        `최종 페이지 응답 오류 (status=${res.status})`,
        { status: res.status, finalUrl, hops }
      );
    }

    return {
      finalUrl,
      status: res.status,
      html: res.data,
      hops,
    };
  } catch (e) {
    if (e instanceof LinkResolveError) throw e;
    if (e.code === 'ECONNABORTED') {
      throw new LinkResolveError('TIMEOUT', `요청 시간 초과 (${timeout}ms)`, { hops });
    }
    throw new LinkResolveError('NETWORK_ERROR', e.message || String(e), { hops });
  }
}

class LinkResolveError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'LinkResolveError';
    this.code = code;
    Object.assign(this, extra);
  }
}

module.exports = { resolveFinalUrl, LinkResolveError };
