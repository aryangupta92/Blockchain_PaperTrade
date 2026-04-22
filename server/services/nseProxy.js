const axios = require('axios');

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

    try {
      const response = await axios.get('https://www.nseindia.com', {
        headers: this.headers,
        timeout: 10000
      });
      
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        this.cookies = setCookie.map(cookie => cookie.split(';')[0]).join('; ');
        this.cookieRefreshTime = now;
      }
      return this.cookies;
    } catch (err) {
      console.error('NSE Cookie fetch error:', err.message);
      return this.cookies;
    }
  }

  async fetchAPI(endpoint) {
    const cookies = await this.getCookies();
    const url = `https://www.nseindia.com/api${endpoint}`;

    try {
      const response = await axios.get(url, {
        headers: {
          ...this.headers,
          'Cookie': cookies,
          'Accept': '*/*',
        },
        timeout: 10000
      });
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 401) {
        this.cookieRefreshTime = 0; // force refresh on next call
      }
      console.error(`NSE API fetch error for ${endpoint}:`, err.message);
      throw err;
    }
  }

  async getOptionChain(symbol = 'NIFTY') {
    return this.fetchAPI(`/option-chain-indices?symbol=${encodeURIComponent(symbol)}`);
  }

  // NSE doesn't have a direct clean API for FII/DII that's always public without an index id, but we can hit /fiidiiTradeReact
  async getFiiDii() {
    return this.fetchAPI(`/fiidiiTradeReact`);
  }
}

module.exports = new NSEProxy();
