ALTER TABLE "ServerInvite" ADD COLUMN "channelId" TEXT;

CREATE INDEX "ServerInvite_channelId_idx" ON "ServerInvite"("channelId");

ALTER TABLE "ServerInvite" ADD CONSTRAINT "ServerInvite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
