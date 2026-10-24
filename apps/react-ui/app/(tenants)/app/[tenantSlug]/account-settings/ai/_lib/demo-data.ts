import type {
  ServiceFitFieldDefinition,
  ServiceFitRuleDraft,
  ServiceVerificationProfileDraft,
  ServiceKnowledgeProfileDraft,
} from "../../_components/service-fit-rules-tab"

export type AiHelperDraft = {
  name: string
  language: string
  tone: string
  instructions: string
}

export type AiCompanyDraft = {
  name: string
  description: string
  website: string
  email: string
  phone: string
  address: string
}

export type AiFaqDraft = { id: string; question: string; answer: string }
export type AiLinkSource = { id: string; label: string; url: string }
export type AiFileSource = {
  id: string
  name: string
  size: number
  type: string
}
export type AiKnowledgeDraft = {
  description: string
  links: AiLinkSource[]
  files: AiFileSource[]
  adapter: ServiceKnowledgeProfileDraft["adapter"]
  verification: Omit<ServiceVerificationProfileDraft, "sourceUrls">
}
export type AiRuleOption = {
  id: string
  name: string
  conditions: ServiceFitRuleDraft[]
}
export type AiRequirement = {
  id: string
  name: string
  options: AiRuleOption[]
}
export type AiQualificationDraft = {
  enabled: boolean
  summary: string
  requirements: AiRequirement[]
}
export type AiSkillDraft = {
  id: string
  parentName: string
  name: string
  tagline: string
  faqs: AiFaqDraft[]
  knowledge: AiKnowledgeDraft
  notes: { overview: string; pricing: string; checklist: string[] }
  qualification: AiQualificationDraft
}
export type AiWorkspaceDraft = {
  helper: AiHelperDraft
  company: AiCompanyDraft
  skills: AiSkillDraft[]
}

export const SAMPLE_FIELD_CATALOG: ServiceFitFieldDefinition[] = [
  {
    source: "derived",
    fieldKey: "age",
    label: "Age",
    description: null,
    valueType: "number",
    operators: [
      "greater_than_or_equal",
      "less_than_or_equal",
      "equals",
      "between",
    ],
    options: [],
  },
  {
    source: "core",
    fieldKey: "state",
    label: "State",
    description: null,
    valueType: "string",
    operators: ["equals", "not_equals"],
    options: [
      { value: "TX", label: "Texas" },
      { value: "IL", label: "Illinois" },
      { value: "CA", label: "California" },
    ],
  },
  {
    source: "core",
    fieldKey: "email",
    label: "Email address",
    description: null,
    valueType: "string",
    operators: ["is_not_empty", "is_empty", "contains"],
    options: [],
  },
  {
    source: "custom",
    fieldKey: "contactConsent",
    label: "Permission to contact",
    description: null,
    valueType: "boolean",
    operators: ["is_true", "is_false"],
    options: [],
  },
]

export function createCondition(
  id: string,
  requirementId: string,
  optionId: string,
  field = SAMPLE_FIELD_CATALOG[0],
): ServiceFitRuleDraft {
  return {
    id,
    source: field.source,
    fieldKey: field.fieldKey,
    valueType: field.valueType,
    operator: field.operators[0],
    compareValue:
      field.valueType === "number" ? 18 : (field.options[0]?.value ?? ""),
    required: true,
    requiredGroup: requirementId,
    requiredBranch: optionId,
    weight: 1,
    label: null,
    explanation: null,
  }
}

