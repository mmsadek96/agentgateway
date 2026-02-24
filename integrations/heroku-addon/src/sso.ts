import { Router, Request, Response } from "express";
import crypto from "crypto";
import { resourceMap } from "./provision";

const router = Router();

const SSO_SALT = process.env.SSO_SALT || "";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://dashboard.agenttrust.dev";

// Fail fast if SSO salt is not configured or uses placeholder
if (!SSO_SALT || SSO_SALT.startsWith("REPLACE")) {
  console.error("FATAL: SSO_SALT environment variable is not configured. SSO will reject all requests.");
}

/**
 * Validate the Heroku SSO signature.
 * Expected token: sha1(resource_id + ':' + sso_salt + ':' + timestamp)
 * Uses timing-safe comparison to prevent timing attacks.
 */
function validateSSOSignature(
  resourceId: string,
  timestamp: string,
  token: string
): boolean {
  if (!SSO_SALT || SSO_SALT.startsWith("REPLACE")) {
    return false;
  }

  const expected = crypto
    .createHash("sha1")
    .update(`${resourceId}:${SSO_SALT}:${timestamp}`)
    .digest("hex");

  // Timing-safe comparison
  const expectedBuf = Buffer.from(expected, "hex");
  const tokenBuf = Buffer.from(token, "hex");
  if (expectedBuf.length !== tokenBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
}

/**
 * GET /heroku/sso - SSO login from Heroku dashboard
 *
 * Heroku sends: id (resource_id), timestamp, token, nav-data, email
 */
router.post("/", (req: Request, res: Response) => {
  const { id, timestamp, token, "nav-data": navData, email } = req.body;

  if (!id || !timestamp || !token) {
    return res.status(400).json({ error: "Missing required SSO parameters" });
  }

  // Verify timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Math.abs(now - ts) > 300) {
    return res.status(403).json({ error: "SSO token has expired" });
  }

  // Verify the token
  if (!validateSSOSignature(id, timestamp, token)) {
    return res.status(403).json({ error: "Invalid SSO token" });
  }

  // Look up the resource
  const resource = resourceMap.get(id);
  if (!resource) {
    return res.status(404).json({ error: "Resource not found" });
  }

  // Build the redirect URL with context
  const params = new URLSearchParams({
    resource_id: id,
    email: email || resource.email,
    plan: resource.plan,
    agent_id: resource.agentId,
    nav: navData || "",
  });

  const redirectUrl = `${DASHBOARD_URL}/heroku/login?${params.toString()}`;

  console.log(`SSO login for resource ${id}, redirecting to dashboard`);

  return res.redirect(redirectUrl);
});

export default router;
