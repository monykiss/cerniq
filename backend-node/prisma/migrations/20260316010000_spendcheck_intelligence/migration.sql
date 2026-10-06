-- AlterTable: Add SpendCheck anomaly detection columns to expenses
ALTER TABLE "expenses" ADD COLUMN "invoice_hash" TEXT;
ALTER TABLE "expenses" ADD COLUMN "anomaly_flags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "expenses" ADD COLUMN "risk_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "review_status" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "expenses_invoice_hash_idx" ON "expenses"("invoice_hash");
