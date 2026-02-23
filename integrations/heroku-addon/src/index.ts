import express, { Request, Response, NextFunction } from "express";
import provisionRouter from "./provision";
import ssoRouter from "./sso";

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);

// The add-on manifest password used for Basic Auth
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || "REPLACE_WITH_SECRET";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Basic auth middleware for Heroku add-on API endpoints.
 * Heroku sends requests with Basic auth where the password matches the
 * manifest's api.password value.
 */
function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Heroku Add-on"');
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const [, password] = decoded.split(":");

  if (password !== ADDON_PASSWORD) {
    res.status(403).json({ error: "Invalid credentials" });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check (no auth required)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "agenttrust-heroku-addon" });
});

// Provision endpoints (protected by Basic Auth)
app.use("/heroku/resources", basicAuth, provisionRouter);

// SSO endpoint (verified by token, not Basic Auth)
app.use("/heroku/sso", ssoRouter);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`AgentTrust Heroku Add-on server listening on port ${PORT}`);
});

export default app;
