CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER,
    "permissions" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberRole" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "serverMemberId" TEXT NOT NULL,

    CONSTRAINT "MemberRole_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Role" ("id", "serverId", "name", "permissions", "position", "isDefault", "createdAt")
SELECT 'role-' || s."id", s."id", '@everyone', 0, 0, true, now()
FROM "Server" s
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" r WHERE r."serverId" = s."id" AND r."isDefault" = true
);

CREATE UNIQUE INDEX "Role_serverId_name_key" ON "Role"("serverId", "name");
CREATE UNIQUE INDEX "Role_serverId_lower_name_key" ON "Role"("serverId", lower("name"));
CREATE UNIQUE INDEX "Role_serverId_position_key" ON "Role"("serverId", "position");
CREATE INDEX "Role_serverId_idx" ON "Role"("serverId");
CREATE UNIQUE INDEX "MemberRole_roleId_serverMemberId_key" ON "MemberRole"("roleId", "serverMemberId");
CREATE INDEX "MemberRole_serverMemberId_idx" ON "MemberRole"("serverMemberId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_serverMemberId_fkey" FOREIGN KEY ("serverMemberId") REFERENCES "ServerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Role_serverId_default_key" ON "Role"("serverId") WHERE "isDefault" = true;
