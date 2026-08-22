-- V2 versions remain immutable. New workflow versions default to the linear V3 definition.
ALTER TABLE "ServiceFollowUpTemplateVersion"
ALTER COLUMN "schemaVersion" SET DEFAULT 3;
