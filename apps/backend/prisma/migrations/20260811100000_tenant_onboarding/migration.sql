CREATE TYPE "TenantOnboardingStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'SKIPPED',
  'COMPLETED'
);

ALTER TABLE "Tenant"
ADD COLUMN "onboardingStatus" "TenantOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "onboardingCurrentStep" TEXT NOT NULL DEFAULT 'welcome',
ADD COLUMN "onboardingStartedAt" TIMESTAMP(3),
ADD COLUMN "onboardingSkippedAt" TIMESTAMP(3),
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN "onboardingChecklistDismissedAt" TIMESTAMP(3);

UPDATE "Tenant"
SET
  "onboardingStatus" = 'COMPLETED',
  "onboardingCurrentStep" = 'ready',
  "onboardingCompletedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);
