'use strict';
/**
 * scripts/dhan_login.js - one-off CLI that turns your Dhan API Key + Secret into
 * a 24h access token, exactly like the app does at runtime.
 *
 *   node scripts/dhan_login.js
 *
 * Flow:
 *   1. Asks Dhan for a consent session (validates app_id / app_secret)
 *   2. Opens that login URL in your browser
 *   3. You log in with Dhan credentials + 2FA
 *   4. Dhan redirects to your app URL with ?tokenId=XXXX - paste that value here
 *   5. Token is consumed and saved to server/data/dhan_token.json (24h)
 *
 * Repeat this once every 24 hours, or automate it from
 *   POST /api/dhan/auth/start  ->  POST /api/dhan/auth/finish
 */

const readline = require('readline');
const { exec } = require('child_process');
const dhanAuth = require('../services/data/dhanAuth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

(async () => {
  console.log('\n=== DhanHQ consent login =========================================\n');
  console.log('Client ID : ' + (process.env.DHAN_CLIENT_ID || '(unset)'));
  console.log('App ID    : ' + (process.env.DHAN_APP_ID || '(unset)'));
  console.log('App secret: ' + (process.env.DHAN_APP_SECRET ? 'set' : '(unset)') + '\n');

  try {
    const consent = await dhanAuth.startConsent();
    console.log('Consent session created. Open this URL in your browser:\n');
    console.log('   ' + consent.loginUrl + '\n');
    console.log('Opening it now. Log in with your Dhan credentials + 2FA.');
    console.log('After login your browser is redirected to your redirect URL with ?tokenId=XXXX\n');
    openBrowser(consent.loginUrl);

    const tokenId = (await ask('Paste the tokenId from the redirect URL: ')).trim();
    if (!tokenId) throw new Error('tokenId is required');

    const status = await dhanAuth.finishConsent(tokenId);
    console.log('\nSUCCESS - access token saved.');
    console.log('   Client     : ' + (status.clientName || status.stored?.dhanClientName || process.env.DHAN_CLIENT_ID));
    console.log('   Valid until: ' + (status.expiresAt || status.stored?.expiryTime || 'next 24h'));
    console.log('   File       : server/data/dhan_token.json');
    console.log('\nRestart the API server (or hit POST /api/dhan/auth/finish) to go live.\n');
  } catch (e) {
    console.error('\nLOGIN FAILED: ' + e.message);
    console.error('Hints:');
    console.error('  - tokenId must come from the redirect AFTER you finish browser login');
    console.error('  - consent sessions expire quickly - re-run the script if yours did');
    console.error('  - check DHAN_CLIENT_ID / DHAN_APP_ID / DHAN_APP_SECRET in server/.env');
    process.exitCode = 1;
  } finally {
    rl.close();
  }
})();
