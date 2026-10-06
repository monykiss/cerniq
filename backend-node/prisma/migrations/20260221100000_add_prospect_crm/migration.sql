-- CreateEnum
CREATE TYPE "ProspectStage" AS ENUM ('lead', 'contacted', 'demo_scheduled', 'demo_done', 'proposal', 'closed_won', 'closed_lost');

-- CreateTable
CREATE TABLE "prospects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "role" TEXT,
    "stage" "ProspectStage" NOT NULL DEFAULT 'lead',
    "source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospects_stage_idx" ON "prospects"("stage");
