-- AlterTable: Add rawData and rawDataPurgedAt to report_jobs
-- rawData stores AES-256-GCM encrypted CSV snapshot (DPA compliance)
-- rawDataPurgedAt records when data was auto-deleted (90-day retention)

ALTER TABLE "report_jobs" ADD COLUMN "raw_data" TEXT;
ALTER TABLE "report_jobs" ADD COLUMN "raw_data_purged_at" TIMESTAMP(3);
