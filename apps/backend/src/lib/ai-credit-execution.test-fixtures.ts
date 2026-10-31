// Synthetic configuration only; these are not real credentials.
export const creditTestEnv = {
  BILLING_ENABLED: "true", AI_CREDIT_ENFORCEMENT_ENABLED: "true", AI_CREDIT_MODEL_GATE_PASSED: "true", AI_PROVIDER_METERING_ENABLED: "true",
  AI_REPLAY_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
  STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
  STRIPE_PRICE_STARTER_MONTHLY: "price_starter", STRIPE_PRICE_PRO_MONTHLY: "price_pro", STRIPE_PRICE_BUSINESS_MONTHLY: "price_business",
}
