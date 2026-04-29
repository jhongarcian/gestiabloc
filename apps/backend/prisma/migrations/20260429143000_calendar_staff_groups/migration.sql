CREATE TABLE "CalendarStaffGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarStaffGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarStaffGroupMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarStaffGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarStaffGroup_tenantId_id_key"
ON "CalendarStaffGroup"("tenantId", "id");

CREATE UNIQUE INDEX "CalendarStaffGroup_tenantId_name_key"
ON "CalendarStaffGroup"("tenantId", "name");

CREATE INDEX "CalendarStaffGroup_tenantId_name_idx"
ON "CalendarStaffGroup"("tenantId", "name");

CREATE UNIQUE INDEX "CalendarStaffGroupMember_groupId_userId_key"
ON "CalendarStaffGroupMember"("groupId", "userId");

CREATE UNIQUE INDEX "CalendarStaffGroupMember_tenantId_id_key"
ON "CalendarStaffGroupMember"("tenantId", "id");

CREATE INDEX "CalendarStaffGroupMember_tenantId_groupId_idx"
ON "CalendarStaffGroupMember"("tenantId", "groupId");

CREATE INDEX "CalendarStaffGroupMember_tenantId_userId_idx"
ON "CalendarStaffGroupMember"("tenantId", "userId");

ALTER TABLE "CalendarStaffGroup"
ADD CONSTRAINT "CalendarStaffGroup_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarStaffGroupMember"
ADD CONSTRAINT "CalendarStaffGroupMember_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarStaffGroupMember"
ADD CONSTRAINT "CalendarStaffGroupMember_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "CalendarStaffGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarStaffGroupMember"
ADD CONSTRAINT "CalendarStaffGroupMember_tenantId_userId_fkey"
FOREIGN KEY ("tenantId", "userId") REFERENCES "Membership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarStaffGroupMember"
ADD CONSTRAINT "CalendarStaffGroupMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
