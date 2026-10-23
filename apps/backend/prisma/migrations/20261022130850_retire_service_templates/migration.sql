-- DropIndex
DROP INDEX "ServiceStepOccurrence_one_active_per_enrollment";

-- RenameForeignKey
ALTER TABLE "ServiceStepMovement" RENAME CONSTRAINT "ServiceStepMovement_enrollment_fkey" TO "ServiceStepMovement_tenantId_contactServiceId_fkey";
