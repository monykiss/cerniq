
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { requireEnv } from '../src/config/required-env';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');

const connectionString = requireEnv('DATABASE_URL');
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const tickers = [
    // Tech Giants
    { ticker: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', assetType: 'stock' },
    { ticker: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', assetType: 'stock' },
    { ticker: 'AAPL', name: 'Apple Inc', sector: 'Technology', assetType: 'stock' },
    { ticker: 'GOOGL', name: 'Alphabet Inc', sector: 'Technology', assetType: 'stock' },
    { ticker: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Cyclical', assetType: 'stock' },
    { ticker: 'META', name: 'Meta Platforms Inc', sector: 'Technology', assetType: 'stock' },
    { ticker: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Cyclical', assetType: 'stock' },

    // Semiconductors
    { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', assetType: 'stock' },
    { ticker: 'INTC', name: 'Intel Corp', sector: 'Technology', assetType: 'stock' },
    { ticker: 'TSM', name: 'Taiwan Semiconductor', sector: 'Technology', assetType: 'stock' },
    { ticker: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', assetType: 'stock' },
    { ticker: 'QCOM', name: 'Qualcomm Inc', sector: 'Technology', assetType: 'stock' },
    { ticker: 'ASML', name: 'ASML Holding', sector: 'Technology', assetType: 'stock' },
    { ticker: 'LRCX', name: 'Lam Research', sector: 'Technology', assetType: 'stock' },
    { ticker: 'AMAT', name: 'Applied Materials', sector: 'Technology', assetType: 'stock' },
    { ticker: 'MU', name: 'Micron Technology', sector: 'Technology', assetType: 'stock' },

    // ETFs & Indices
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'Financial', assetType: 'etf' },
    { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'Financial', assetType: 'etf' },
    { ticker: 'IWM', name: 'iShares Russell 2000 ETF', sector: 'Financial', assetType: 'etf' },
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', sector: 'Financial', assetType: 'etf' },
    { ticker: 'ARKK', name: 'ARK Innovation ETF', sector: 'Financial', assetType: 'etf' },
    { ticker: 'SMH', name: 'VanEck Semiconductor ETF', sector: 'Financial', assetType: 'etf' },
    { ticker: 'XLE', name: 'Energy Select Sector SPDR', sector: 'Energy', assetType: 'etf' },
    { ticker: 'XLF', name: 'Financial Select Sector SPDR', sector: 'Financial', assetType: 'etf' },
    { ticker: 'GLD', name: 'SPDR Gold Shares', sector: 'Commodities', assetType: 'etf' },
    { ticker: 'SLV', name: 'iShares Silver Trust', sector: 'Commodities', assetType: 'etf' },

    // Commodities & Futures (Represented as tickers)
    { ticker: 'CL=F', name: 'Crude Oil Futures', sector: 'Energy', assetType: 'future' },
    { ticker: 'GC=F', name: 'Gold Futures', sector: 'Commodities', assetType: 'future' },
    { ticker: 'SI=F', name: 'Silver Futures', sector: 'Commodities', assetType: 'future' },
    { ticker: 'NG=F', name: 'Natural Gas Futures', sector: 'Energy', assetType: 'future' },
    { ticker: 'HG=F', name: 'Copper Futures', sector: 'Commodities', assetType: 'future' },
    { ticker: 'ZC=F', name: 'Corn Futures', sector: 'Agriculture', assetType: 'future' },
    { ticker: 'ZW=F', name: 'Wheat Futures', sector: 'Agriculture', assetType: 'future' },

    // Crypto
    { ticker: 'BTC', name: 'Bitcoin', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'ETH', name: 'Ethereum', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'SOL', name: 'Solana', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'BNB', name: 'Binance Coin', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'XRP', name: 'XRP', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'ADA', name: 'Cardano', sector: 'Crypto', assetType: 'crypto' },
    { ticker: 'DOGE', name: 'Dogecoin', sector: 'Crypto', assetType: 'crypto' },

    // Financials
    { ticker: 'JPM', name: 'JPMorgan Chase & Co', sector: 'Financial', assetType: 'stock' },
    { ticker: 'BAC', name: 'Bank of America Corp', sector: 'Financial', assetType: 'stock' },
    { ticker: 'GS', name: 'Goldman Sachs Group', sector: 'Financial', assetType: 'stock' },
    { ticker: 'V', name: 'Visa Inc', sector: 'Financial', assetType: 'stock' },
    { ticker: 'MA', name: 'Mastercard Inc', sector: 'Financial', assetType: 'stock' },

    // Healthcare
    { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', assetType: 'stock' },
    { ticker: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', assetType: 'stock' },
    { ticker: 'PFE', name: 'Pfizer Inc', sector: 'Healthcare', assetType: 'stock' },
    { ticker: 'LLY', name: 'Eli Lilly and Co', sector: 'Healthcare', assetType: 'stock' },

    // Consumer
    { ticker: 'WMT', name: 'Walmart Inc', sector: 'Consumer Defensive', assetType: 'stock' },
    { ticker: 'COST', name: 'Costco Wholesale Corp', sector: 'Consumer Defensive', assetType: 'stock' },
    { ticker: 'PG', name: 'Procter & Gamble Co', sector: 'Consumer Defensive', assetType: 'stock' },
    { ticker: 'KO', name: 'Coca-Cola Co', sector: 'Consumer Defensive', assetType: 'stock' },
    { ticker: 'PEP', name: 'PepsiCo Inc', sector: 'Consumer Defensive', assetType: 'stock' },
    { ticker: 'MCD', name: 'McDonald\'s Corp', sector: 'Consumer Cyclical', assetType: 'stock' },
    { ticker: 'NKE', name: 'Nike Inc', sector: 'Consumer Cyclical', assetType: 'stock' },

    // Industrial
    { ticker: 'BA', name: 'Boeing Co', sector: 'Industrials', assetType: 'stock' },
    { ticker: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', assetType: 'stock' },
    { ticker: 'GE', name: 'General Electric Co', sector: 'Industrials', assetType: 'stock' },
    { ticker: 'HON', name: 'Honeywell International', sector: 'Industrials', assetType: 'stock' },
];

async function main() {
    console.log('Seeding tickers...');
    for (const ticker of tickers) {
        const upsert = await prisma.ticker.upsert({
            where: { ticker: ticker.ticker },
            update: {},
            create: {
                ticker: ticker.ticker,
                name: ticker.name,
                sector: ticker.sector,
                industry: 'Unknown', // Simply default
                assetType: ticker.assetType,
                isActive: true,
                marketCap: 0, // Placeholder
                exchange: 'Unknown', // Placeholder
                country: 'US', // Placeholder
            },
        });
        console.log(`Upserted ticker: ${upsert.ticker}`);
    }
    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        try {
            await prisma.$disconnect();
        } catch (e) {
            // ignore disconnect error
        }
    });
