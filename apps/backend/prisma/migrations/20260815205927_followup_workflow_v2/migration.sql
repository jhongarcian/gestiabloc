-- DropIndex
DROP INDEX "ContactServiceFollowUpStep_one_active_v2_run_key";

-- RenameIndex
ALTER INDEX "ServiceFollowUpExecutionLog_tenantId_templateVersionId_createdA" RENAME TO "ServiceFollowUpExecutionLog_tenantId_templateVersionId_crea_idx";

-- RenameIndex
ALTER INDEX "ServiceFollowUpTemplateVersion_tenantId_templateId_publishedAt_" RENAME TO "ServiceFollowUpTemplateVersion_tenantId_templateId_publishe_idx";
