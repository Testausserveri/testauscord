-- CreateTable
CREATE TABLE "ChannelCategory" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelCategory_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "categoryId" TEXT,
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill created order for existing server channels
UPDATE "Channel"
SET "position" = ranked.position
FROM (
    SELECT "id", (row_number() OVER (PARTITION BY "serverId" ORDER BY "createdAt", "id") - 1)::int AS position
    FROM "Channel"
    WHERE "serverId" IS NOT NULL
) AS ranked
WHERE "Channel"."id" = ranked."id";

-- CreateIndex
CREATE INDEX "Channel_categoryId_idx" ON "Channel"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelCategory_serverId_name_key" ON "ChannelCategory"("serverId", "name");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChannelCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCategory" ADD CONSTRAINT "ChannelCategory_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
