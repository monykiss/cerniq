CREATE TABLE IF NOT EXISTS "cooperativa_org_profiles" (
  "id" TEXT NOT NULL,
  "prospect_institution_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "region" TEXT,
  "municipality" TEXT,
  "regulator" TEXT NOT NULL DEFAULT 'COSSEC',
  "structure_version" TEXT NOT NULL DEFAULT '2026.1',
  "member_count_estimate" INTEGER,
  "metadata" JSONB,
  "last_seeded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cooperativa_org_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cooperativa_org_profiles_prospect_institution_id_key"
  ON "cooperativa_org_profiles"("prospect_institution_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cooperativa_org_profiles_slug_key"
  ON "cooperativa_org_profiles"("slug");
CREATE INDEX IF NOT EXISTS "cooperativa_org_profiles_region_idx"
  ON "cooperativa_org_profiles"("region");

CREATE TABLE IF NOT EXISTS "cooperativa_org_units" (
  "id" TEXT NOT NULL,
  "org_profile_id" TEXT NOT NULL,
  "unit_key" TEXT NOT NULL,
  "name_es" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cooperativa_org_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cooperativa_org_units_org_profile_id_unit_key_key"
  ON "cooperativa_org_units"("org_profile_id", "unit_key");
CREATE INDEX IF NOT EXISTS "cooperativa_org_units_org_profile_id_sort_order_idx"
  ON "cooperativa_org_units"("org_profile_id", "sort_order");

CREATE TABLE IF NOT EXISTS "cooperativa_leadership_seats" (
  "id" TEXT NOT NULL,
  "org_profile_id" TEXT NOT NULL,
  "org_unit_id" TEXT,
  "role_key" TEXT NOT NULL,
  "title_es" TEXT NOT NULL,
  "title_en" TEXT NOT NULL,
  "decision_tier" TEXT NOT NULL,
  "alm_buyer_priority" INTEGER NOT NULL DEFAULT 50,
  "reports_to_role_key" TEXT,
  "full_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "linkedin_url" TEXT,
  "is_primary_buyer" BOOLEAN NOT NULL DEFAULT false,
  "is_placeholder" BOOLEAN NOT NULL DEFAULT true,
  "provenance" TEXT NOT NULL DEFAULT 'org_template',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cooperativa_leadership_seats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cooperativa_leadership_seats_org_profile_id_role_key_key"
  ON "cooperativa_leadership_seats"("org_profile_id", "role_key");
CREATE INDEX IF NOT EXISTS "cooperativa_leadership_seats_org_profile_id_alm_buyer_priority_idx"
  ON "cooperativa_leadership_seats"("org_profile_id", "alm_buyer_priority");
CREATE INDEX IF NOT EXISTS "cooperativa_leadership_seats_org_profile_id_is_primary_buyer_idx"
  ON "cooperativa_leadership_seats"("org_profile_id", "is_primary_buyer");

DO $$ BEGIN
  ALTER TABLE "cooperativa_org_profiles"
    ADD CONSTRAINT "cooperativa_org_profiles_prospect_institution_id_fkey"
    FOREIGN KEY ("prospect_institution_id") REFERENCES "prospect_institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cooperativa_org_units"
    ADD CONSTRAINT "cooperativa_org_units_org_profile_id_fkey"
    FOREIGN KEY ("org_profile_id") REFERENCES "cooperativa_org_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cooperativa_leadership_seats"
    ADD CONSTRAINT "cooperativa_leadership_seats_org_profile_id_fkey"
    FOREIGN KEY ("org_profile_id") REFERENCES "cooperativa_org_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cooperativa_leadership_seats"
    ADD CONSTRAINT "cooperativa_leadership_seats_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "cooperativa_org_units"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
