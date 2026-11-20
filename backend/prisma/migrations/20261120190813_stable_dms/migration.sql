-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('DM', 'TEXT');

-- CreateEnum
CREATE TYPE "MessageFormat" AS ENUM ('TEXT', 'E2EE');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "dmKey" TEXT,
ADD COLUMN     "type" "ChannelType" NOT NULL DEFAULT 'DM';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientNonce" TEXT,
ADD COLUMN     "format" "MessageFormat" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_dmKey_key" ON "Channel"("dmKey");

-- CreateIndex
CREATE INDEX "Channel_serverId_idx" ON "Channel"("serverId");

-- CreateIndex
CREATE INDEX "Message_channelId_createdAt_id_idx" ON "Message"("channelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_channelId_senderId_clientNonce_key" ON "Message"("channelId", "senderId", "clientNonce");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move accepted friend requests into the new Friendship table
INSERT INTO "Friendship" ("id", "userAId", "userBId", "createdAt")
SELECT "id", LEAST("senderId", "receiverId"), GREATEST("senderId", "receiverId"), COALESCE("acceptedAt", "createdAt")
FROM "FriendRequest"
WHERE "status" = 'ACCEPTED'
ON CONFLICT ("userAId", "userBId") DO NOTHING;

-- Link legacy DM channels to the stable pair key
UPDATE "Channel" AS c
SET "dmKey" = LEAST(fr."senderId", fr."receiverId") || ':' || GREATEST(fr."senderId", fr."receiverId")
FROM "FriendRequest" AS fr
WHERE c."id" = fr."id" AND fr."status" = 'ACCEPTED';

-- Fallback for DM channels that already have exactly two members
UPDATE "Channel" AS c
SET "dmKey" = pair."dmKey"
FROM (
    SELECT
        "channelId",
        LEAST(MIN("userId"), MAX("userId")) || ':' || GREATEST(MIN("userId"), MAX("userId")) AS "dmKey"
    FROM "ChannelMember"
    GROUP BY "channelId"
    HAVING COUNT(*) = 2
) AS pair
WHERE c."id" = pair."channelId" AND c."dmKey" IS NULL AND c."serverId" IS NULL;

-- FriendRequest now only holds pending requests
DELETE FROM "FriendRequest" WHERE "status" IN ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "FriendRequest" DROP COLUMN "acceptedAt",
DROP COLUMN "status";

-- DropEnum
DROP TYPE "FriendRequestStatus";
