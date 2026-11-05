// Veil: a private browser that runs in your own browser tab. No dependencies. Needs Node 18+.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8787;
const BLOCK = ['doubleclick.net','google-analytics.com','googletagmanager.com','googlesyndication.com','facebook.net','hotjar.com','scorecardresearch.com','adservice.google','taboola.com','outbrain.com','criteo.com','amazon-adsystem.com','segment.io','mixpanel.com','clarity.ms','quantserve.com','adnxs.com','ads-twitter.com'];
const stats = { blocked: 0, requests: 0 };
const UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0';

const prox = (u) => '/go?u=' + encodeURIComponent(u);
const resolve = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };
const skip = (u) => /^(data:|javascript:|mailto:|tel:|blob:|#|about:)/i.test(u.trim());

function rewriteHTML(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, '');
  html = html.replace(/(\s(?:src|href|action|poster)=)(["'])(.*?)\2/gi, (m, a, q, v) => {
    if (skip(v)) return m;
    const r = resolve(v.replace(/&amp;/g, '&'), base);
    return r && /^https?:/.test(r) ? a + q + prox(r) + q : m;
  });
  html = html.replace(/\s(integrity|srcset|target)=(["']).*?\2/gi, '');
  const inject = '<script>window.__B=' + JSON.stringify(base) + ';(' + function () {
    var px = function (u) { try { var a = new URL(u, window.__B); if (a.pathname === '/go' && a.origin === location.origin) return u; if (!/^https?:/.test(a.protocol)) return u; return '/go?u=' + encodeURIComponent(a.href); } catch (e) { return u; } };
    var f = window.fetch; window.fetch = function (i, o) { return f(typeof i === 'string' ? px(i) : i, o); };
    var x = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { arguments[1] = px(u); return x.apply(this, arguments); };
    window.open = function (u) { if (u) location.href = px(u); };
    document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a && a.getAttribute('target') === '_blank') a.removeAttribute('target'); }, true);
  }.toString() + ')()</script>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
}

async function proxy(req, res, target) {
  let host; try { host = new URL(target).hostname; } catch { res.writeHead(400); return res.end('Bad URL'); }
  if (!/^https?:/.test(target)) { res.writeHead(400); return res.end('Only http(s)'); }
  if (BLOCK.some((b) => host.endsWith(b))) { stats.blocked++; res.writeHead(204); return res.end(); }
  stats.requests++;
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  try {
    const up = await fetch(target, {
      method: req.method, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'follow',
      headers: { 'user-agent': UA, accept: req.headers.accept || '*/*', 'accept-language': 'en-US,en;q=0.9', dnt: '1', 'content-type': req.headers['content-type'] || '' },
    });
    const type = up.headers.get('content-type') || 'application/octet-stream';
    const headers = { 'content-type': type, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
    if (/text\/html/i.test(type)) {
      res.writeHead(up.status, headers); return res.end(rewriteHTML(await up.text(), up.url));
    }
    if (/text\/css/i.test(type)) {
      const css = (await up.text()).replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (m, q, v) => { if (skip(v)) return m; const r = resolve(v, up.url); return r ? 'url(' + prox(r) + ')' : m; });
      res.writeHead(up.status, headers); return res.end(css);
    }
    res.writeHead(up.status, headers); res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end('<body style="font:16px system-ui;padding:3rem;background:#1b1030;color:#e8e4f5"><h2>Couldn\u2019t load this page</h2><p>' + String(e.cause && e.cause.code || e.message) + '</p><p>Check the address, or the site may block proxies.</p>');
  }
}

const PASS = process.env.VEIL_PASSWORD || '';
const HOST = PASS ? '0.0.0.0' : '127.0.0.1';
http.createServer((req, res) => {
  if (PASS) {
    const got = Buffer.from((req.headers.authorization || '').slice(6), 'base64').toString().split(':').slice(1).join(':');
    if (got !== PASS) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Veil"' }); return res.end('Password required'); }
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/go') return proxy(req, res, url.searchParams.get('u') || '');
  if (url.pathname === '/stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(stats)); }
  if (url.pathname === '/reset') { stats.blocked = stats.requests = 0; res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(__dirname, 'ui.html')));
}).listen(PORT, HOST, () => console.log('Veil is running on port ' + PORT + (PASS ? ' (password protected)' : ' (local only)')));
