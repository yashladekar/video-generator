-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'GENERATE',
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "targetSceneId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "captionPosition" TEXT NOT NULL DEFAULT 'bottom',
ADD COLUMN     "musicMood" TEXT NOT NULL DEFAULT 'ambient',
ADD COLUMN     "musicVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
ADD COLUMN     "narrationStyle" TEXT NOT NULL DEFAULT 'conversational',
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'YOUTUBE',
ADD COLUMN     "subtitleStyle" TEXT NOT NULL DEFAULT 'bold',
ADD COLUMN     "visualStyle" TEXT NOT NULL DEFAULT 'cinematic',
ADD COLUMN     "voice" TEXT;
