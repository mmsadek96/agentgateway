import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getPlan } from "./plans";

const router = Router();

// In-memory store mapping Heroku resource UUID -> developer info
const resourceMap = new Map<
  string,
  {
    uuid: string;
    plan: string;
    region: string;
    apiKey: string;
    agentId: string;
    email: string;
    createdAt: string;
  }
>();

const STATION_URL = process.env.STATION_URL || "https://station.agenttrust.dev";

/**
 * POST /heroku/resources - Provision a new add-on resource
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { uuid, plan, region } = req.body;

    if (!uuid || !plan) {
      return res.status(400).json({ error: "Missing uuid or plan" });
    }

    const planDef = getPlan(plan);
    if (!planDef) {
      return res.status(400).json({ error: `Unknown plan: ${plan}` });
    }

    const email = `${uuid}@heroku-addon.agenttrust.dev`;

    // Register developer with the Station API
    let apiKey: string;
    let agentId: string;

    try {
      const registerRes = await fetch(`${STATION_URL}/api/v1/developers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "heroku-addon",
          plan,
        }),
      });

      if (!registerRes.ok) {
        throw new Error(`Station API returned ${registerRes.status}`);
      }

      const devData = (await registerRes.json()) as { apiKey: string };
      apiKey = devData.apiKey;

      // Register agent
      const agentRes = await fetch(`${STATION_URL}/api/v1/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: `heroku-${uuid}`,
          source: "heroku-addon",
        }),
      });

      if (!agentRes.ok) {
        throw new Error(`Station API agent register returned ${agentRes.status}`);
      }

      const agentData = (await agentRes.json()) as { agentId: string };
      agentId = agentData.agentId;
    } catch (err) {
      console.error("Station API error during provisioning:", err);
      // Fallback: generate local credentials so provisioning does not fail
      apiKey = `at_${crypto.randomBytes(24).toString("hex")}`;
      agentId = `agent_${crypto.randomBytes(16).toString("hex")}`;
    }

    // Store the resource mapping
    resourceMap.set(uuid, {
      uuid,
      plan,
      region: region || "us",
      apiKey,
      agentId,
      email,
      createdAt: new Date().toISOString(),
    });

    console.log(`Provisioned resource ${uuid} on plan ${plan} in region ${region || "us"}`);

    return res.status(201).json({
      id: uuid,
      config: {
        AGENTTRUST_STATION_URL: STATION_URL,
        AGENTTRUST_API_KEY: apiKey,
        AGENTTRUST_AGENT_ID: agentId,
      },
      message: `AgentTrust ${planDef.name} plan provisioned successfully`,
    });
  } catch (err) {
    console.error("Provisioning error:", err);
    return res.status(500).json({ error: "Internal server error during provisioning" });
  }
});

/**
 * PUT /heroku/resources/:id - Plan change
 */
router.put("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body;

  const resource = resourceMap.get(id);
  if (!resource) {
    console.warn(`Plan change requested for unknown resource: ${id}`);
    return res.status(200).json({ message: "OK" });
  }

  const planDef = getPlan(plan);
  if (!planDef) {
    return res.status(400).json({ error: `Unknown plan: ${plan}` });
  }

  const oldPlan = resource.plan;
  resource.plan = plan;
  resourceMap.set(id, resource);

  console.log(`Plan change for resource ${id}: ${oldPlan} -> ${plan}`);

  return res.status(200).json({
    message: `Plan changed from ${oldPlan} to ${plan}`,
  });
});

/**
 * DELETE /heroku/resources/:id - Deprovision
 */
router.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  const resource = resourceMap.get(id);
  if (resource) {
    console.log(`Deprovisioning resource ${id} (plan: ${resource.plan})`);
    resourceMap.delete(id);
  } else {
    console.warn(`Deprovision requested for unknown resource: ${id}`);
  }

  return res.status(200).json({ message: "OK" });
});

export { resourceMap };
export default router;
