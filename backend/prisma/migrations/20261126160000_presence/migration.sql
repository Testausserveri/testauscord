CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'IDLE', 'DND', 'INVISIBLE');
ALTER TABLE "User" ADD COLUMN "presenceStatus" "PresenceStatus" NOT NULL DEFAULT 'ONLINE';
