-- Retain only the newest challenge for each user before enforcing one active challenge.
DELETE FROM "LoginChallenge" AS older
USING "LoginChallenge" AS newer
WHERE older."userId" = newer."userId"
  AND (
    older."createdAt" < newer."createdAt"
    OR (older."createdAt" = newer."createdAt" AND older."id" < newer."id")
  );

ALTER TABLE "LoginChallenge"
ADD COLUMN "otpSendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "otpLastSentAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "LoginChallenge_userId_idx";
CREATE UNIQUE INDEX "LoginChallenge_userId_key" ON "LoginChallenge"("userId");
