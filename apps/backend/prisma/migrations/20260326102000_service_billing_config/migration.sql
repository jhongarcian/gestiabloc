CREATE TYPE "InstallmentFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

ALTER TABLE "Service"
ADD COLUMN "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "installmentCount" INTEGER,
ADD COLUMN "installmentFrequency" "InstallmentFrequency";
