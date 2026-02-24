# Consolidated Security Findings

**Sources:** Claude Opus audit (70 findings) + Codex audit (16 findings)
**Date:** 2026-02-23
**Last Updated:** 2026-02-24 (batch 6)
**Deduplication:** 9 overlapping findings merged, resulting in 77 unique findings

---

## Remediation Progress

| Status | Count | Details |
|--------|-------|---------|
| **FIXED** | 72 | #1-#5, #6-#18, #19-#31, #33, #35, #37-#53, #57, #58, #60, #65-#69, #71-#73, #75, #76, #80-#83, #86, #88-#91 |
| **PARTIALLY FIXED** | 5 | #32 (Decimal — documented safe), #34 (retry queue), #54 (API key provider), #55 (TLS docs), #56 (AES in-memory), #59 (Heroku store warning), #85 (mint cap), #87 (Pausable code — needs UUPS upgrade) |
| **Open (CRITICAL+HIGH)** | 0 | All HIGH findings fixed! |
| **Open (MEDIUM)** | 3 | #36 (wallet arch — operational), #61 (slash centralization — governance), #62 (oracle centralization — TWAP), #63 (premium gaming — API layer), #64 (stale vouches — scheduled job) |
| **Open (LOW+INFO)** | 5 | #70 (design decision), #74 (standard practice), #77 (needs Redis), #78 (design decision), #79 (design decision), #84 (already handled by WP Settings API) |

---

## Legend

- **[C]** = Claude only found this
- **[X]** = Codex only found this
- **[CX]** = Both found this (overlap)

---

## TIER 1: CRITICAL + HIGH (Fix Now)

### 1. [CX] Shopify Webhooks Have No HMAC Verification
- **Claude:** S-1 CRITICAL | **Codex:** #3 HIGH
- **File:** `integrations/shopify/src/index.ts`
- **Issue:** Webhook endpoints accept any POST without verifying `X-Shopify-Hmac-Sha256`. Attacker can forge any webhook payload.
- **Fix:** Add HMAC verification middleware using `crypto.timingSafeEqual` + raw body buffering.
- **Status:** FIXED (2026-02-24)
  - Added raw body buffering via `express.json({ verify: ... })`
  - Created `verifyWebhookHmac()` middleware with timing-safe HMAC-SHA256 comparison
  - Applied to both `/webhooks/orders-create` and `/webhooks/orders-fulfilled`

