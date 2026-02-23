import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import { createShopifyClient, ShopifyClient } from "./shopify";
import { createShopifyActions } from "./gateway-actions";
import {
  handleOrderCreated,
  handleOrderFulfilled,
  registerWebhooks,
} from "./webhooks";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || "read_products,write_draft_orders,read_orders";
const HOST = process.env.HOST || "localhost";

// ---------------------------------------------------------------------------
// In-memory session store  (shop domain -> access token)
// ---------------------------------------------------------------------------

const shopTokens: Map<string, string> = new Map();

/**
 * Retrieve (or throw) a ShopifyClient for a given shop domain.
 */
function getClientForShop(shop: string): ShopifyClient {
  const token = shopTokens.get(shop);
  if (!token) {
    throw new Error(`No access token stored for shop: ${shop}`);
  }
  return createShopifyClient(shop, token);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "agenttrust-shopify",
    shops_connected: shopTokens.size,
  });
});

// ---------------------------------------------------------------------------
// Shopify OAuth  (/auth and /auth/callback)
// ---------------------------------------------------------------------------

/**
 * Step 1 - Redirect the merchant to Shopify's OAuth consent screen.
 *
 * Usage: GET /auth?shop=example.myshopify.com
 */
app.get("/auth", (req: Request, res: Response) => {
  const shop = req.query.shop as string | undefined;

  if (!shop) {
    res.status(400).json({ error: "Missing required query parameter: shop" });
    return;
  }

  // SSRF protection: validate shop domain format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    res.status(400).json({ error: "Invalid shop domain. Must be a valid .myshopify.com domain" });
    return;
  }

  const redirectUri = `https://${HOST}/auth/callback`;
  const nonce = generateNonce();

  // Store nonce for CSRF verification (simple in-memory approach)
  (app as any).__oauthNonces = (app as any).__oauthNonces || new Map();
  (app as any).__oauthNonces.set(shop, nonce);

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;

  res.redirect(installUrl);
});

/**
 * Step 2 - Shopify redirects back here with a temporary code.
 *
 * We exchange the code for a permanent access token and store it.
 */
app.get("/auth/callback", async (req: Request, res: Response) => {
  const { shop, code, state } = req.query as Record<string, string>;

  if (!shop || !code) {
    res.status(400).json({ error: "Missing shop or code parameter" });
    return;
  }

  // SSRF protection
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    res.status(400).json({ error: "Invalid shop domain" });
    return;
  }

  // Verify CSRF nonce
  const storedNonce = ((app as any).__oauthNonces as Map<string, string>)?.get(
    shop
  );
  if (!storedNonce || storedNonce !== state) {
    res.status(403).json({ error: "Invalid state parameter (CSRF check failed)" });
    return;
  }
  ((app as any).__oauthNonces as Map<string, string>).delete(shop);

  try {
    // Exchange temporary code for permanent access token
    const tokenResponse = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          code,
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      res
        .status(500)
        .json({ error: "Token exchange failed", details: errorBody });
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      scope: string;
    };

    // Persist token in memory
    shopTokens.set(shop, tokenData.access_token);
    console.log(`[Auth] Shop installed: ${shop} (scopes: ${tokenData.scope})`);

    // Register webhooks for the newly-authenticated shop
    await registerWebhooks(shop, tokenData.access_token);

    res.json({
      success: true,
      shop,
      message: "AgentTrust gateway is now connected to your Shopify store.",
    });
  } catch (err: any) {
    console.error("[Auth] Callback error:", err);
    res.status(500).json({ error: "Authentication failed", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// AgentTrust Gateway  (/agent-gateway)
// ---------------------------------------------------------------------------

/**
 * Verify an agent certificate with the AgentTrust Station.
 * Returns the verified trust score — never trusts client-provided scores.
 */
async function verifyCertificate(
  authHeader: string | undefined
): Promise<{ score: number; agentId: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const STATION_URL =
    process.env.AGENTTRUST_STATION_URL ||
    "https://agentgateway-6f041c655eb3.herokuapp.com";

  try {
    const res = await fetch(`${STATION_URL}/certificates/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      success: boolean;
      data?: { score?: number; agentId?: string };
    };
    if (!data.success || !data.data) return null;

    return { score: data.data.score ?? 0, agentId: data.data.agentId ?? "unknown" };
  } catch {
    return null;
  }
}

/**
 * The gateway endpoint accepts action requests from AI agents.
 *
 * Agents MUST provide a valid AgentTrust certificate in the
 * Authorization header. The trust score is read from the verified
 * certificate — never from the request body.
 */
const shopifyActions = createShopifyActions(() => {
  throw new Error("Shop client not initialised for this request");
});

app.post("/agent-gateway", async (req: Request, res: Response) => {
  const { shop, action, params } = req.body;

  if (!shop || !action) {
    res.status(400).json({ error: "Missing required fields: shop, action" });
    return;
  }

  // Certificate verification — single point of entry enforcement
  const verified = await verifyCertificate(req.headers.authorization);
  if (!verified) {
    res.status(401).json({
      error: "Valid AgentTrust certificate required",
      hint: "Obtain a certificate from the AgentTrust Station and pass it as a Bearer token",
    });
    return;
  }

  const actionDef = shopifyActions[action];
  if (!actionDef) {
    res.status(404).json({
      error: `Unknown action: ${action}`,
      available_actions: Object.keys(shopifyActions),
    });
    return;
  }

  // Enforce minimum trust score from VERIFIED certificate (not request body)
  if (verified.score < actionDef.minScore) {
    res.status(403).json({
      error: "Insufficient trust score",
      required: actionDef.minScore,
      verified_score: verified.score,
      action,
    });
    return;
  }

  // Validate required parameters
  for (const [paramName, paramDef] of Object.entries(actionDef.parameters)) {
    if (paramDef.required && (params === undefined || params[paramName] === undefined)) {
      res.status(400).json({
        error: `Missing required parameter: ${paramName}`,
        parameter: paramDef,
      });
      return;
    }
  }

  try {
    const client = getClientForShop(shop);
    const requestActions = createShopifyActions(() => client);
    const result = await requestActions[action].handler(params || {});

    res.json({ success: true, action, result, agent: verified.agentId });
  } catch (err: any) {
    console.error(`[Gateway] Action "${action}" failed:`, err);
    res.status(500).json({ error: err.message, action });
  }
});

// ---------------------------------------------------------------------------
// Webhook receivers
// ---------------------------------------------------------------------------

app.post("/webhooks/orders-create", (req: Request, res: Response) => {
  const shop = req.headers["x-shopify-shop-domain"] as string;
  handleOrderCreated("orders/create", shop, req.body);
  res.status(200).send("OK");
});

app.post("/webhooks/orders-fulfilled", (req: Request, res: Response) => {
  const shop = req.headers["x-shopify-shop-domain"] as string;
  handleOrderFulfilled("orders/fulfilled", shop, req.body);
  res.status(200).send("OK");
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`AgentTrust Shopify gateway listening on port ${PORT}`);
  console.log(`  Health:   http://localhost:${PORT}/health`);
  console.log(`  Auth:     http://localhost:${PORT}/auth?shop=SHOP_DOMAIN`);
  console.log(`  Gateway:  http://localhost:${PORT}/agent-gateway`);
});

export default app;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateNonce(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
