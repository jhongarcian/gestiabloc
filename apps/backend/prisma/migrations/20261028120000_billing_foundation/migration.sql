-- Additive only: preserve all existing subscription status and tenant data.
ALTER TABLE "TenantSubscription"
  ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
  ADD COLUMN "paidThrough" TIMESTAMP(3),
  ADD COLUMN "graceEndsAt" TIMESTAMP(3),
  ADD COLUMN "scheduledPlanKey" "PlanKey",
  ADD COLUMN "scheduledChangeAt" TIMESTAMP(3),
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billingRevision" INTEGER NOT NULL DEFAULT 0;
