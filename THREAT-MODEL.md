# AgentTrust Threat Model

> **Version:** 1.0
> **Status:** Living document — community contributions welcome
> **Last Updated:** 2026-02-22

---

## 1. Overview

AgentTrust is a trust verification system for AI agents. This document describes the threat model: what attacks we defend against, what we don't (yet), and how the system responds.

**Architecture summary:**
- **Station** — central authority that issues signed JWT certificates and maintains reputation records
- **Gateway** — Express middleware installed on websites, verifies certificates and enforces trust policies
- **Agent SDK** — client library agents use to request certificates and execute gateway actions

---

## 2. Trust Boundaries

```
                    Trust Boundary 1                Trust Boundary 2
                          |                               |
   Agent (untrusted) -----|--- Station (trusted) ---------|--- Gateway (semi-trusted)
                          |                               |
```

| Boundary | Description |
|----------|-------------|
| **Agent <-> Station** | Agents authenticate with developer API keys. Station issues signed JWTs. The agent is untrusted — any claims it makes must be verified cryptographically. |
| **Station <-> Gateway** | Gateways fetch the Station's public key and verify JWTs locally. Gateways submit behavior reports using developer API keys. Gateway is semi-trusted — it runs on the website owner's server. |
| **Agent <-> Gateway** | The agent presents a JWT to the gateway. The gateway verifies the JWT signature and checks reputation score, scope, and behavioral patterns before allowing action execution. |

---

## 3. Threat Categories & Mitigations

### 3.1 Certificate Forgery

**Threat:** An attacker crafts a fake JWT certificate to impersonate a trusted agent.

**Mitigation:**
- Certificates are signed with RS256 (2048-bit RSA)
- Gateways verify signatures using the Station's public key, fetched from `/.well-known/station-keys`
- JWTs include standard claims: `iss`, `sub`, `exp`, `jti`
- The private key never leaves the Station server

**Residual risk:** If the Station's private key is compromised, all certificates become forgeable. Mitigation: key rotation (planned for v2).

### 3.2 Certificate Replay

**Threat:** An attacker intercepts a valid certificate and reuses it on another gateway.

**Mitigation (current):**
- Certificates have short expiry (default: 5 minutes)
- Each certificate has a unique `jti` (JWT ID)
- Certificates are scoped to the agent's identity, not to a specific gateway

**Planned (v2):**
- Nonce binding: gateway issues a challenge nonce, certificate must include it
- Audience claim (`aud`) to bind certificates to specific gateways

**Residual risk:** Within the 5-minute window, a certificate can be used at any gateway. Short expiry limits the attack window.

### 3.3 Reputation Manipulation

**Threat:** An attacker artificially inflates or deflates an agent's reputation score.

#### 3.3.1 Self-Inflation (Sybil Attack)

**Threat:** An attacker creates multiple fake gateways that report successful actions to inflate their agent's score.

**Mitigation (current):**
- Gateway reports require developer API key authentication
- Score calculation uses weighted factors (action history, vouching, staking, identity verification)
- Vouching system limits how much score one agent can boost another

**Planned:**
- Gateway reputation: gateways themselves earn trust over time; reports from new/untrusted gateways carry less weight
- Rate limiting on reputation changes per time period
- Anomaly detection on score trajectories

#### 3.3.2 Adversarial Downgrade (Collusion)

**Threat:** Multiple gateways collude to report false failures, destroying a legitimate agent's reputation.

**Mitigation (current):**
- Reputation events are logged with timestamps and source IDs
- Score decay is bounded — a single report can't destroy a well-established reputation

**Planned:**
- Appeal mechanism: agents can dispute reputation events
- Signed event receipts: every reputation change is cryptographically signed and auditable
- Weighting algorithm that discounts reports from gateways with low trust
- Privacy controls: agents choose what reputation data is public

### 3.4 Prompt Injection

**Threat:** Malicious parameters in action requests attempt to hijack the agent or gateway behavior.

**Mitigation:**
- ML-powered prompt injection detection using `protectai/deberta-v3-base-prompt-injection-v2` (ONNX)
- Runs locally on the gateway — no external API calls needed
- Requests flagged as prompt injection are blocked with 403 and reported to Station
- Behavioral tracking records the attempt and penalizes the agent's session score

**Residual risk:** ML models have false positives and false negatives. Detection threshold is configurable.

### 3.5 Scope Violation

**Threat:** An agent with a certificate scoped to "product-search" attempts to perform a "checkout" action.

**Mitigation:**
- Scope manifests are embedded in the JWT certificate as `scope: string[]`
- Gateway enforces scope before action execution
- Scope violations are recorded as behavioral events and reported to Station
- Agents without scope claims have wildcard access (backward compatible)

