-- AlterTable
ALTER TABLE "PublishingJob" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "privacyStatus" TEXT NOT NULL DEFAULT 'private';