const sampleServices = [
  {
    id: "auto-insurance",
    parentName: "Personal insurance",
    name: "Auto Insurance",
    tagline: "Help drivers understand coverage and their next steps.",
    overview:
      "Compare personal auto coverage for drivers and their households. A licensed advisor confirms all coverage recommendations.",
    pricing:
      "Quotes depend on driving history, vehicle details, and selected coverage. Confirm the carrier quote before discussing a final premium.",
    checklist: [
      "Collect driver and vehicle information",
      "Review current coverage and renewal date",
      "Arrange a review with a licensed advisor",
    ],
  },
  {
    id: "home-insurance",
    parentName: "Personal insurance",
    name: "Home Insurance",
    tagline: "Guide homeowners through property and coverage questions.",
    overview:
      "Help homeowners prepare for a property insurance review, including dwelling details, possessions, and coverage needs.",
    pricing:
      "Premiums vary by property, location, deductible, and carrier. An advisor provides the final quote.",
    checklist: [
      "Confirm property address and occupancy",
      "Collect property and claims history",
      "Review dwelling and personal property needs",
    ],
  },
  {
    id: "business-insurance",
    parentName: "Business insurance",
    name: "Small Business Insurance",
    tagline: "Turn business questions into a clear coverage conversation.",
    overview:
      "Help small business owners prepare for a coverage review covering their operations, people, and property.",
    pricing:
      "Pricing depends on industry, revenue, payroll, and coverage limits. Refer specialized risks to the team.",
    checklist: [
      "Confirm business activities and locations",
      "Collect revenue and employee information",
      "Schedule a business coverage consultation",
    ],
  },
]

export const SAMPLE_SKILL_IDS = sampleServices.map(({ id }) => id)
export const SKILL_SECTION_LABELS = {
  faq: "FAQ",
  "knowledge-base": "Knowledge Base",
  "qualification-rules": "Qualification Rules",
} as const
export type SkillSection = keyof typeof SKILL_SECTION_LABELS

export function createSampleWorkspace(): AiWorkspaceDraft {
  return {
    helper: {
      name: "AI Helper",
      language: "English",
      tone: "Professional",
      instructions:
        "Be clear, helpful, and concise. Ask one question at a time. Refer coverage recommendations and final quotes to a licensed advisor.",
    },
    company: {
      name: "Harbor Insurance",
      description:
        "A fictional independent agency helping families and small businesses understand their insurance options.",
      website: "https://harbor.example",
      email: "hello@harbor.example",
      phone: "(312) 555-0142",
      address: "120 Harbor Avenue\nChicago, IL 60601",
    },
    skills: sampleServices.map((service) => {
      const requirementId = `${service.id}-contact`
      const optionId = `${service.id}-adult`
      return {
        id: service.id,
        parentName: service.parentName,
        name: service.name,
        tagline: service.tagline,
        notes: {
          overview: service.overview,
          pricing: service.pricing,
          checklist: [...service.checklist],
        },
        faqs: [
          {
            id: `${service.id}-faq-1`,
            question: "How do I get started?",
            answer:
              "Tell us a little about your needs. Our team will help you prepare the details for a coverage review.",
          },
          {
            id: `${service.id}-faq-2`,
            question: "Can you give me a final quote?",
            answer:
              "A licensed advisor will confirm the available options and provide a final carrier quote.",
          },
        ],
        knowledge: {
          description: service.overview,
          links: [
            {
              id: `${service.id}-link-1`,
              label: "Agency service guide",
              url: `https://harbor.example/services/${service.id}`,
            },
          ],
          files: [],
          adapter: "NONE",
          verification: {
            mode: "NONE",
            guidance:
              "Ask the team to confirm time-sensitive coverage or pricing details.",
            triggerKeywords: ["coverage", "premium", "renewal"],
          },
        },
        qualification: {
          enabled: true,
          summary:
            "Collect the basics before handing the conversation to an advisor.",
          requirements: [
            {
              id: requirementId,
              name: "Contact readiness",
              options: [
                {
                  id: optionId,
                  name: "Adult applicant",
                  conditions: [
                    createCondition(
                      `${service.id}-age`,
                      requirementId,
                      optionId,
                    ),
                    {
                      ...createCondition(
                        `${service.id}-consent`,
                        requirementId,
                        optionId,
                        SAMPLE_FIELD_CATALOG[3],
                      ),
                      compareValue: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      }
    }),
  }
}

export function draftSnapshots(
  draft: AiWorkspaceDraft,
): Record<string, string> {
  return Object.fromEntries([
    ["helper", JSON.stringify(draft.helper)],
    ["company", JSON.stringify(draft.company)],
    ...draft.skills.flatMap((skill) => [
      [`${skill.id}/faq`, JSON.stringify(skill.faqs)],
      [`${skill.id}/knowledge-base`, JSON.stringify(skill.knowledge)],
      [`${skill.id}/qualification-rules`, JSON.stringify(skill.qualification)],
    ]),
  ])
}

export function isSourceUrl(value: string) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function createDraftId() {
  return crypto.randomUUID()
}
