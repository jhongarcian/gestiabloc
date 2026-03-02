CREATE TABLE "ContactNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactNoteAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactNoteAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactNote_tenantId_id_key"
ON "ContactNote"("tenantId", "id");

CREATE INDEX "ContactNote_tenantId_contactId_createdAt_idx"
ON "ContactNote"("tenantId", "contactId", "createdAt");

CREATE INDEX "ContactNote_tenantId_createdById_idx"
ON "ContactNote"("tenantId", "createdById");

CREATE UNIQUE INDEX "ContactNoteAttachment_tenantId_noteId_fileId_key"
ON "ContactNoteAttachment"("tenantId", "noteId", "fileId");

CREATE INDEX "ContactNoteAttachment_tenantId_noteId_idx"
ON "ContactNoteAttachment"("tenantId", "noteId");

CREATE INDEX "ContactNoteAttachment_tenantId_fileId_idx"
ON "ContactNoteAttachment"("tenantId", "fileId");

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNoteAttachment"
ADD CONSTRAINT "ContactNoteAttachment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNoteAttachment"
ADD CONSTRAINT "ContactNoteAttachment_noteId_fkey"
FOREIGN KEY ("noteId") REFERENCES "ContactNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNoteAttachment"
ADD CONSTRAINT "ContactNoteAttachment_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
