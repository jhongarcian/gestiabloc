export type PlanKey = "STARTER" | "PRO" | "BUSINESS"

export type SubscriptionPlan = {
  key: PlanKey
  name: string
  audience: string
  description: string
  monthlyPrice: string
  monthlyPriceCents: number
  currency: "usd"
  trialEnabled: false
  aiCreditsPerMonth: number
  storageBytes: number
  seatLimit: number
  accent: string
  featured?: boolean
  features: string[]
  aiUsage: string
  storage: string
  support: string
  idealFor: string[]
}

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    key: "STARTER",
    name: "Starter",
    audience: "For small businesses, startups, and teams managing daily operations.",
    description:
      "A simple operational CRM with AI assistance for teams that need tasks, scheduling, and day-to-day coordination in one place.",
    monthlyPrice: "$49",
    monthlyPriceCents: 4900,
    currency: "usd",
    trialEnabled: false,
    aiCreditsPerMonth: 1200,
    storageBytes: 5 * 1024 * 1024 * 1024,
    seatLimit: 3,
    accent: "amber",
    features: [
      "Up to 3 team members",
      "Task management, calendar, and scheduling",
      "Real-time notifications and team assignments",
      "Internal comments and file attachments",
      "Basic dashboard and reporting",
      "Mobile-friendly interface",
      "AI assistant features with 1,200 AI credits per month",
      "5 GB file storage and email support",
    ],
    aiUsage: "Up to 1,200 AI credits per month",
    storage: "5 GB included",
    support: "Email support",
    idealFor: [
      "Small businesses",
      "Startups",
      "Small agencies",
      "Teams managing daily operations and tasks",
    ],
  },
  {
    key: "PRO",
    name: "Pro",
    audience: "For growing teams and businesses managing multiple workflows and staff.",
    description:
      "Advanced operational management, collaboration tools, and expanded AI capacity for teams that need more structure and coordination.",
    monthlyPrice: "$99",
    monthlyPriceCents: 9900,
    currency: "usd",
    trialEnabled: false,
    aiCreditsPerMonth: 2400,
    storageBytes: 25 * 1024 * 1024 * 1024,
    seatLimit: 10,
    accent: "stone",
    featured: true,
    features: [
      "Up to 10 team members",
      "Everything in Starter",
      "Advanced task management and custom categories",
      "Team and department organization",
      "Advanced scheduling, calendar management, and live updates",
      "Activity history and audit tracking",
      "Advanced dashboard, reporting, and exportable reports",
      "AI assistant features with 2,400 AI credits per month",
      "25 GB file storage and priority email support",
    ],
    aiUsage: "Up to 2,400 AI credits per month",
    storage: "25 GB included",
    support: "Priority email support",
    idealFor: [
      "Growing businesses",
      "Operations teams",
      "Agencies",
      "Multi-user organizations",
      "Teams managing multiple workflows and staff",
    ],
  },
  {
    key: "BUSINESS",
    name: "Business",
    audience: "For larger organizations that need advanced collaboration, analytics, and scalability.",
    description:
      "A high-capacity operational plan for organizations that need advanced permissions, reporting, infrastructure priority, and stronger AI support.",
    monthlyPrice: "$199",
    monthlyPriceCents: 19900,
    currency: "usd",
    trialEnabled: false,
    aiCreditsPerMonth: 4800,
    storageBytes: 100 * 1024 * 1024 * 1024,
    seatLimit: 25,
    accent: "emerald",
    features: [
      "Up to 25 team members",
      "Everything in Pro",
      "Multi-team and multi-department management",
      "Advanced permissions, roles, and audit logs",
      "Advanced analytics, reporting, API access, and webhooks",
      "Priority real-time infrastructure",
      "Dedicated onboarding assistance and priority support",
      "Advanced AI tools with 4,800 AI credits per month",
      "100 GB file storage and custom workflow support",
    ],
    aiUsage: "Up to 4,800 AI credits per month",
    storage: "100 GB included",
    support: "Priority support and dedicated onboarding assistance",
    idealFor: [
      "Medium and large businesses",
      "Multi-location organizations",
      "Operations-heavy companies",
      "Teams with large staff management requirements",
      "Businesses requiring advanced operational visibility",
    ],
  },
]

export function isPlanKey(value: string | null | undefined): value is PlanKey {
  return subscriptionPlans.some((plan) => plan.key === value)
}

export function getPlanByKey(planKey: PlanKey) {
  return subscriptionPlans.find((plan) => plan.key === planKey) ?? subscriptionPlans[0]
}

// Checkout activation remains gated by backend billing configuration.
export const aiCreditPacks = {
  AI_1000: { credits: 1000, priceCents: 500, currency: "usd" },
  AI_5000: { credits: 5000, priceCents: 2400, currency: "usd" },
  AI_10000: { credits: 10000, priceCents: 4500, currency: "usd" },
} as const
