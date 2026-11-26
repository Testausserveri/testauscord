-- AlterTable
ALTER TABLE "Server" ADD COLUMN "iconVersion" INTEGER;

-- CreateTable
CREATE TABLE "ServerIcon" (
    "serverId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "posterData" BYTEA,
    "posterContentType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerIcon_pkey" PRIMARY KEY ("serverId")
);

-- AddForeignKey
ALTER TABLE "ServerIcon" ADD CONSTRAINT "ServerIcon_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
