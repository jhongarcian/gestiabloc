CREATE TABLE "ContactServiceNoteAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactServiceNoteAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactServiceNoteAttachment_tenantId_noteId_fileId_key"
ON "ContactServiceNoteAttachment"("tenantId", "noteId", "fileId");

CREATE INDEX "ContactServiceNoteAttachment_tenantId_noteId_idx"
ON "ContactServiceNoteAttachment"("tenantId", "noteId");

CREATE INDEX "ContactServiceNoteAttachment_tenantId_fileId_idx"
ON "ContactServiceNoteAttachment"("tenantId", "fileId");

ALTER TABLE "ContactServiceNoteAttachment"
ADD CONSTRAINT "ContactServiceNoteAttachment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceNoteAttachment"
ADD CONSTRAINT "ContactServiceNoteAttachment_noteId_fkey"
FOREIGN KEY ("noteId") REFERENCES "ContactServiceNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceNoteAttachment"
ADD CONSTRAINT "ContactServiceNoteAttachment_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
