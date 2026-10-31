const axios = require('axios');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function nseExpiry(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

class NSEProxy {
  constructor() {
    this.cookies = '';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    this.headers = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    this.cookieRefreshTime = 0;
  }

  async getCookies() {
    const now = Date.now();
    if (this.cookies && (now - this.cookieRefreshTime < 600000)) { // 10 minutes cache
      return this.cookies;
    }

    for (const url of ['https://www.nseindia.com/option-chain', 'https://www.nseindia.com']) {
      try {
        const response = await axios.get(url, {
          headers: { ...this.headers, Referer: 'https://www.nseindia.com/option-chain' },
          timeout: 10000,
        });
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          this.cookies = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
          this.cookieRefreshTime = now;
          return this.cookies;
        }
      } catch (err) {
        console.error(`NSE Cookie fetch error (${url}):`, err.message);
      }
    }
    return this.cookies;
  }

  async fetchAPI(endpoint) {
    const cookies = await this.getCookies();
    const url = `https://www.nseindia.com/api${endpoint}`;

    try {
      const response = await axios.get(url, {
        headers: {
          ...this.headers,
          'Cookie': cookies,
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.nseindia.com/option-chain',
        },
        timeout: 10000,
      });
      return response.data;
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        this.cookieRefreshTime = 0; // force refresh on next call
      }
      console.error(`NSE API fetch error for ${endpoint}:`, err.message);
      throw err;
    }
  }

  /** Available option expiries, normalized to ISO dates. */
  async getOptionChainContractInfo(symbol = 'NIFTY') {
    const data = await this.fetchAPI(`/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`);
    const raw = Array.isArray(data?.expiryDates) ? data.expiryDates
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data) ? data
      : [];
    return raw
      .map((value) => {
        const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(value));
        if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : null;
        const month = MONTHS.findIndex((name) => name.toLowerCase() === m[2].toLowerCase()) + 1;
        if (!month) return null;
        return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      })
      .filter(Boolean);
  }

  /** NSE migrated from /option-chain-indices to /option-chain-v3 (expiry required). */
  async getOptionChain(symbol = 'NIFTY', expiry = '') {
    let selected = expiry;
    if (!selected) {
      const expiries = await this.getOptionChainContractInfo(symbol);
      selected = expiries[0] || '';
    }
    if (!selected) throw new Error(`No NSE expiry available for ${symbol}`);

    return this.fetchAPI(
      `/option-chain-v3?type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(nseExpiry(selected))}`
    );
  }

  // NSE doesn't have a direct clean API for FII/DII that's always public without an index id, but we can hit /fiidiiTradeReact
  async getFiiDii() {
    return this.fetchAPI(`/fiidiiTradeReact`);
  }
}

module.exports = new NSEProxy();
