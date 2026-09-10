'use strict';
/**
 * optionsEngine.js
 * 
 * Computes Options Greeks (Delta, Gamma, Theta, Vega, Rho) and Implied Volatility
 * using the Black-Scholes-Merton model.
 * 
 * S = Stock Price (Spot)
 * K = Strike Price
 * T = Time to Maturity (in years)
 * r = Risk-free interest rate (e.g., 0.05 for 5%)
 * v = Volatility (e.g., 0.20 for 20%)
 * type = 'CE' (Call) or 'PE' (Put)
 */

// Approximation for Cumulative Normal Distribution Function
function CND(x) {
  const a1 =  0.31938153, a2 = -0.356563782, a3 =  1.781477937;
  const a4 = -1.821255978, a5 =  1.330274429;
  const L = Math.abs(x);
  const K = 1.0 / (1.0 + 0.2316419 * L);
  let w = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) * (a1 * K + a2 * K * K + a3 * Math.pow(K, 3) + a4 * Math.pow(K, 4) + a5 * Math.pow(K, 5));
  if (x < 0) w = 1.0 - w;
  return w;
}

// Probability Density Function
function PDF(x) {
  return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
}

function computeD1(S, K, T, r, v) {
  return (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T));
}

function computeD2(d1, v, T) {
  return d1 - v * Math.sqrt(T);
}

function blackScholes(S, K, T, r, v, type) {
  if (T <= 0) return Math.max(0, type === 'CE' ? S - K : K - S);
  
  const d1 = computeD1(S, K, T, r, v);
  const d2 = computeD2(d1, v, T);
  
  if (type === 'CE') {
    return S * CND(d1) - K * Math.exp(-r * T) * CND(d2);
  } else {
    return K * Math.exp(-r * T) * CND(-d2) - S * CND(-d1);
  }
}

function calculateGreeks(S, K, T, r, v, type) {
  if (T <= 0 || v <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

  const d1 = computeD1(S, K, T, r, v);
  const d2 = computeD2(d1, v, T);
  const pdfD1 = PDF(d1);

  let delta = 0, gamma = 0, theta = 0, vega = 0, rho = 0;

  gamma = pdfD1 / (S * v * Math.sqrt(T));
  vega  = S * pdfD1 * Math.sqrt(T) / 100; // per 1% change

  if (type === 'CE') {
    delta = CND(d1);
    theta = (-S * pdfD1 * v / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * CND(d2)) / 365;
    rho   = (K * T * Math.exp(-r * T) * CND(d2)) / 100;
  } else {
    delta = CND(d1) - 1;
    theta = (-S * pdfD1 * v / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * CND(-d2)) / 365;
    rho   = (-K * T * Math.exp(-r * T) * CND(-d2)) / 100;
  }

  return { 
    delta: Number(delta.toFixed(4)), 
    gamma: Number(gamma.toFixed(4)), 
    theta: Number(theta.toFixed(4)), 
    vega: Number(vega.toFixed(4)), 
    rho: Number(rho.toFixed(4))
  };
}

// Bisection method for implied volatility
function calculateIV(marketPrice, S, K, T, r, type) {
  if (T <= 0 || marketPrice <= 0) return 0;
  
  let low = 0.0001;
  let high = 5.0; // 500% vol max
  const tolerance = 0.001;
  let maxIter = 100;
  
  while (maxIter-- > 0) {
    const mid = (low + high) / 2;
    const px = blackScholes(S, K, T, r, mid, type);
    
    if (Math.abs(px - marketPrice) < tolerance) return Number(mid.toFixed(4));
    
    if (px > marketPrice) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return Number(((low + high) / 2).toFixed(4));
}

module.exports = {
  blackScholes,
  calculateGreeks,
  calculateIV
};
