-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "PipelineStatus" NOT NULL DEFAULT 'RUNNING',
    "tickers_processed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "duration_ms" INTEGER,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_prices" (
    "id" UUID NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,4),
    "high" DECIMAL(18,4),
    "low" DECIMAL(18,4),
    "close" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_prices_ticker_date_key" ON "market_prices"("ticker", "date");

-- CreateIndex
CREATE INDEX "market_prices_ticker_idx" ON "market_prices"("ticker");

-- CreateIndex
CREATE INDEX "market_prices_date_idx" ON "market_prices"("date");
