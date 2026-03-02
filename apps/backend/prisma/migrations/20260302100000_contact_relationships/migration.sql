-- CreateEnum
CREATE TYPE "ContactRelationshipType" AS ENUM (
  'FATHER',
  'MOTHER',
  'PARENT',
  'SON',
  'DAUGHTER',
  'CHILD',
  'HUSBAND',
  'WIFE',
  'SPOUSE',
  'PARTNER',
  'BROTHER',
  'SISTER',
  'SIBLING',
  'GRANDFATHER',
  'GRANDMOTHER',
  'GRANDPARENT',
  'GRANDSON',
  'GRANDDAUGHTER',
  'GRANDCHILD',
  'UNCLE',
  'AUNT',
  'AUNT_OR_UNCLE',
  'NEPHEW',
  'NIECE',
  'NIECE_OR_NEPHEW',
  'COUSIN',
  'GUARDIAN',
  'WARD',
  'CAREGIVER',
  'DEPENDENT',
  'FRIEND',
  'OTHER'
);

-- CreateTable
CREATE TABLE "ContactRelationship" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "relatedContactId" TEXT NOT NULL,
    "relationshipType" "ContactRelationshipType" NOT NULL,
    "reciprocalRelationshipType" "ContactRelationshipType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactRelationship_tenantId_contactId_relatedContactId_key" ON "ContactRelationship"("tenantId", "contactId", "relatedContactId");

-- CreateIndex
CREATE INDEX "ContactRelationship_tenantId_contactId_idx" ON "ContactRelationship"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ContactRelationship_tenantId_relatedContactId_idx" ON "ContactRelationship"("tenantId", "relatedContactId");

-- AddForeignKey
ALTER TABLE "ContactRelationship" ADD CONSTRAINT "ContactRelationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRelationship" ADD CONSTRAINT "ContactRelationship_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRelationship" ADD CONSTRAINT "ContactRelationship_relatedContactId_fkey" FOREIGN KEY ("relatedContactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
