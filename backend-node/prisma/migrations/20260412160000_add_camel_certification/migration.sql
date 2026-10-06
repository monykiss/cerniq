-- CreateTable
CREATE TABLE IF NOT EXISTS "camel_certifications" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "certified_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "html_hash" TEXT NOT NULL,
    "camel_composite" DECIMAL(4,2) NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "certified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camel_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique per institution+period — one cert per period)
CREATE UNIQUE INDEX IF NOT EXISTS "institution_period_cert"
    ON "camel_certifications"("institution_id", "period");

-- CreateIndex (list certs by institution, most recent first)
CREATE INDEX IF NOT EXISTS "camel_certifications_institution_id_certified_at_idx"
    ON "camel_certifications"("institution_id", "certified_at" DESC);

-- AddForeignKey
ALTER TABLE "camel_certifications"
    ADD CONSTRAINT "camel_certifications_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
