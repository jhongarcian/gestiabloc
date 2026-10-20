CREATE TYPE "ServiceKind" AS ENUM ('GROUP', 'OFFERING');
ALTER TABLE "Service" ADD COLUMN "kind" "ServiceKind" NOT NULL DEFAULT 'GROUP';
ALTER TABLE "Service" ADD COLUMN "parentServiceId" TEXT;

-- Preserve existing service IDs and all enrollment/configuration relationships.
-- Existing flat catalogs get a neutral group; no service names are reinterpreted.
DO $$
DECLARE
  existing_tenant RECORD;
  group_id TEXT;
  group_name TEXT;
  name_suffix INTEGER;
BEGIN
  FOR existing_tenant IN SELECT DISTINCT "tenantId" FROM "Service" LOOP
    group_id := gen_random_uuid()::TEXT;
    group_name := 'Existing services';
    name_suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM "Service" WHERE "tenantId" = existing_tenant."tenantId"
      AND LOWER("name") = LOWER(group_name)
    ) LOOP
      name_suffix := name_suffix + 1;
      group_name := 'Existing services (' || name_suffix || ')';
    END LOOP;
    INSERT INTO "Service" ("id", "tenantId", "name", "kind", "basePriceCents", "createdAt", "updatedAt")
    VALUES (group_id, existing_tenant."tenantId", group_name, 'GROUP', 0, NOW(), NOW());
    UPDATE "Service" SET "kind" = 'OFFERING', "parentServiceId" = group_id
    WHERE "tenantId" = existing_tenant."tenantId" AND "id" <> group_id;
  END LOOP;
END $$;

ALTER TABLE "Service" ADD CONSTRAINT "Service_hierarchy_shape_check" CHECK (
  ("kind" = 'GROUP' AND "parentServiceId" IS NULL) OR
  ("kind" = 'OFFERING' AND "parentServiceId" IS NOT NULL AND "parentServiceId" <> "id")
);
ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_parentServiceId_fkey"
FOREIGN KEY ("tenantId", "parentServiceId") REFERENCES "Service"("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Service_tenantId_kind_parentServiceId_sortOrder_idx"
ON "Service"("tenantId", "kind", "parentServiceId", "sortOrder");
CREATE INDEX "Service_tenantId_parentServiceId_sortOrder_idx"
ON "Service"("tenantId", "parentServiceId", "sortOrder");

CREATE FUNCTION enforce_service_hierarchy() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kind" = 'OFFERING' THEN
    PERFORM 1 FROM "Service"
    WHERE "id" = NEW."parentServiceId" AND "tenantId" = NEW."tenantId" AND "kind" = 'GROUP'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A sub-service must belong to a parent service in the same tenant'
      USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "Service" WHERE "parentServiceId" = NEW."id") THEN
      RAISE EXCEPTION 'A service with sub-services cannot become a sub-service'
      USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Service_enforce_hierarchy"
BEFORE INSERT OR UPDATE OF "kind", "parentServiceId", "tenantId" ON "Service"
FOR EACH ROW EXECUTE FUNCTION enforce_service_hierarchy();
