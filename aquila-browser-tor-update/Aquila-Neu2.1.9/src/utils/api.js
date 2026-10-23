const http = require('http');

const UPDATE_API = 'http://2.59.132.39:3000';
const AQUILA_KEY = 'AquilaBrowser-Internal-2025';

function apiRequest(endpoint) {
  return new Promise((resolve) => {
    const req = http.get(`${UPDATE_API}${endpoint}`, {
      timeout: 8000,
      headers: { 'X-Aquila-Key': AQUILA_KEY }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, error: 'JSON Parse Error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
  });
}

module.exports = {
  apiRequest,
  UPDATE_API,
  AQUILA_KEY
};