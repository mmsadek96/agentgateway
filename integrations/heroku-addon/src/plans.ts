export interface PlanDefinition {
  name: string;
  maxAgents: number;
  maxActionsPerMonth: number;
  features: string[];
}

export const plans: Record<string, PlanDefinition> = {
  free: {
    name: "Free",
    maxAgents: 3,
    maxActionsPerMonth: 1000,
    features: ["Basic reputation", "3 agents"],
  },
  starter: {
    name: "Starter",
    maxAgents: 25,
    maxActionsPerMonth: 50000,
    features: ["25 agents", "Behavioral tracking", "Dashboard"],
  },
  pro: {
    name: "Pro",
    maxAgents: 500,
    maxActionsPerMonth: 1000000,
    features: ["500 agents", "ML detection", "Priority support", "Custom scoring"],
  },
};

export function getPlan(slug: string): PlanDefinition | undefined {
  return plans[slug];
}
