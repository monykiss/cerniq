-- ALM Enterprise Models

CREATE TABLE IF NOT EXISTS "institutions" (
    "id" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "total_assets" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reporting_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "balance_sheet_items" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "reprice_date" TIMESTAMP(3),
    "maturity_date" TIMESTAMP(3),
    "rate_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "interest_rate_scenarios" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shift_bps" INTEGER NOT NULL,
    "ni_impact" DOUBLE PRECISION NOT NULL,
    "mve_impact" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_rate_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "liquidity_positions" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hqla_level1" DOUBLE PRECISION NOT NULL,
    "hqla_level2" DOUBLE PRECISION NOT NULL,
    "cash_outflows" DOUBLE PRECISION NOT NULL,
    "cash_inflows" DOUBLE PRECISION NOT NULL,
    "lcr" DOUBLE PRECISION NOT NULL,
    "nsfr" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidity_positions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "institutions_workspace_id_idx" ON "institutions"("workspace_id");
CREATE INDEX IF NOT EXISTS "balance_sheet_items_institution_id_idx" ON "balance_sheet_items"("institution_id");
CREATE INDEX IF NOT EXISTS "interest_rate_scenarios_institution_id_idx" ON "interest_rate_scenarios"("institution_id");
CREATE INDEX IF NOT EXISTS "liquidity_positions_institution_id_idx" ON "liquidity_positions"("institution_id");

-- Foreign keys
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "balance_sheet_items" ADD CONSTRAINT "balance_sheet_items_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interest_rate_scenarios" ADD CONSTRAINT "interest_rate_scenarios_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "liquidity_positions" ADD CONSTRAINT "liquidity_positions_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
