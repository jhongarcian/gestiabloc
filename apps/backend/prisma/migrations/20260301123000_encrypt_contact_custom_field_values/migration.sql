ALTER TABLE "ContactCustomFieldValue"
ADD COLUMN     "valueCiphertext" TEXT,
ADD COLUMN     "valueIv" TEXT,
ADD COLUMN     "valueAuthTag" TEXT,
ADD COLUMN     "valueKeyVersion" INTEGER;
