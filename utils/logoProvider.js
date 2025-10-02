const axios = require('axios');
const fs = require('fs');
const path = require('path');

// memory cache to avoid reloading every request
let cached;

async function getLogoDataUrl() {
  if (cached){
    return cached;
  }

  // 2) Remote URL (CDN, S3, HubSpot Files public URL, etc.)
  const url = process.env.NBD_LOGO_URL;
  if (url) {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    // You can also inspect headers to decide mime; defaulting to png here
    const mime = resp.headers['content-type'] || 'image/png';
    const b64 = Buffer.from(resp.data).toString('base64');
    cached = `data:${mime};base64,${b64}`;
    return cached;
  }

  // Fallback: no logo
  cached = '';
  return cached;
}

module.exports = { getLogoDataUrl };