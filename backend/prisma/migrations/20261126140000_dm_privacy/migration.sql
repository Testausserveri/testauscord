ALTER TABLE "User" ADD COLUMN "allowDmsFromServerMembers" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "ChannelMember" ("id", "channelId", "userId")
SELECT gen_random_uuid()::text, c."id", u."id"
FROM "Channel" c
CROSS JOIN LATERAL (
  VALUES (split_part(c."dmKey", ':', 1)), (split_part(c."dmKey", ':', 2))
) AS parts("userId")
JOIN "User" u ON u."id" = parts."userId"
WHERE c."type" = 'DM' AND c."dmKey" IS NOT NULL
ON CONFLICT ("channelId", "userId") DO NOTHING;