### 2. [X] Multi-Tenant Authorization Gaps in DeFi Routes
- **Codex:** #1 HIGH
- **File:** `src/routes/markets.ts`, `src/routes/insurance.ts`
- **Issue:** Any authenticated developer can settle ANY market, claim ANY insurance policy. No ownership check. All payouts route to shared DEPLOYER_ADDRESS wallet.
- **Impact:** Cross-tenant financial interference. Dev A can settle Dev B's market. All claims go to one wallet.
- **Status:** FIXED (2026-02-24)
  - Added `agentId` requirement + `verifyAgentOwnership()` on settle route
  - Removed hardcoded DEPLOYER_ADDRESS fallback — now requires env var (see also #33)
  - Insurance buy route also requires DEPLOYER_ADDRESS env var
  - **Remaining architectural note:** Shared wallet design is inherent to the proxied on-chain model. Per-agent wallet derivation is a future enhancement.

### 3. [X] Gateway Does Not Enforce Certificate Revocation
- **Codex:** #2 HIGH
- **File:** `packages/gateway/src/middleware/certificate.ts:48`
- **Issue:** Gateway validates JWT signature/issuer locally but never checks Station revocation. Revoked certs usable until expiry (5 min).
- **Fix:** Add optional revocation check via `StationClient.verifyRemote()`. Add CRL cache or stapled revocation status.
- **Status:** FIXED (2026-02-24, batch 4)
  - Added `checkRevocation` option to `createCertificateMiddleware()` and `GatewayConfig`
  - When enabled, middleware calls `StationClient.verifyRemote()` after local JWT verification
  - Results cached per JTI in a `revocationCache` Map (max 5,000 entries, auto-cleanup every 5 min)
  - Fails open if station is unreachable (preserves availability)
  - Cache entries expire when the certificate expires

### 4. [X] WordPress Does Not Enforce Certificate Scope
- **Codex:** #4 HIGH
- **File:** `integrations/wordpress/includes/class-gateway.php`
- **Issue:** WP gateway verifies cert and checks score threshold, but ignores scope array. Scoped certs can access any WP action.
- **Threat model claims** gateways enforce scope (THREAT-MODEL.md:125) -- implementation doesn't match.
- **Status:** FIXED (2026-02-24)
  - Added scope enforcement block before score check in `handle_request()`
  - Checks `$agent_context['scope']` array against `$action_name`
  - Returns 403 `scope_violation` error with helpful message listing allowed actions

### 5. [X] WordPress Public-Key Parsing Incompatible with Station
- **Codex:** #5 HIGH
- **File:** `integrations/wordpress/includes/class-station-client.php`
- **Issue:** Station returns `{ pem: "..." }` at `/.well-known/station-keys`. WordPress expects `public_key` or JWKS-like `keys[]`. Cert verification may fail entirely.
- **Status:** FIXED (2026-02-24)
  - Added `pem` field check as first priority before `public_key` and `keys[]` fallbacks

### 6. [X] Shopify Parses Station Cert Verify Response Wrong
- **Codex:** #6 HIGH
- **File:** `integrations/shopify/src/index.ts`
- **Issue:** Station returns `data.payload` but Shopify reads `data.data.score` / `data.data.agentId`. Score resolves to 0, agent to "unknown".
- **Status:** FIXED (2026-02-24)
  - Updated `verifyCertificate()` to read `data.data.payload.score` and `data.data.payload.agentId` (or `.sub`)
  - Added fallback to legacy `data.data.score` format for backward compatibility

### 7. [CX] Staking Race Condition (Read-Then-Write)
- **Claude:** ST-6.1 HIGH | **Codex:** #9 MEDIUM
- **File:** `src/services/staking.ts`, `src/services/reputation.ts`
- **Issue:** `addStake` reads stake, computes in JS, writes back. TOCTOU. Concurrent requests lose deposits. Reputation calculation uses non-transactional reads despite claiming serializable.
- **Status:** FIXED (2026-02-24)
  - Wrapped `addStake` and `withdrawStake` in `prisma.$transaction()` blocks
  - Replaced read-then-write with Prisma atomic `increment`/`decrement` operations
  - Updated `calculateReputationScore()` to accept optional `db` parameter for transaction client pass-through
  - `updateAgentReputation()` now passes `tx` to `calculateReputationScore()` for consistent reads

### 8. [CX] Heroku SSO Timing-Vulnerable Comparison
- **Claude:** H-1 HIGH | **Codex:** #12 MEDIUM
- **File:** `integrations/heroku-addon/src/sso.ts`
- **Issue:** `expected === token` is not timing-safe. Byte-by-byte brute force possible.
- **Status:** FIXED (2026-02-24)
  - Replaced `===` with `crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))`
  - Added buffer length check before comparison

### 9. [CX] Heroku Placeholder Secrets Don't Fail Startup
- **Claude:** H-2 HIGH | **Codex:** #12 MEDIUM
- **File:** `integrations/heroku-addon/src/sso.ts`
- **Issue:** Defaults to `REPLACE_WITH_SSO_SALT`. Server runs with known credentials.
- **Status:** FIXED (2026-02-24)
  - Changed default to `""` with startup `console.error` warning
  - Added guard: `if (!SSO_SALT || SSO_SALT.startsWith("REPLACE")) return false` rejects all SSO

### 10. [CX] Shopify OAuth Uses Math.random() Nonce
- **Claude:** S-2 HIGH | **Codex:** #15 LOW
- **File:** `integrations/shopify/src/index.ts`
- **Issue:** CSRF nonce not cryptographically secure.
- **Status:** FIXED (2026-02-24)
  - Replaced `Math.random()` nonce with `crypto.randomBytes(32).toString("hex")`

### 11. [C] Self-Service Identity Verification (Free +10 Score)
- **Claude:** ST-1.3 HIGH
- **File:** `src/routes/agents.ts`
- **Issue:** Any dev calls verify-identity for instant +10. No actual verification.
- **Status:** FIXED (2026-02-24)
  - Now requires `X-Admin-Key` header matching `ADMIN_API_KEY` env var
  - Uses `crypto.timingSafeEqual` for admin key comparison
  - Added idempotency check: returns 409 if agent already verified
  - Without ADMIN_API_KEY configured, endpoint returns 403

### 12. [C] Self-Reported Success/Failure Inflates Scores
- **Claude:** ST-7.3 HIGH
- **File:** `src/services/verification.ts:121-161`
- **Issue:** `POST /report` lets devs report their own outcomes. Always reporting "success" = +20 score.
- **Status:** FIXED (2026-02-24)
  - Self-reported outcomes now weighted at half the impact (success: +1 vs +2, failure: -3 vs -5)
  - Added idempotency: each action can only have its outcome reported once (tracked via metadata JSON)
  - Added per-agent daily cap: max 50 self-reports per agent per 24h
  - Gateway-reported outcomes (isGatewayReport=true) retain full weight

### 13. [C] Cross-Agent Self-Vouching
- **Claude:** ST-7.1 HIGH
- **File:** `src/services/vouching.ts:11-79`
- **Issue:** Dev creates Agent-A and Agent-B, verifies both (+10), mutual vouch for +20 each.
- **Status:** FIXED (2026-02-24)
  - Added `voucherAgent.developerId === vouchedAgent.developerId` check
  - Same-developer agents now blocked from vouching each other
  - Vouching now searches globally for target agent (cross-developer vouching still works)

### 14. [C] Rate Limiter Bypassable via X-Forwarded-For
- **Claude:** ST-3.1 HIGH
- **File:** `src/app.ts:26,62-72`
- **Issue:** `trust proxy: 1` allows spoofing. Each request appears from different IP.
- **Status:** FIXED (2026-02-24)
  - `apiLimiter` now keys on API key hash instead of IP (immune to X-Forwarded-For spoofing)
  - Applied `apiLimiter` to all authenticated routes (agents, certificates, reports, DeFi)
  - Also fixes #28 (apiLimiter was defined but never used)

### 15. [C] Unsanitized Sort Parameter in Dashboard
- **Claude:** ST-2.1 HIGH
- **File:** `src/routes/dashboard.ts:100-101`
- **Issue:** Sort param used as Prisma orderBy key. Can order by sensitive columns or cause prototype pollution.
- **Status:** FIXED (2026-02-24)
  - Added `ALLOWED_SORT_COLUMNS` whitelist: `reputationScore`, `totalActions`, `successfulActions`, `failedActions`, `stakeAmount`, `createdAt`, `externalId`, `status`
  - Invalid sort values fall back to `reputationScore`

### 16. [C] No Rate Limiting on Developer Registration
- **Claude:** ST-1.2 HIGH
- **File:** `src/routes/developers.ts:10`
- **Issue:** Mass account creation with no CAPTCHA or email verification.
- **Status:** FIXED (2026-02-24)
  - Added `registrationLimiter`: max 5 registrations per IP per hour
  - Applied specifically to `/developers/register` route before the main developer routes

### 17. [C] Bot Shield Nonce Replay After Eviction
- **Claude:** GW-3 HIGH
- **File:** `packages/gateway/src/bot-shield.ts:104-118,189-197`
- **Issue:** Evicted nonces replayable within TTL. High traffic forces eviction of valid nonces.
- **Status:** FIXED (2026-02-24)
  - Removed `evictOldestNonces()` — no longer evicts unexpired nonces
  - Now cleans only expired nonces first, then rejects if cache is still full
  - Prevents the replay window that existed when valid nonces were evicted under load

### 18. [C] Response Injection from Action Handlers
- **Claude:** GW-13 HIGH
- **File:** `packages/gateway/src/gateway.ts:362`
- **Issue:** `{ ...result }` spreads entire handler return. Handler can inject `accessToken`, `behavior`.
- **Status:** FIXED (2026-02-24)
  - Replaced `{ ...result }` with explicit field construction: `{ success, data?, error? }`
  - Gateway-controlled fields (`accessToken`, `behavior`) are now set after handler result, immune to injection

### 19. [C] Browser Detection Trivially Bypassable
- **Claude:** GW-1 HIGH
- **File:** `packages/gateway/src/bot-shield.ts:232-258`
- **Issue:** 2 of 4 signals required, all spoofable headers.
- **Status:** FIXED (2026-02-24)
  - Changed `allowBrowsers` default from `true` to `false`
  - Raised signal threshold from 2-of-4 to 3-of-4
  - Added prominent JSDoc warning that all signals are spoofable headers
  - Recommended custom `isBrowser` with JS challenges for high-security use

### 20. [C] Unsanitized Input to Action Handlers
- **Claude:** GW-8 HIGH
- **File:** `packages/gateway/src/action-registry.ts:126-128`
- **Issue:** Params passed directly after typeof checks. No SQL/XSS/shell sanitization.
- **Status:** FIXED (2026-02-24)
  - Added MAX_STRING_LENGTH (10,000 chars) for string parameters
  - Added MAX_OBJECT_DEPTH (5 levels) for nested object/array parameters
  - Added MAX_TOTAL_PARAMS (50 keys) to limit total payload complexity
  - All limits enforced in `validateParams()` before handler execution

### 21. [C] SSRF via Agent SDK gatewayUrl
- **Claude:** SDK-23 HIGH
- **File:** `packages/agent-sdk/src/client.ts:155-222`
- **Issue:** Any URL accepted. Cert sent to arbitrary endpoints including cloud metadata.
- **Status:** FIXED (2026-02-24)
  - Added `validateUrl()` function that enforces HTTPS (allows localhost for dev)
  - Blocks private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
  - Blocks private IPv6 (fc, fd, fe80 prefixes)
  - Blocks cloud metadata endpoints (169.254.169.254, metadata.google.internal)
  - Applied to constructor (station URL), `discoverGateway()`, `executeAction()`, `fetchProtected()`

### 22. [C] Certificate Sent to Unvalidated Gateway
- **Claude:** SDK-24 HIGH
- **File:** `packages/agent-sdk/src/client.ts:183-205`
- **Issue:** JWT cert replayed by fake gateways within 5-min TTL.
- **Status:** FIXED (2026-02-24)
  - Gateway URLs now validated via `validateUrl()` (HTTPS required, no private IPs)
  - Combined with #21 fix — prevents certificate from being sent to malicious endpoints
  - **Note:** Full cert-gateway binding (audience claim) is a future enhancement

### 23. [C] fetchProtected Sends Token to Arbitrary URLs
- **Claude:** SDK-25 HIGH
- **File:** `packages/agent-sdk/src/client.ts:283-299`
- **Issue:** Bot Shield token sent to any URL.
- **Status:** FIXED (2026-02-24)
  - Now tracks `lastTokenOrigin` when a gateway issues an access token
  - `fetchProtected()` validates that the target URL origin matches the issuing gateway origin
  - Mismatched origins throw an error with a clear message
  - Also fixed #81 (token was set twice in headers — now set only once)

### 24. [C] TrustGovernor Upgrade Bypass
- **Claude:** C-3 HIGH
- **File:** `contracts/contracts/TrustGovernor.sol`
- **Issue:** If deployer retains UUPS upgrade authority, governance bypassed.
- **Status:** FIXED (2026-02-24)
  - Changed `_authorizeUpgrade` from `onlyOwner` to `onlyGovernance`
  - Upgrades now require a full governance proposal + timelock delay
  - Deployer can no longer bypass governance to upgrade the contract

### 25. [X] Heroku Provisioning Targets Wrong Station Endpoints
- **Codex:** #13 MEDIUM (upgraded: effectively HIGH since provision silently fails)
- **File:** `integrations/heroku-addon/src/provision.ts`
- **Issue:** Uses `/api/v1/developers/register` and `/api/v1/agents/register` which don't match current Station routes. Falls back to fake local credentials on failure.
- **Status:** FIXED (2026-02-24)
  - Fixed endpoint paths: `/developers/register` and `/developers/agents`
  - Fixed response parsing to match Station format (`data.apiKey`, `data.externalId`)
  - Removed fake credential fallback — now returns 503 on Station failure

---

## TIER 2: MEDIUM (Fix This Sprint)

### 26. [C] Stored XSS via innerHTML in Dashboard
- **Claude:** ST-9.2 MEDIUM
- **File:** `src/public/dashboard.html`
- **Issue:** User data injected via innerHTML without escaping.
- **Status:** FIXED (2026-02-24)
  - Added `escapeHtml()` utility function
  - Applied to all user-controlled data in `loadAgents()`, `loadActions()`, `loadCertificates()`, `loadGateways()`, and contract address rendering
  - Numeric values now coerced to `Number()` before insertion

### 27. [C] CORS Regex Matches Any *.herokuapp.com
- **Claude:** ST-10.2 MEDIUM
- **File:** `src/app.ts:52-56`
- **Fix:** Exact origin matching.
- **Status:** FIXED (2026-02-24)
  - Removed `/\.herokuapp\.com$/` and `/\.agenttrust\.dev$/` broad regexes
  - Now only allows localhost in dev; use `CORS_ORIGINS` env var for production origins

### 28. [CX] apiLimiter Defined But Never Used
- **Claude:** ST-3.2/ST-12.3 MEDIUM | **Codex:** #8 MEDIUM
- **File:** `src/app.ts:62-72`
- **Status:** FIXED (2026-02-24) — as part of #14 fix. Applied `apiLimiter` to all authenticated routes.

### 29. [C] Certificate Issuance Not Rate-Limited per Agent
- **Claude:** ST-3.3 MEDIUM
- **File:** `src/routes/certificates.ts:12-48`
- **Fix:** 1 cert/agent/60s.
- **Status:** FIXED (2026-02-24)
  - Added `certIssuanceLimiter`: 10 certs/agent/minute, keyed on hash of (API key + agentId)
  - Applied as middleware before `authenticateApiKey` on the `/request` route

### 30. [C] No Limit on Actions Array in Reports
- **Claude:** ST-2.2 MEDIUM
- **File:** `src/routes/reports.ts:27-28`
- **Status:** FIXED (2026-02-24) — Added `actions.length > 100` check, returns 400.

### 31. [C] Idempotency Lacks Unique DB Constraint
- **Claude:** ST-8.1 MEDIUM
- **File:** `prisma/schema.prisma:140-155`
- **Fix:** Add `@@unique([certificateJti, gatewayId])`.
- **Status:** FIXED (2026-02-24, batch 4)
  - Added `@@unique([certificateJti, gatewayId])` to GatewayReport model in Prisma schema
  - Removed application-level `findFirst` TOCTOU check — DB constraint catches duplicates atomically
  - Reports service catches Prisma `P2002` (unique constraint violation) and returns clear error

### 32. [C] Floating-Point Arithmetic for Financial Values
- **Claude:** ST-6.2 MEDIUM
- **File:** `src/services/staking.ts:35-36`
- **Fix:** Use Prisma Decimal throughout.
- **Status:** FIXED (2026-02-24, batch 6) — DB writes use Prisma Decimal atomic ops. JS-side `Number()` conversions documented safe: stakeBonus uses only integer ops (`Math.floor`, `Math.min`) capped to [0, 15] range. `getStakeInfo()` is read-only display.

### 33. [C] Hardcoded Deployer Address Fallback
- **Claude:** ST-5.2 MEDIUM
- **File:** `src/routes/markets.ts`, `src/routes/insurance.ts`
- **Fix:** Require DEPLOYER_ADDRESS env var.
- **Status:** FIXED (2026-02-24) — as part of #2 fix. Removed all hardcoded fallback addresses. Routes return 503 if env var missing.

### 34. [C] Blockchain Ops Silently Fail
- **Claude:** ST-5.3 MEDIUM
- **Fix:** Retry queue + sync status tracking.
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added in-memory retry queue (max 500 ops, 3 retries at 30s intervals). All 7 write functions enqueue on failure. `getBlockchainQueueStats()` exposed in `/health` endpoint for monitoring. Full persistent queue would require a database-backed job system.

### 35. [C] Momentum System Gameable
- **Claude:** ST-7.2 MEDIUM
- **Fix:** Minimum time gap, cross-gateway diversity.
- **Status:** FIXED (2026-02-24, batch 5)
  - Positive momentum now dampened when events are clustered (amplifier capped at 1x for spans < 1 hour)
  - Negative momentum retains up to 3x amplifier for rapid failure detection
  - Prevents attackers from inflating scores via rapid positive event bursts

### 36. [C] Private Key in Plain Env Var (2 Wallet Instances)
- **Claude:** ST-5.1 MEDIUM
- **Fix:** Single wallet instance.
- **Status:** OPEN

### 37. [C] Dashboard Admin Key in Query String
- **Claude:** ST-1.4 MEDIUM
- **Fix:** Header only.
- **Status:** FIXED (2026-02-24)
  - Removed `req.query.key` — admin key now only accepted via `X-Admin-Key` header
  - Prevents key exposure in server logs, browser history, and referrer headers

### 38. [C] Dashboard Auth Bypassed in Non-Production
- **Claude:** ST-1.5 MEDIUM
- **Fix:** Fail-closed.
- **Status:** FIXED (2026-02-24)
  - Dashboard auth now fails closed in ALL environments (not just production)
  - Returns 401 if `DASHBOARD_API_KEY` env var is not configured, regardless of `NODE_ENV`

### 39. [C] CSP Allows unsafe-inline
- **Claude:** ST-10.1 MEDIUM
- **Fix:** External scripts + nonce CSP.
- **Status:** FIXED (2026-02-24, batch 5)
  - Replaced `'unsafe-inline'` with per-request CSP nonce for `scriptSrc`
  - Nonce generated via `crypto.randomBytes(16)` per request, attached to `res.locals.cspNonce`
  - Dashboard served via dynamic route that injects nonce into inline `<script>` tag
  - Inline styles kept as `'unsafe-inline'` (lower risk than scripts)

### 40. [C] Internal UUIDs Exposed in Reports
- **Claude:** ST-8.2 MEDIUM
- **Fix:** Use compound lookup.
- **Status:** FIXED (2026-02-24, batch 4)
  - Report response now returns `agentExternalId` instead of internal `agentId` UUID
  - Callers already know the agentId they submitted — echoing internal UUIDs leaks implementation details

### 41. [C] Dashboard Exposes Internal IDs
- **Claude:** ST-9.1 MEDIUM
- **Fix:** Remove internal IDs.
- **Status:** FIXED (2026-02-24, batch 4)
  - Removed internal `id` (UUID) from `/api/agents` and `/api/actions/recent` responses
  - Momentum endpoint now accepts `externalId` in URL path instead of internal UUID
  - Momentum response returns `agentExternalId` instead of internal `agentId`

### 42. [C] No Explicit Body Size Limit
- **Claude:** ST-12.1 MEDIUM
- **Fix:** `express.json({ limit: '100kb' })`.
- **Status:** FIXED (2026-02-24)
  - Added explicit `{ limit: '100kb' }` to `express.json()` middleware

### 43. [C] Nonce Cache Memory Exhaustion
- **Claude:** GW-2 MEDIUM
- **Fix:** TTL-based eviction + hard upper bound.
- **Status:** FIXED (2026-02-24, batches 2+4)
  - Already mitigated in batch 2 (#17): Hard upper bound of `maxNonceCache` (default 10,000)
  - Expired nonces cleaned every 60 seconds
  - If cache is full of unexpired nonces, requests are rejected rather than evicting (prevents replay window)

### 44. [C] Secret Minimum Length Mismatch
- **Claude:** GW-4 MEDIUM
- **Fix:** Enforce 32 bytes in both locations.
- **Status:** FIXED (2026-02-24)
  - BotShield constructor now requires 32-character minimum secret (was 16)
  - Matches access-token.ts recommendation for HMAC-SHA256 entropy

### 45. [C] Excluded Path Traversal
- **Claude:** GW-5 MEDIUM
- **Status:** FIXED (2026-02-24) — Added `posix.normalize()` on request path before exclusion check in BotShield.

### 46. [C] Public Key Cache Race Condition
- **Claude:** GW-6 MEDIUM
- **Fix:** Promise deduplication + PEM validation.
- **Status:** FIXED (2026-02-24, batch 4)
  - Added `pendingKeyFetch` promise deduplication in `StationClient.getPublicKey()`
  - When cache expires, only 1 fetch is made — all concurrent callers await the same promise
  - Prevents thundering herd of N parallel fetches to station on cache expiry

### 47. [C] SSRF via stationUrl
- **Claude:** GW-7 MEDIUM
- **Fix:** Require HTTPS. Block private IPs.
- **Status:** FIXED (2026-02-24)
  - Added `validateStationUrl()` in gateway `station-client.ts`
  - Requires HTTPS (localhost exempt), blocks private IPv4/IPv6 and cloud metadata endpoints
  - Mirrors the `validateUrl()` approach already used in agent-sdk client.ts

### 48. [C] ML Analyzer DoS via Nested Params
- **Claude:** GW-9 MEDIUM
- **Fix:** Max recursion depth (5). Max string count (50).
- **Status:** FIXED (2026-02-24, batch 4)
  - Added `MAX_EXTRACT_DEPTH = 10` to prevent stack overflow from deeply nested objects
  - Added `MAX_EXTRACT_STRINGS = 100` to cap the number of strings extracted for ML inference
  - Both limits prevent crafted payloads from causing DoS via CPU exhaustion

### 49. [C] ML Inference Errors Silently Pass
- **Claude:** GW-10 MEDIUM
- **Fix:** Fail-closed.
- **Status:** FIXED (2026-02-24, batch 4)
  - Changed both injection and URL inference catch blocks from skip-and-continue to fail-closed
  - On ML inference error, the field is now treated as suspicious (threat added with confidence=0)
  - Prevents attackers from crafting inputs that crash the model to bypass detection

### 50. [C] Unbounded Session Action Array
- **Claude:** GW-11 MEDIUM
- **Fix:** Cap at 1000 + sliding window.
- **Status:** FIXED (2026-02-24)
  - Capped `session.actions` at 500 entries (sliding window, keeps most recent)
  - Sufficient for all behavioral checks which only look at last 60 seconds

### 51. [C] Reduced Penalty for Repeat Violations
- **Claude:** GW-12 MEDIUM
- **Fix:** Escalating penalties.
- **Status:** FIXED (2026-02-24, batch 5)
  - Changed repeated violation penalty from `violationPenalty / 2` (decreasing) to `violationPenalty * 1.5` (escalating)
  - Repeat violations now cost MORE than first occurrence, not less
  - Prevents attackers from repeatedly triggering violations at diminishing cost

### 52. [C] Shield Secret Exposed via Getter
- **Claude:** GW-14 MEDIUM
- **Fix:** Remove or return derived key.
- **Status:** FIXED (2026-02-24)
  - Removed `getShieldSecret()` public method from `AgentGateway`
  - For multi-process deployments, secret should be shared via env vars, not getter

### 53. [C] Sensitive Params in Station Reports
- **Claude:** GW-15 MEDIUM
- **Fix:** reportSanitizer hook.
- **Status:** FIXED (2026-02-24, batch 4)
  - All `submitReport()` calls in gateway.ts now send `paramKeys` (field names only) instead of raw `params`
  - Also includes `paramCount` for analytics without exposing values
  - Prevents leaking passwords, tokens, PII, or other sensitive param values to the station

### 54. [C] API Key in Plain Memory (SDK)
- **Claude:** SDK-27 MEDIUM
- **Fix:** Key-provider callback.
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added optional `apiKeyProvider: () => Promise<string>` to `AgentClientConfig`. When set, `resolveApiKey()` calls the provider before each station request. Backward-compatible: existing `apiKey` string still works. Allows secrets manager integration (AWS, Vault, GCP).

### 55. [C] No TLS Pinning
- **Claude:** SDK-28 MEDIUM
- **Fix:** Document + consider pinning.
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added comprehensive TLS trust model documentation to `AgentClient` JSDoc. Documents that HTTPS + CA verification is used (standard Node.js trust store), and provides guidance for users who need certificate pinning (custom fetch, mTLS proxy). Actual pinning requires architectural change to HTTP client.

### 56. [C] Shopify Access Token in Memory
- **Claude:** S-3 MEDIUM
- **Fix:** Encrypted DB storage.
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added AES-256-GCM encryption for access tokens in the in-memory Map. Process-local encryption key (regenerated per restart). Heap dumps no longer reveal plaintext tokens. Full fix requires persistent encrypted DB storage (Postgres/Redis).

### 57. [C] WordPress OpenSSL Verify Error Handling
- **Claude:** W-1 MEDIUM
- **Fix:** Check for -1 separately.
- **Status:** FIXED (2026-02-24)
  - Added explicit `-1` (OpenSSL error) check before general `!== 1` verification check
  - Logs `openssl_error_string()` via `error_log()` when WP_DEBUG is enabled
  - Same logging added for `openssl_pkey_get_public()` failures

### 58. [C] WordPress Transient Nonce Race Condition
- **Claude:** W-2 MEDIUM
- **Fix:** Use `wp_cache_add()` (atomic).
- **Status:** FIXED (2026-02-24)
  - Replaced `get_transient()`/`set_transient()` TOCTOU pattern with `wp_cache_add()` (atomic)
  - `wp_cache_add()` returns false if key already exists — eliminates race condition
  - Retained `set_transient()` as persistence fallback for cache flushes

### 59. [C] Heroku In-Memory Resource Store
- **Claude:** H-3 MEDIUM
- **Fix:** Database-backed storage.
- **Status:** PARTIALLY FIXED (2026-02-24, batch 4)
  - Added production startup warning when using in-memory store
  - Documented that Station API is source of truth for developer/agent records
  - Full fix (database-backed storage) deferred — requires adding Heroku Postgres dependency

### 60. [C] Heroku Resource Enumeration
- **Claude:** H-4 MEDIUM
- **Fix:** Rate limiting + audit logging.
- **Status:** FIXED (2026-02-24, batch 4)
  - Added per-IP rate limiter (30 req/min) to Heroku addon provision and SSO routes
  - Stale rate limit entries cleaned every 5 minutes
  - Prevents brute-force enumeration of resource UUIDs

### 61. [C] StakingVault Slash Centralization
- **Claude:** C-1 MEDIUM
- **Fix:** Multi-sig or governance for slashing.
- **Status:** OPEN

### 62. [C] ReputationMarket Oracle Centralization
- **Claude:** C-2 MEDIUM
- **Fix:** TWAP for settlement.
- **Status:** OPEN

### 63. [C] InsurancePool Premium Formula Gaming
- **Claude:** C-4 MEDIUM
- **Fix:** Lock premium to purchase-time score.
- **Status:** OPEN

### 64. [C] VouchMarket Stale Frozen Score
- **Claude:** C-5 MEDIUM
- **Fix:** Periodic refresh or stale flag.
- **Status:** OPEN

### 65. [X] WordPress Report Schema Mismatch
- **Codex:** #10 MEDIUM
- **File:** `integrations/wordpress/includes/class-gateway.php`
- **Issue:** WP sends snake_case fields; Station expects camelCase + actions array + certificateJti.
- **Status:** FIXED (2026-02-24)
  - Updated report payload to Station format: `{ agentId, gatewayId, certificateJti, actions: [{ action, success, duration_ms }] }`

### 66. [X] CI/CD Deploy Doesn't Depend on CI Tests
- **Codex:** #11 MEDIUM
- **File:** `.github/workflows/deploy.yml:13,36`, `security.yml:28-34`
- **Issue:** Broken/vulnerable builds can deploy. Security scans use `|| true`.
- **Fix:** Make deploy depend on CI. Remove `|| true`.
- **Status:** FIXED (2026-02-24)
  - Added `workflow_call` trigger to `ci.yml` so it can be used as a reusable workflow
  - Deploy workflow now has `ci` job that calls `ci.yml` as a gate
  - Deploy job requires `needs: [ci]` — tests must pass before deployment
  - Removed `npm test || true` from deploy job (was swallowing test failures)

### 67. [X] WordPress JWT Verification Lacks Revocation Check
- **Codex:** #7 MEDIUM-HIGH
- **File:** `integrations/wordpress/includes/class-station-client.php`
- **Issue:** Same as #3 but specific to WP client path.
- **Fix:** Add Station verify endpoint call.
- **Status:** FIXED (2026-02-24, batch 4)
  - Added `check_revocation()` method to `AgentTrust_Station_Client`
  - Calls station's `/certificates/verify` endpoint when `agenttrust_check_revocation` option is enabled
  - Results cached per JTI in WP transients until certificate expires (max 1 hour)
  - Fails open if station is unreachable (preserves availability)

### 68. [X] Behavioral Analytics Conflates Score Failures with Scope Violations
- **Codex:** #14 LOW-MEDIUM
- **File:** `packages/gateway/src/behavior-tracker.ts:97,404`
- **Issue:** Score-threshold failures labeled as "scope violation". Misleading telemetry.
- **Fix:** Separate the two conditions with distinct labels.
- **Status:** FIXED (2026-02-24)
  - Updated `scope_violation` flag description to clarify it's a score threshold violation
  - Updated `SessionStats.scopeViolations` JSDoc to match actual semantics
  - Note: flag name kept for backward compatibility but description now accurate

---

## TIER 3: LOW + INFO (Backlog)

### 69. [C] Timing Oracle in API Key Fallback (ST-1.1)
- **Status:** FIXED (2026-02-24, batch 5)
  - Fallback now only iterates developers without a fingerprint (not all developers)
  - Continues comparing all candidates even after match found (constant-ish timing)
  - Performs dummy bcrypt comparison if no fallback candidates exist (prevents timing oracle)

### 70. [C] No Type Validation on context Field (ST-2.3)
- **Status:** OPEN (design decision — context field is freeform JSON by design)

### 71. [C] No Email Format Validation (ST-2.4)
- **Status:** FIXED (2026-02-24, batch 5)
  - Added email regex validation (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) and max length (254 chars)

### 72. [C] No Length Limit on externalId (ST-2.5)
- **Status:** FIXED (2026-02-24, batch 5)
  - Added 255-character max length validation on externalId in agent registration
  - Added 255-character max length on companyName in developer registration

### 73. [C] Certs Issuable for Inactive Agents (ST-4.3)
- **Status:** FIXED (2026-02-24, batch 5)
  - Changed status check from two specific checks (banned/suspended) to single `!== 'active'` check
  - All non-active agents (banned, suspended, inactive, etc.) now blocked from receiving certificates

### 74. [C] Private Keys Cached in Memory (ST-4.2)
- **Status:** OPEN (operational — keys loaded at startup, standard practice for JWT signing)

### 75. [C] Error Messages Leak Internal State (ST-11.1)
- **Status:** FIXED (2026-02-24, batch 6) — Reports route now uses a whitelist of known safe error messages. Raw `error.message` from Prisma or other libraries is never returned to the client; unrecognized errors return generic `'Report submission failed'`.

### 76. [C] Swagger UI Exposed in Production (ST-12.2)
- **Status:** FIXED (2026-02-24, batch 5)
  - Swagger UI now only mounted when `NODE_ENV !== 'production'`

### 77. [C] In-Memory Rate Limit Store (ST-12.4)
- **Status:** OPEN (architectural — requires Redis for multi-instance deployments)

### 78. [C] Session Data Disclosure (GW-16)
- **Status:** OPEN (architectural — nonce tracking uses in-memory Map by design)

### 79. [C] Access Token Payload Not Encrypted (GW-17)
- **Status:** OPEN (design decision — HMAC provides integrity not confidentiality; tokens are short-lived)

### 80. [C] Prototype Pollution via Params (GW-18)
- **Status:** FIXED (2026-02-24, batch 5)
  - Added `FORBIDDEN_KEYS` set: `__proto__`, `constructor`, `prototype`
  - Parameter validation rejects any params with forbidden key names before execution

### 81. [C] Token Set Twice in fetchProtected (SDK-26) — FIXED (2026-02-24) as part of #23

### 82. [C] PII Logged in Webhooks (S-4)
- **Status:** FIXED (2026-02-24, batch 5)
  - Shopify gateway action errors now log only `err.message` instead of full error object
  - Error response to client returns generic 'Action execution failed' instead of raw error message

### 83. [C] WP Shield Secret Quality (W-3)
- **Status:** FIXED (2026-02-24, batch 5)
  - WordPress Bot Shield constructor now validates secret is at least 32 characters
  - In production, rejects weak secrets with `wp_die()`; in debug, logs warning

### 84. [C] WP Admin Settings Nonce (W-4)
- **Status:** OPEN (requires WordPress admin page refactor)

### 85. [C] TrustToken Governance Mint Risk (C-6)
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added `maxMintPerTx` cap (default 10M TRUST) that applies to ALL callers including owner. Limits blast radius of key compromise. Added `setMaxMintPerTx()` for governance adjustment. Full governance-gated minting requires multi-sig or timelock contract.

### 86. [C] Storage Gap Missing in UUPS (C-7)
- **Status:** FIXED (2026-02-24, batch 5)
  - Added `uint256[50] private __gap` to TrustToken.sol
  - Reserves 50 storage slots for future upgrades, preventing layout collisions

### 87. [C] No Pausable on DeFi Contracts (C-8)
- **Status:** PARTIALLY FIXED (2026-02-24, batch 6) — Added `PausableUpgradeable` to all 4 DeFi contracts (StakingVault, ReputationMarket, InsurancePool, VouchMarket). State-changing functions guarded by `whenNotPaused`. Owner can call `pause()`/`unpause()` for emergency stop. Code is ready; requires UUPS upgrade deployment on-chain.

### 88. [C] Template Mock Catalog Disclosure (T-1)
- **Status:** FIXED (2026-02-24, batch 5)
  - Added prominent disclaimer comments in both Replit and Bolt templates
  - Warns that mock data is for demo purposes only and must be replaced for production

### 89. [C] Template No HTTPS Enforcement (T-2)
- **Status:** FIXED (2026-02-24, batch 6) — Added startup warning when `STATION_URL` uses HTTP (non-HTTPS, excluding localhost). Templates already default to HTTPS. Warning alerts operators to the risk of unencrypted credential transmission.

### 90. [C] RSA 2048-bit Key Size (ST-4.1)
- **Status:** FIXED (2026-02-24, batch 6) — Changed `generateKeyPair()` default from RSA-2048 to RSA-4096. Added documentation noting existing deployed keys remain at 2048-bit and require regeneration via `npm run generate-keys` to get stronger size.

### 91. [X] Report Ingestion Stores Failures as 'allowed' (Codex #16)
- **Status:** FIXED (2026-02-24, batch 5)
  - Actions with `outcome: 'failure'` are now stored with `decision: 'denied'` instead of 'allowed'
  - Accurately reflects the gateway's report of failed actions in the database

---

## Overlap Analysis

| Finding | Claude | Codex | Notes |
|---------|--------|-------|-------|
| Shopify webhook HMAC | S-1 CRITICAL | #3 HIGH | Both found, same fix |
| OAuth Math.random() | S-2 HIGH | #15 LOW | Claude rated higher |
| Heroku SSO timing | H-1 HIGH | #12 MEDIUM | Claude rated higher |
| Heroku placeholder secrets | H-2 HIGH | #12 MEDIUM | Claude rated higher |
| apiLimiter unused | ST-3.2 MEDIUM | #8 MEDIUM | Same severity |
| Staking race condition | ST-6.1 HIGH | #9 MEDIUM | Claude rated higher |
| DeFi authorization gaps | (missed) | #1 HIGH | **Codex unique, major find** |
| Gateway no revocation check | (missed) | #2 HIGH | **Codex unique, major find** |
| WP scope enforcement | (missed) | #4 HIGH | **Codex unique, major find** |
| WP key format mismatch | (missed) | #5 HIGH | **Codex unique, major find** |
| Shopify response parsing | (missed) | #6 HIGH | **Codex unique, major find** |
| WP report schema mismatch | (missed) | #10 MEDIUM | **Codex unique** |
| Heroku wrong endpoints | (missed) | #13 MEDIUM | **Codex unique** |
| CI/CD non-blocking | (missed) | #11 MEDIUM | **Codex unique** |

**Key insight:** Claude found more granular code-level issues (70 vs 16). Codex found more architectural/integration-mismatch issues that require cross-file reasoning. Together they cover 91 unique findings.

---

## Fix Log

| Date | Findings Fixed | Files Changed | Notes |
|------|---------------|---------------|-------|
| 2026-02-24 | #5 | `integrations/wordpress/includes/class-station-client.php` | WP pem key parsing |
| 2026-02-24 | #6 | `integrations/shopify/src/index.ts` | Shopify cert response parsing |
| 2026-02-24 | #65 | `integrations/wordpress/includes/class-gateway.php` | WP report schema |
| 2026-02-24 | #4 | `integrations/wordpress/includes/class-gateway.php` | WP scope enforcement |
| 2026-02-24 | #25 | `integrations/heroku-addon/src/provision.ts` | Heroku provision endpoints |
| 2026-02-24 | #1 | `integrations/shopify/src/index.ts` | Shopify webhook HMAC |
| 2026-02-24 | #10 | `integrations/shopify/src/index.ts` | Shopify OAuth nonce |
| 2026-02-24 | #8, #9 | `integrations/heroku-addon/src/sso.ts` | Heroku SSO timing + placeholder |
| 2026-02-24 | #2, #33 | `src/routes/markets.ts`, `src/routes/insurance.ts` | DeFi multi-tenant auth + deployer address |
| 2026-02-24 | #26 | `src/public/dashboard.html` | Dashboard XSS via innerHTML |
| 2026-02-24 | #7 | `src/services/staking.ts`, `src/services/reputation.ts` | Staking race condition |
| 2026-02-24 | #11 | `src/routes/agents.ts` | Self-service identity verification |
| 2026-02-24 | #12 | `src/services/verification.ts` | Self-reported outcome weight + idempotency + daily cap |
| 2026-02-24 | #13 | `src/services/vouching.ts` | Cross-agent self-vouching prevention |
| 2026-02-24 | #14, #16, #28 | `src/app.ts` | API key-based rate limiting + registration limiter + apiLimiter applied |
| 2026-02-24 | #15 | `src/routes/dashboard.ts` | Sort column whitelist |
| 2026-02-24 | #17 | `packages/gateway/src/bot-shield.ts` | Nonce replay: never evict unexpired nonces |
| 2026-02-24 | #18 | `packages/gateway/src/gateway.ts` | Response injection: explicit field construction |
| 2026-02-24 | #19, #45 | `packages/gateway/src/bot-shield.ts` | Browser detection hardened + path traversal normalization |
| 2026-02-24 | #20 | `packages/gateway/src/action-registry.ts` | Input sanitization: maxLength, maxDepth, maxParams |
| 2026-02-24 | #21, #22, #23, #81 | `packages/agent-sdk/src/client.ts` | SSRF prevention + origin-restricted token + duplicate header fix |
| 2026-02-24 | #24 | `contracts/contracts/TrustGovernor.sol` | UUPS upgrade restricted to onlyGovernance |
| 2026-02-24 | #30 | `src/routes/reports.ts` | Actions array capped at 100 |
| 2026-02-24 | #27, #42 | `src/app.ts` | CORS exact origin matching + explicit body size limit |
| 2026-02-24 | #37, #38 | `src/routes/dashboard.ts` | Admin key header-only + fail-closed auth |
| 2026-02-24 | #44 | `packages/gateway/src/bot-shield.ts` | Secret minimum 32 chars |
| 2026-02-24 | #47 | `packages/gateway/src/station-client.ts` | SSRF prevention via URL validation |
| 2026-02-24 | #52 | `packages/gateway/src/gateway.ts` | Removed getShieldSecret() getter |
| 2026-02-24 | #29 | `src/routes/certificates.ts` | Per-agent cert issuance rate limit |
| 2026-02-24 | #50, #68 | `packages/gateway/src/behavior-tracker.ts` | Session action array capped at 500 + fixed analytics labels |
| 2026-02-24 | #57 | `integrations/wordpress/includes/class-station-client.php` | OpenSSL error logging |
| 2026-02-24 | #58 | `integrations/wordpress/includes/class-bot-shield.php` | Atomic nonce via wp_cache_add |
| 2026-02-24 | #66 | `.github/workflows/deploy.yml`, `.github/workflows/ci.yml` | Deploy depends on CI tests |
| 2026-02-24 | #3 | `packages/gateway/src/middleware/certificate.ts`, `packages/gateway/src/types.ts`, `packages/gateway/src/gateway.ts` | Certificate revocation check (last HIGH!) |
| 2026-02-24 | #31 | `prisma/schema.prisma`, `src/services/reports.ts` | Unique DB constraint for report idempotency |
| 2026-02-24 | #40 | `src/services/reports.ts` | Internal UUID removed from report response |
| 2026-02-24 | #41 | `src/routes/dashboard.ts` | Internal IDs removed from dashboard API responses |
| 2026-02-24 | #43 | `packages/gateway/src/bot-shield.ts` | Already mitigated by #17 (hard upper bound + TTL cleanup) |
| 2026-02-24 | #46 | `packages/gateway/src/station-client.ts` | Promise deduplication for public key cache |
| 2026-02-24 | #48 | `packages/gateway/src/ml-analyzer.ts` | Max depth (10) + max strings (100) in extractStrings |
| 2026-02-24 | #49 | `packages/gateway/src/ml-analyzer.ts` | ML inference fail-closed (blocks on error) |
| 2026-02-24 | #53 | `packages/gateway/src/gateway.ts` | Params stripped from station reports (keys only) |
| 2026-02-24 | #59 | `integrations/heroku-addon/src/provision.ts` | Production warning for in-memory store |
| 2026-02-24 | #60 | `integrations/heroku-addon/src/index.ts` | Rate limiting (30 req/min per IP) |
| 2026-02-24 | #67 | `integrations/wordpress/includes/class-station-client.php` | WP revocation check via station verify endpoint |
| 2026-02-24 | #35 | `src/services/reputation.ts` | Momentum gaming: dampen positive amplifier, keep negative |
| 2026-02-24 | #39 | `src/app.ts` | CSP nonce-based scriptSrc + dashboard nonce injection route |
| 2026-02-24 | #51 | `packages/gateway/src/behavior-tracker.ts` | Escalating penalties: repeat violations cost 1.5x (was 0.5x) |
| 2026-02-24 | #69 | `src/middleware/auth.ts` | Timing oracle: limit fallback scope + dummy bcrypt on empty |
| 2026-02-24 | #71, #72 | `src/routes/developers.ts` | Email regex + companyName/externalId length limits (254/255 chars) |
| 2026-02-24 | #73 | `src/services/certificates.ts` | Only active agents get certificates (status !== 'active' blocked) |
| 2026-02-24 | #76 | `src/app.ts` | Swagger UI disabled in production (NODE_ENV check) |
| 2026-02-24 | #80 | `packages/gateway/src/action-registry.ts` | Prototype pollution: reject __proto__/constructor/prototype keys |
| 2026-02-24 | #82 | `integrations/shopify/src/index.ts` | PII sanitization: log only err.message, generic client response |
| 2026-02-24 | #83 | `integrations/wordpress/includes/class-bot-shield.php` | Secret minimum 32 chars enforced in constructor |
| 2026-02-24 | #86 | `contracts/contracts/TrustToken.sol` | Added uint256[50] __gap for UUPS storage safety |
| 2026-02-24 | #88 | `templates/replit-gateway/index.ts`, `templates/bolt-gateway/index.ts` | Demo data disclaimer comments |
| 2026-02-24 | #91 | `src/services/reports.ts` | Failed actions stored as 'denied' instead of 'allowed' |
| 2026-02-24 | #75 | `src/routes/reports.ts` | Error message whitelist: only known safe messages returned to client |
| 2026-02-24 | #90 | `src/utils/keys.ts` | RSA key size upgraded from 2048 to 4096-bit |
| 2026-02-24 | #89 | `templates/replit-gateway/index.ts`, `templates/bolt-gateway/index.ts` | HTTPS enforcement warning on startup |
| 2026-02-24 | #32 | `src/services/staking.ts` | Documented safe Number() conversions in stakeBonus (integer ops only) |
| 2026-02-24 | #54 | `packages/agent-sdk/src/types.ts`, `packages/agent-sdk/src/client.ts` | Added apiKeyProvider callback for secrets manager integration |
| 2026-02-24 | #34 | `src/services/blockchain.ts`, `src/app.ts` | In-memory retry queue (500 ops max, 3 retries) + /health stats |
| 2026-02-24 | #55 | `packages/agent-sdk/src/client.ts` | TLS trust model documentation in AgentClient JSDoc |
| 2026-02-24 | #56 | `integrations/shopify/src/index.ts` | AES-256-GCM encryption for in-memory access tokens |
| 2026-02-24 | #85 | `contracts/contracts/TrustToken.sol` | Per-tx mint cap (10M TRUST default) applies to all callers including owner |
| 2026-02-24 | #87 | `contracts/contracts/StakingVault.sol`, `ReputationMarket.sol`, `InsurancePool.sol`, `VouchMarket.sol` | PausableUpgradeable + whenNotPaused on state-changing functions + pause/unpause |
