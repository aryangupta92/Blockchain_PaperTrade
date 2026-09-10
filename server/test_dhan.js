const axios = require('axios');

async function test() {
  const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJ1c2VyUmVnaW9uIjoiUjEiLCJpc3MiOiJkaGFuIiwicGFydG5lcklkIjoiIiwiZXhwIjoxNzg4NDUwMzA4LCJpYXQiOjE3ODgzNjM5MDgsInRva2VuQ29uc3VtZXJUeXBlIjoiU0VMRiIsIndlYmhvb2tVcmwiOiIiLCJkaGFuQ2xpZW50SWQiOiIxMTA4NTEyMTk4In0.aidVdbniyTBtTJv3PGHKXI6EUyNQcfLgu6AsEo6PFkTS_sQwVCIN_M1XoEzj1Tg3tX5p3By4WNbdfacKVT4pWg';
  const clientId = '1108512198';

  try {
    const res = await axios.post('https://api.dhan.co/orders', {
      dhanClientId: clientId,
      transactionType: "BUY",
      exchangeSegment: "NSE_EQ",
      productType: "CNC",
      orderType: "MARKET",
      validity: "DAY",
      tradingSymbol: "RELIANCE",
      securityId: "2885", // RELIANCE Security ID in NSE
      quantity: 1,
      price: 0,
      triggerPrice: 0,
      disclosedQuantity: 0,
      afterMarketOrder: false
    }, {
      headers: {
        'access-token': token,
        'client-id': clientId,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    console.log('Order:', res.data);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

test();
