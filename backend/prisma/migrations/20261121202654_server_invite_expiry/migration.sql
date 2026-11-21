-- AlterTable
ALTER TABLE "ServerInvite" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Existing invites get a seven day grace period
UPDATE "ServerInvite" SET "expiresAt" = now() + interval '7 days';

ALTER TABLE "ServerInvite" ALTER COLUMN "expiresAt" SET NOT NULL;
