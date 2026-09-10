const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const NIFTY50 = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'SBIN', 'BAJFINANCE', 'BHARTIARTL', 'WIPRO',
  'AXISBANK', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'MARUTI',
  'SUNPHARMA', 'TITAN', 'NTPC', 'TECHM', 'HCLTECH',
  'ONGC', 'COALINDIA', 'JSWSTEEL', 'POWERGRID', 'ULTRACEMCO',
  'NESTLEIND', 'ADANIPORTS', 'BAJAJFINSV', 'DRREDDY', 'DIVISLAB',
  'CIPLA', 'EICHERMOT', 'BRITANNIA', 'HEROMOTOCO', 'TATACONSUM',
  'SBILIFE', 'HDFCLIFE', 'APOLLOHOSP', 'GRASIM', 'ADANIENT',
  'TATAMOTORS', 'BPCL', 'SHREECEM', 'HINDALCO', 'TATAPOWER',
  'ITC', 'M&M', 'INDUSINDBK', 'UPL', 'LTIM',
];

const INDICES = [
  { symbol: '^NSEI',    name: 'Nifty 50' },
  { symbol: '^BSESN',   name: 'BSE Sensex' },
  { symbol: '^NSEBANK', name: 'Bank Nifty' },
  { symbol: '^CNXIT',   name: 'Nifty IT' },
  { symbol: '^CNXAUTO', name: 'Nifty Auto' },
  { symbol: '^CNXPHARMA', name: 'Nifty Pharma' },
  { symbol: '^NSMIDCP150', name: 'Nifty Midcap 150' },
];

async function main() {
  console.log('Seeding initial instruments...');

  // Seed Indices
  for (const idx of INDICES) {
    await prisma.instrument.upsert({
      where: { tradingSymbol: idx.symbol },
      update: {},
      create: {
        symbol: idx.symbol,
        tradingSymbol: idx.symbol,
        exchange: 'NSE',
        name: idx.name,
        type: 'INDEX'
      }
    });
  }

  // Seed Nifty 50
  for (const symbol of NIFTY50) {
    const ts = `${symbol}.NS`;
    await prisma.instrument.upsert({
      where: { tradingSymbol: ts },
      update: {},
      create: {
        symbol: ts,
        tradingSymbol: ts,
        exchange: 'NSE',
        name: symbol,
        type: 'EQUITY'
      }
    });
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
