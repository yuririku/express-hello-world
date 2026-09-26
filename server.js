const http = require('http');

const port = Number(process.env.PORT || 10000);
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const chatId = process.env.TELEGRAM_CHAT_ID || '';
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const maxBodyBytes = 12 * 1024 * 1024;

function corsHeaders(req) {
  const requestOrigin = req && req.headers.origin;
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origin = allowAnyOrigin
    ? '*'
    : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || '*');

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function sendTelegram(body) {
  if (!botToken || !chatId) {
    throw new Error('Telegram credentials are not configured on Render.');
  }

  const caption = body.caption || `⚠️ Unknown user detected at the door.\nTime: ${new Date().toISOString()}`;
  const image = typeof body.image === 'string' ? body.image : '';
  let response;

  if (image) {
    const encoded = image.includes(',') ? image.split(',', 2)[1] : image;
    const binary = Buffer.from(encoded, 'base64');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('photo', new Blob([binary], { type: 'image/jpeg' }), 'snapshot.jpg');
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: form
    });
  } else {
    const form = new URLSearchParams({ chat_id: chatId, text: caption });
    response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
  }

  const telegram = await response.json();
  return { status: response.status, telegram };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    sendJson(req, res, 200, { ok: true, service: 'AnshinLock Telegram relay' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      service: 'AnshinLock Telegram relay',
      telegramTokenConfigured: Boolean(botToken),
      telegramChatConfigured: Boolean(chatId)
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/send-alert') {
    sendJson(req, res, 404, { sent: false, error: 'Not found.' });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req) || '{}');
    const result = await sendTelegram(body);
    const sent = Boolean(result.telegram.ok);
    sendJson(req, res, result.telegram.ok ? 200 : 502, {
      sent,
      error: sent ? null : (result.telegram.description || 'Telegram rejected the request.'),
      telegram: result.telegram
    });
  } catch (error) {
    sendJson(req, res, 500, { sent: false, error: error.message || 'Relay failed.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Telegram relay listening on port ${port}`);
});
