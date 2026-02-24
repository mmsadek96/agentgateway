# Consolidated Security Findings

**Sources:** Claude Opus audit (70 findings) + Codex audit (16 findings)
**Date:** 2026-02-23
**Last Updated:** 2026-02-24 (batch 2)
**Deduplication:** 9 overlapping findings merged, resulting in 77 unique findings

---

## Remediation Progress

| Status | Count | Details |
|--------|-------|---------|
| **FIXED** | 28 | #1, #2, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25, #26, #28, #30, #33, #45, #65, #81 |
| **Open (CRITICAL+HIGH)** | 1 | #3 |
| **Open (MEDIUM)** | 35 | #27, #29, #31, #32, #34-#44, #46-#64, #66-#68 |
| **Open (LOW+INFO)** | 22 | #69-#80, #82-#91 |

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
- **Status:** OPEN

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
- **Status:** OPEN

### 28. [CX] apiLimiter Defined But Never Used
- **Claude:** ST-3.2/ST-12.3 MEDIUM | **Codex:** #8 MEDIUM
- **File:** `src/app.ts:62-72`
- **Status:** FIXED (2026-02-24) — as part of #14 fix. Applied `apiLimiter` to all authenticated routes.

### 29. [C] Certificate Issuance Not Rate-Limited per Agent
- **Claude:** ST-3.3 MEDIUM
- **File:** `src/routes/certificates.ts:12-48`
- **Fix:** 1 cert/agent/60s.
- **Status:** OPEN

### 30. [C] No Limit on Actions Array in Reports
- **Claude:** ST-2.2 MEDIUM
- **File:** `src/routes/reports.ts:27-28`
- **Status:** FIXED (2026-02-24) — Added `actions.length > 100` check, returns 400.

### 31. [C] Idempotency Lacks Unique DB Constraint
- **Claude:** ST-8.1 MEDIUM
- **File:** `prisma/schema.prisma:140-155`
- **Fix:** Add `@@unique([certificateJti, gatewayId])`.
- **Status:** OPEN

### 32. [C] Floating-Point Arithmetic for Financial Values
- **Claude:** ST-6.2 MEDIUM
- **File:** `src/services/staking.ts:35-36`
- **Fix:** Use Prisma Decimal throughout.
- **Status:** PARTIALLY FIXED — atomic increment now uses `new Decimal(amount)`, but JS-side calculations still use Number.

### 33. [C] Hardcoded Deployer Address Fallback
- **Claude:** ST-5.2 MEDIUM
- **File:** `src/routes/markets.ts`, `src/routes/insurance.ts`
- **Fix:** Require DEPLOYER_ADDRESS env var.
- **Status:** FIXED (2026-02-24) — as part of #2 fix. Removed all hardcoded fallback addresses. Routes return 503 if env var missing.

### 34. [C] Blockchain Ops Silently Fail
- **Claude:** ST-5.3 MEDIUM
- **Fix:** Retry queue + sync status tracking.
- **Status:** OPEN

### 35. [C] Momentum System Gameable
- **Claude:** ST-7.2 MEDIUM
- **Fix:** Minimum time gap, cross-gateway diversity.
- **Status:** OPEN

### 36. [C] Private Key in Plain Env Var (2 Wallet Instances)
- **Claude:** ST-5.1 MEDIUM
- **Fix:** Single wallet instance.
- **Status:** OPEN

### 37. [C] Dashboard Admin Key in Query String
- **Claude:** ST-1.4 MEDIUM
- **Fix:** Header only.
- **Status:** OPEN

### 38. [C] Dashboard Auth Bypassed in Non-Production
- **Claude:** ST-1.5 MEDIUM
- **Fix:** Fail-closed.
- **Status:** OPEN

### 39. [C] CSP Allows unsafe-inline
- **Claude:** ST-10.1 MEDIUM
- **Fix:** External scripts + nonce CSP.
- **Status:** OPEN

### 40. [C] Internal UUIDs Exposed in Reports
- **Claude:** ST-8.2 MEDIUM
- **Fix:** Use compound lookup.
- **Status:** OPEN

### 41. [C] Dashboard Exposes Internal IDs
- **Claude:** ST-9.1 MEDIUM
- **Fix:** Remove internal IDs.
- **Status:** OPEN

### 42. [C] No Explicit Body Size Limit
- **Claude:** ST-12.1 MEDIUM
- **Fix:** `express.json({ limit: '100kb' })`.
- **Status:** OPEN

### 43. [C] Nonce Cache Memory Exhaustion
- **Claude:** GW-2 MEDIUM
- **Fix:** TTL-based eviction + hard upper bound.
- **Status:** OPEN

### 44. [C] Secret Minimum Length Mismatch
- **Claude:** GW-4 MEDIUM
- **Fix:** Enforce 32 bytes in both locations.
- **Status:** OPEN

### 45. [C] Excluded Path Traversal
- **Claude:** GW-5 MEDIUM
- **Status:** FIXED (2026-02-24) — Added `posix.normalize()` on request path before exclusion check in BotShield.

