export type PlanKey = "STARTER" | "PRO" | "BUSINESS"

export type SubscriptionPlan = {
  key: PlanKey
  name: string
  audience: string
  description: string
  monthlyPrice: string
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
    name: "Basic",
    audience: "For small businesses, startups, and teams managing daily operations.",
    description:
      "A simple operational CRM with AI assistance for teams that need tasks, scheduling, and day-to-day coordination in one place.",
    monthlyPrice: "$29",
    seatLimit: 3,
    accent: "amber",
    features: [
      "Up to 3 team members",
      "Task management, calendar, and scheduling",
      "Real-time notifications and team assignments",
      "Internal comments and file attachments",
      "Basic dashboard and reporting",
      "Mobile-friendly interface",
      "AI assistant features with 100 AI actions per month",
      "5 GB file storage and email support",
    ],
    aiUsage: "Up to 100 AI actions per month",
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
    monthlyPrice: "$59",
    seatLimit: 10,
    accent: "stone",
    featured: true,
    features: [
      "Up to 10 team members",
      "Everything in Basic",
      "Advanced task management and custom categories",
      "Team and department organization",
      "Advanced scheduling, calendar management, and live updates",
      "Activity history and audit tracking",
      "Advanced dashboard, reporting, and exportable reports",
      "AI assistant features with 750 AI actions per month",
      "25 GB file storage and priority email support",
    ],
    aiUsage: "Up to 750 AI actions per month",
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
    monthlyPrice: "$119",
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
      "Advanced AI tools with 3,000 AI actions per month",
      "100 GB file storage and custom workflow support",
    ],
    aiUsage: "Up to 3,000 AI actions per month",
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
