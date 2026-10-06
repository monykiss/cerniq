-- AlterTable: add owner_id to workspaces
ALTER TABLE "workspaces" ADD COLUMN "owner_id" UUID;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
