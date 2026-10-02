import { z } from "zod"

import { contactTemplateCustomFieldKeys } from "./contact-templates.js"

const idSchema = z.string().trim().min(1).max(100)
const automationValueKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/)
const templateSchema = z.string().max(1_000)

export const AutomationCreateContactTypedSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIXED"), value: z.unknown() }).strict(),
  z.object({ type: z.literal("CONTACT_FIELD"), key: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal("CUSTOM_FIELD"), key: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal("AUTOMATION_VALUE"), key: automationValueKeySchema }).strict(),
])

export const AutomationCreateContactValueSourceSchema = z.union([
  z.object({ type: z.literal("TEMPLATE"), template: templateSchema }).strict(),
  AutomationCreateContactTypedSourceSchema,
])

export const AutomationCreateContactConfigSchema = z.object({
  actionName: z.string().trim().min(1).max(120),
  firstNameTemplate: templateSchema,
  middleNameTemplate: templateSchema.nullable().optional(),
  lastNameTemplate: templateSchema,
  emailTemplate: templateSchema.nullable().optional(),
  phoneTemplate: templateSchema.nullable().optional(),
  dateOfBirth: AutomationCreateContactTypedSourceSchema.nullable().optional(),
  statusConfigId: idSchema,
  customFieldValues: z.array(z.object({
    customFieldId: idSchema,
    source: AutomationCreateContactValueSourceSchema,
  }).strict()).max(20),
}).strict().superRefine((config, context) => {
  const seen = new Set<string>()
  config.customFieldValues.forEach((assignment, index) => {
    if (seen.has(assignment.customFieldId)) {
      context.addIssue({
        code: "custom",
        path: ["customFieldValues", index, "customFieldId"],
        message: "Each custom field can only be set once per action.",
      })
    }
    seen.add(assignment.customFieldId)
  })
})

export type AutomationCreateContactTypedSource = z.infer<typeof AutomationCreateContactTypedSourceSchema>
export type AutomationCreateContactValueSource = z.infer<typeof AutomationCreateContactValueSourceSchema>
export type AutomationCreateContactConfig = z.infer<typeof AutomationCreateContactConfigSchema>

export function createContactUsesTemplate(fieldType: string) {
  return fieldType === "TEXT" || fieldType === "TEXTAREA" || fieldType === "PHONE"
}

export function createContactSourceFieldIsCompatible(destinationType: string, sourceType: string) {
  if (destinationType === "NUMBER" || destinationType === "CURRENCY") {
    return sourceType === "NUMBER" || sourceType === "CURRENCY"
  }
  if (destinationType === "DATE") return sourceType === "DATE"
  if (destinationType === "SELECT" || destinationType === "RADIO") {
    return sourceType === "SELECT" || sourceType === "RADIO" || sourceType === "TEXT"
  }
  if (destinationType === "MULTI_SELECT") return sourceType === "MULTI_SELECT"
  if (destinationType === "CHECKBOX") return sourceType === "CHECKBOX"
  return false
}

export function createContactAutomationValueIsCompatible(destinationType: string, valueKind: string) {
  if (destinationType === "NUMBER" || destinationType === "CURRENCY") return valueKind === "NUMBER"
  if (destinationType === "DATE") return valueKind === "DATE"
  if (destinationType === "SELECT" || destinationType === "RADIO") return valueKind === "TEXT"
  return false
}

export function createContactConfigCustomFieldKeys(config: AutomationCreateContactConfig) {
  const keys = new Set<string>()
  for (const template of [
    config.firstNameTemplate,
    config.middleNameTemplate ?? "",
    config.lastNameTemplate,
    config.emailTemplate ?? "",
    config.phoneTemplate ?? "",
    ...config.customFieldValues.flatMap((assignment) =>
      assignment.source.type === "TEMPLATE" ? [assignment.source.template] : [],
    ),
  ]) {
    for (const key of contactTemplateCustomFieldKeys(template)) keys.add(key)
  }
  if (config.dateOfBirth?.type === "CUSTOM_FIELD") keys.add(config.dateOfBirth.key)
  for (const assignment of config.customFieldValues) {
    if (assignment.source.type === "CUSTOM_FIELD") keys.add(assignment.source.key)
  }
  return [...keys]
}