### 46. [C] Public Key Cache Race Condition
- **Claude:** GW-6 MEDIUM
- **Fix:** Promise deduplication + PEM validation.
- **Status:** OPEN

### 47. [C] SSRF via stationUrl
- **Claude:** GW-7 MEDIUM
- **Fix:** Require HTTPS. Block private IPs.
- **Status:** OPEN

### 48. [C] ML Analyzer DoS via Nested Params
- **Claude:** GW-9 MEDIUM
- **Fix:** Max recursion depth (5). Max string count (50).
- **Status:** OPEN

### 49. [C] ML Inference Errors Silently Pass
- **Claude:** GW-10 MEDIUM
- **Fix:** Fail-closed.
- **Status:** OPEN

### 50. [C] Unbounded Session Action Array
- **Claude:** GW-11 MEDIUM
- **Fix:** Cap at 1000 + sliding window.
- **Status:** OPEN

### 51. [C] Reduced Penalty for Repeat Violations
- **Claude:** GW-12 MEDIUM
- **Fix:** Escalating penalties.
- **Status:** OPEN

### 52. [C] Shield Secret Exposed via Getter
- **Claude:** GW-14 MEDIUM
- **Fix:** Remove or return derived key.
- **Status:** OPEN

### 53. [C] Sensitive Params in Station Reports
- **Claude:** GW-15 MEDIUM
- **Fix:** reportSanitizer hook.
- **Status:** OPEN

### 54. [C] API Key in Plain Memory (SDK)
- **Claude:** SDK-27 MEDIUM
- **Fix:** Key-provider callback.
- **Status:** OPEN

### 55. [C] No TLS Pinning
- **Claude:** SDK-28 MEDIUM
- **Fix:** Document + consider pinning.
- **Status:** OPEN

### 56. [C] Shopify Access Token in Memory
- **Claude:** S-3 MEDIUM
- **Fix:** Encrypted DB storage.
- **Status:** OPEN

### 57. [C] WordPress OpenSSL Verify Error Handling
- **Claude:** W-1 MEDIUM
- **Fix:** Check for -1 separately.
- **Status:** OPEN

### 58. [C] WordPress Transient Nonce Race Condition
- **Claude:** W-2 MEDIUM
- **Fix:** Use `wp_cache_add()` (atomic).
- **Status:** OPEN

### 59. [C] Heroku In-Memory Resource Store
- **Claude:** H-3 MEDIUM
- **Fix:** Database-backed storage.
- **Status:** OPEN

### 60. [C] Heroku Resource Enumeration
- **Claude:** H-4 MEDIUM
- **Fix:** Rate limiting + audit logging.
- **Status:** OPEN

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
- **Status:** OPEN

### 67. [X] WordPress JWT Verification Lacks Revocation Check
- **Codex:** #7 MEDIUM-HIGH
- **File:** `integrations/wordpress/includes/class-station-client.php`
- **Issue:** Same as #3 but specific to WP client path.
- **Fix:** Add Station verify endpoint call.
- **Status:** OPEN

### 68. [X] Behavioral Analytics Conflates Score Failures with Scope Violations
- **Codex:** #14 LOW-MEDIUM
- **File:** `packages/gateway/src/behavior-tracker.ts:97,404`
- **Issue:** Score-threshold failures labeled as "scope violation". Misleading telemetry.
- **Fix:** Separate the two conditions with distinct labels.
- **Status:** OPEN

---

## TIER 3: LOW + INFO (Backlog)

### 69. [C] Timing Oracle in API Key Fallback (ST-1.1)
### 70. [C] No Type Validation on context Field (ST-2.3)
### 71. [C] No Email Format Validation (ST-2.4)
### 72. [C] No Length Limit on externalId (ST-2.5)
### 73. [C] Certs Issuable for Inactive Agents (ST-4.3)
### 74. [C] Private Keys Cached in Memory (ST-4.2)
### 75. [C] Error Messages Leak Internal State (ST-11.1)
### 76. [C] Swagger UI Exposed in Production (ST-12.2)
### 77. [C] In-Memory Rate Limit Store (ST-12.4)
### 78. [C] Session Data Disclosure (GW-16)
### 79. [C] Access Token Payload Not Encrypted (GW-17)
### 80. [C] Prototype Pollution via Params (GW-18)
### 81. [C] Token Set Twice in fetchProtected (SDK-26) — FIXED (2026-02-24) as part of #23
### 82. [C] PII Logged in Webhooks (S-4)
### 83. [C] WP Shield Secret Quality (W-3)
### 84. [C] WP Admin Settings Nonce (W-4)
### 85. [C] TrustToken Governance Mint Risk (C-6)
### 86. [C] Storage Gap Missing in UUPS (C-7)
### 87. [C] No Pausable on DeFi Contracts (C-8)
### 88. [C] Template Mock Catalog Disclosure (T-1)
### 89. [C] Template No HTTPS Enforcement (T-2)
### 90. [C] RSA 2048-bit Key Size (ST-4.1)
### 91. [X] Report Ingestion Stores Failures as 'allowed' (Codex #16)

All TIER 3 items: **Status: OPEN**

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