### 3.6 Behavioral Attacks

**Threat:** Agents exhibit malicious behavioral patterns during a session.

**Mitigation (6 detection algorithms):**

| Algorithm | What it catches | Default Threshold |
|-----------|----------------|------------------|
| `rapid_fire` | DDoS / resource exhaustion | 30 actions/minute |
| `high_failure_rate` | Probing / brute force | 5 failures before flag |
| `action_enumeration` | Scanning for vulnerabilities | 10 unique actions/minute |
| `repeated_action` | Automation / scraping | 10 identical actions/minute |
| `scope_violation` | Privilege escalation attempts | Any attempt above score |
| `burst_detected` | Sudden spike after idle period | Adaptive |

- Each violation reduces the agent's behavioral score (starts at 100)
- Score below threshold (default: 20) triggers mid-session blocking
- Blocked agents receive 403 and must wait for session expiry

### 3.7 Malicious URL Injection

**Threat:** Action parameters contain URLs pointing to phishing, malware, or command-and-control servers.

**Mitigation:**
- ML-based URL classification runs on all string parameters
- URLs are extracted and analyzed for malicious patterns
- Flagged requests are blocked and reported

### 3.8 Station Denial of Service

**Threat:** Overwhelm the Station with certificate requests or report submissions.

**Mitigation (current):**
- Standard Express rate limiting on all endpoints
- Certificate caching in the SDK (avoids redundant requests)

**Planned:**
- Per-developer rate limits
- Priority queuing for high-reputation agents

### 3.9 Gateway Impersonation

**Threat:** A malicious server pretends to be a legitimate gateway to harvest agent certificates.

**Mitigation (current):**
- Certificates have short expiry, limiting damage from exposure
- The SDK doesn't send the developer API key to gateways (only to the Station)

**Planned:**
- Gateway registry: Station maintains a list of verified gateways
- Gateway certificates: gateways themselves could have Station-issued certificates

---

## 4. Scoring Algorithm Transparency

The reputation score (0-100) is calculated from weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Action history | 40% | Success/failure ratio across all gateway interactions |
| Identity verification | 20% | Whether the agent has verified its identity |
| Staking | 15% | Economic stake deposited as collateral |
| Vouching | 15% | Endorsements from other trusted agents |
| Account age | 10% | How long the agent has been registered |

The scoring algorithm is open source: see `src/services/reputation.ts`.

**Planned:** Pluggable scoring — gateway operators can customize weights for their use case.

---

## 5. Event Signing & Audit Trail

### Current Implementation
- All reputation events are stored in both PostgreSQL and on-chain (Base L2)
- Three UUPS-upgradeable smart contracts on Base mainnet:
  - **AgentRegistry** (`0xb880bC6b0634812E85EC635B899cA197429069e8`) — agent records and reputation scores
  - **CertificateRegistry** (`0xD3cAf18d292168075653322780EF961BF6394c11`) — certificate issuance/revocation with scope hashes
  - **ReputationLedger** (`0x12181081eec99b541271f1915cD00111dB2f31c6`) — immutable audit trail of all reputation changes
- Gateway reports include action type, outcome, metadata, and behavioral data
- Dual-write pattern: API writes to both Prisma DB and Base L2 contracts (non-blocking)
- On-chain data is publicly verifiable by anyone via BaseScan

### Planned (v2)
- **Verifier SDKs:** Third parties can independently verify any agent's reputation history directly from the chain
- **Incident feed:** Real-time feed of compromised certificates, banned agents, and security events
- **Multi-party signing:** Multiple Station operators for decentralized trust

---

## 6. What We Don't Defend Against (Yet)

| Threat | Status | Notes |
|--------|--------|-------|
| Station compromise | Planned v2 | Key rotation, HSM support, multi-party signing |
| Insider threat (developer) | Partial | Developers can only affect their own agents |
| Network-level MITM | Assumed HTTPS | All communication should use HTTPS |
| Side-channel timing attacks | Not addressed | Low priority for current threat level |
| Quantum computing | Not addressed | RS256 is quantum-vulnerable; post-quantum migration planned |

---

## 7. Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:

1. **DO NOT** open a public GitHub issue
2. Email: mmsadek96@gmail.com with subject "AgentTrust Security"
3. Include: description, reproduction steps, potential impact
4. We aim to respond within 48 hours

---

## 8. Contributing to This Document

This threat model is a living document. We welcome contributions:

- **New threat scenarios** — open a GitHub issue tagged `security`
- **Mitigation improvements** — PRs welcome
- **Audit reports** — we'd love independent security reviews

GitHub: https://github.com/mmsadek96/agentgateway
