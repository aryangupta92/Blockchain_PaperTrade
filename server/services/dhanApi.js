'use strict';

const axios = require('axios');

const DHAN_BASE_URL = 'https://api.dhan.co/v2';

function getHeaders() {
  return {
    'access-token': process.env.DHAN_ACCESS_TOKEN,
    'client-id': process.env.DHAN_CLIENT_ID,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
}

/**
 * Fetch Account Funds/Limits
 */
async function getFundLimit() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/fundlimit`, { headers: getHeaders() });
    return res.data; // { availabelBalance, sodLimit, withdrawableBalance, ... }
  } catch (err) {
    console.error('[Dhan] Error fetching funds:', err.response?.data || err.message);
    throw new Error('Failed to fetch Dhan funds');
  }
}

/**
 * Fetch DP Holdings
 */
async function getHoldings() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/holdings`, { headers: getHeaders() });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (err.response?.data?.errorCode === 'DH-1111') return []; // "No holdings available"
    console.error('[Dhan] Error fetching holdings:', err.response?.data || err.message);
    throw new Error('Failed to fetch Dhan holdings');
  }
}

/**
 * Fetch Intraday/F&O Positions
 */
async function getPositions() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/positions`, { headers: getHeaders() });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (err.response?.data?.errorCode === 'DH-1111') return []; // Assume similar empty code for positions
    console.error('[Dhan] Error fetching positions:', err.response?.data || err.message);
    throw new Error('Failed to fetch Dhan positions');
  }
}

/**
 * Fetch Order Book
 */
async function getOrders() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/orders`, { headers: getHeaders() });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    if (err.response?.data?.errorCode === 'DH-1111') return [];
    console.error('[Dhan] Error fetching orders:', err.response?.data || err.message);
    throw new Error('Failed to fetch Dhan orders');
  }
}

/**
 * Place a new Order
 * @param {Object} orderPayload 
 */
async function placeOrder(orderPayload) {
  try {
    const res = await axios.post(`${DHAN_BASE_URL}/orders`, orderPayload, { headers: getHeaders() });
    return res.data; // { orderId, orderStatus }
  } catch (err) {
    console.error('[Dhan] Error placing order:', err.response?.data || err.message);
    throw new Error(err.response?.data?.errorMessage || 'Failed to place order on Dhan');
  }
}

/**
 * Cancel an Order
 */
async function cancelOrder(orderId) {
  try {
    const res = await axios.delete(`${DHAN_BASE_URL}/orders/${orderId}`, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error(`[Dhan] Error canceling order ${orderId}:`, err.response?.data || err.message);
    throw new Error('Failed to cancel order on Dhan');
  }
}

/**
 * Kill Switch Controls
 */
async function setKillSwitch(action) {
  try {
    const res = await axios.post(`${DHAN_BASE_URL}/killswitch?killSwitchStatus=${action.toUpperCase()}`, {}, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error(`[Dhan] Error setting kill switch (${action}):`, err.response?.data || err.message);
    throw new Error('Failed to set Dhan Kill Switch');
  }
}

async function getKillSwitchStatus() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/killswitch`, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error('[Dhan] Error getting kill switch status:', err.response?.data || err.message);
    throw new Error('Failed to get Dhan Kill Switch status');
  }
}

/**
 * PnL Auto-Exit Controls
 */
async function setPnlExit(profitValue, lossValue, enableKillSwitch = false) {
  try {
    const payload = {
      profitValue: parseFloat(profitValue),
      lossValue: parseFloat(lossValue),
      productType: ['INTRADAY', 'DELIVERY', 'MARGIN', 'MTF'],
      enableKillSwitch
    };
    const res = await axios.post(`${DHAN_BASE_URL}/pnlExit`, payload, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error('[Dhan] Error setting PnL exit:', err.response?.data || err.message);
    throw new Error('Failed to set Dhan PnL Exit');
  }
}

async function getPnlExit() {
  try {
    const res = await axios.get(`${DHAN_BASE_URL}/pnlExit`, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error('[Dhan] Error getting PnL exit:', err.response?.data || err.message);
    throw new Error('Failed to get Dhan PnL Exit');
  }
}

/**
 * Forever (GTT) Orders
 */
async function placeForeverOrder(payload) {
  try {
    const res = await axios.post(`${DHAN_BASE_URL}/forever/orders`, payload, { headers: getHeaders() });
    return res.data;
  } catch (err) {
    console.error('[Dhan] Error placing Forever order:', err.response?.data || err.message);
    throw new Error('Failed to place Forever order on Dhan');
  }
}

module.exports = {
  getFundLimit,
  getHoldings,
  getPositions,
  getOrders,
  placeOrder,
  cancelOrder,
  setKillSwitch,
  getKillSwitchStatus,
  setPnlExit,
  getPnlExit,
  placeForeverOrder
};
