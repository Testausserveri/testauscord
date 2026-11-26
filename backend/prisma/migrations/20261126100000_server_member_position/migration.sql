-- AlterTable
ALTER TABLE "ServerMember" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "ServerMember" AS sm
SET "position" = ranked.position
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "userId" ORDER BY "joinedAt", "id") - 1)::int AS position
  FROM "ServerMember"
) AS ranked
WHERE sm."id" = ranked."id";

-- CreateIndex
CREATE INDEX "ServerMember_userId_position_idx" ON "ServerMember"("userId", "position");
