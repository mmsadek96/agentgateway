<div align="center">

# AgentTrust

### The trust layer for the AI agent economy

**CAPTCHA solved the bot problem. AgentTrust solves the *agent* problem.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm gateway](https://img.shields.io/npm/v/@agent-trust/gateway?label=gateway&color=cb3837)](https://www.npmjs.com/package/@agent-trust/gateway)
[![npm sdk](https://img.shields.io/npm/v/@agent-trust/sdk?label=sdk&color=cb3837)](https://www.npmjs.com/package/@agent-trust/sdk)
[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://agentgateway-6f041c655eb3.herokuapp.com/)
[![Base L2](https://img.shields.io/badge/Base_L2-on--chain-0052FF.svg)](https://basescan.org/address/0xb880bC6b0634812E85EC635B899cA197429069e8)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[Live Demo](https://agentgateway-6f041c655eb3.herokuapp.com/) &bull; [Dashboard](https://agentgateway-6f041c655eb3.herokuapp.com/dashboard) &bull; [API Docs](https://agentgateway-6f041c655eb3.herokuapp.com/docs) &bull; [Quick Start](#quick-start) &bull; [How It Works](#how-it-works) &bull; [Contributing](#contributing)

</div>

---

## The Problem

AI agents are the new users of the internet. They browse, buy, book, and transact — but websites have **no way to tell a legitimate agent from a malicious one.**

CAPTCHAs were designed to block bots. But what happens when the "bot" is a legitimate AI assistant placing an order for its user? **You don't want to block it. You want to verify it.**

## The Solution

AgentTrust is an open-source, **blockchain-backed** trust verification system that works like a **police station for AI agents**:

- **Agents get a "criminal record"** — a reputation score (0-100) recorded on Base L2
- **Good behavior is rewarded** — successful actions raise the score
- **Bad behavior is permanent** — every reputation change is written to an immutable on-chain ledger
- **Trust is transferable** — established agents can vouch for new ones
- **Certificates are on-chain** — issued on Base L2, verifiable by anyone without trusting AgentTrust
- **Democratic access** — agents never need wallets or crypto. The blockchain is invisible infrastructure

```
Agent → Station: "Give me my clearance"     → Certificate issued (recorded on Base L2)
Agent → Gateway: "Here's my cert, do this"  → Gateway verifies, executes action
Gateway → Station: "Here's what happened"    → Permanent on-chain record
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  AI Agent   │────▶│  Trust Station   │◀────│   Gateway   │
│  (SDK)      │     │  (Hosted API)    │     │ (Middleware) │
└─────┬───────┘     └────────┬─────────┘     └──────┬──────┘
      │                      │                       │
      │         signed JWT   │  on-chain sync        │
      └──────────certificate─┼───────────────────────┘
                   verify    │   execute
                      ┌──────▼──────────┐
                      │  Base L2 Chain  │
                      │  (Reputation +  │
                      │   Certificates) │
                      └─────────────────┘
```

**Four components:**

| Component | What it is | Who uses it |
|-----------|-----------|-------------|
| **Station** | Central trust registry & certificate authority | Hosted by AgentTrust |
| **[@agent-trust/gateway](packages/gateway)** | Express middleware for your website | Website owners |
| **[@agent-trust/sdk](packages/agent-sdk)** | Client library for AI agents | Agent developers |
| **Base L2 Contracts** | On-chain reputation, certificates & audit ledger | Automatic (transparent) |

## Quick Start

### 1. Try the Live API (30 seconds)

```bash
# Register as a developer
curl -X POST https://agentgateway-6f041c655eb3.herokuapp.com/developers/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@company.com", "companyName": "My Company"}'

# Save the apiKey from the response, then register an agent
curl -X POST https://agentgateway-6f041c655eb3.herokuapp.com/developers/agents \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"externalId": "my-first-agent"}'

# Verify the agent before a sensitive action
curl -X POST https://agentgateway-6f041c655eb3.herokuapp.com/verify \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "my-first-agent", "actionType": "place_order"}'
```

### 2. Add the Gateway to Your Website (5 minutes)

```bash
npm install @agent-trust/gateway
```

```typescript
import express from 'express';
import { createGateway } from '@agent-trust/gateway';

const app = express();

const gateway = createGateway({
  stationUrl: 'https://agentgateway-6f041c655eb3.herokuapp.com',
  gatewayId: 'my-store',
  stationApiKey: 'YOUR_API_KEY',
  actions: {
    'search_products': {
      description: 'Search the product catalog',
      minScore: 30,
      parameters: {
        query: { type: 'string', required: true, description: 'Search query' }
      },
      handler: async (params) => {
        return await db.products.search(params.query);
      }
    },
    'place_order': {
      description: 'Place an order',
      minScore: 70,  // Higher trust required for purchases
      parameters: {
        productId: { type: 'string', required: true },
        quantity: { type: 'number', required: true }
      },
      handler: async (params) => {
        return await db.orders.create(params);
      }
    }
  }
});

app.use('/agent-gateway', gateway.router());
app.listen(3000);
```

### 3. Build an Agent That Uses Gateways (5 minutes)

```bash
npm install @agent-trust/sdk
```

```typescript
import { createAgentClient } from '@agent-trust/sdk';

const agent = createAgentClient({
  stationUrl: 'https://agentgateway-6f041c655eb3.herokuapp.com',
  apiKey: 'YOUR_API_KEY',
  agentId: 'my-agent-001'
});

// Discover what actions a gateway offers
const catalog = await agent.discoverGateway('https://shop.example.com/agent-gateway');
console.log(catalog.actions); // ['search_products', 'place_order']

// Execute an action — certificate is handled automatically
const result = await agent.executeAction(
  'https://shop.example.com/agent-gateway',
  'search_products',
  { query: 'mechanical keyboard' }
);
```

## How It Works

### Trust Score (0-100)

Every agent starts at 50 and builds trust over time:

| Factor | Points | How |
|--------|--------|-----|
| Base score | 50 | Everyone starts here |
| Identity verified | +10 | Verify your agent's identity |
| Stake deposited | +5 to +15 | Put skin in the game |
| Vouches received | +2 each (max +20) | Get vouched by trusted agents |
| Success rate | up to +20 | Complete actions successfully |
| Account age | +1/month (max +10) | Time in the system |
| Failures | -5 each | Bad behavior costs you |

### The Certificate Flow

```
1. Agent requests certificate from Station
   POST /certificates/request
   → Station checks reputation, signs JWT with RS256
   → Certificate is recorded on Base L2 (CertificateRegistry contract)

2. Agent presents certificate to Gateway
   POST /agent-gateway/actions/search_products
   Authorization: Bearer <signed-jwt>
   → Gateway verifies signature locally (no network call)
   → Gateway checks score >= minScore for the action

3. Gateway reports outcome to Station
   POST /reports
   → Station updates agent's permanent record
   → Reputation change synced to Base L2 (AgentRegistry + ReputationLedger)
```

**Key insight:** Gateways verify certificates *locally* using the Station's public key. No network roundtrip needed for verification = fast. On-chain writes happen in the background and never block API responses.

### On-Chain Trust (Base L2)

Every reputation score, certificate, and behavioral event is recorded on **Base** (Coinbase's Ethereum L2):

| Contract | Address | What it stores |
|----------|---------|---------------|
| **AgentRegistry** | [`0xb880...69e8`](https://basescan.org/address/0xb880bC6b0634812E85EC635B899cA197429069e8) | Agent records, reputation scores, status |
| **CertificateRegistry** | [`0xD3cA...c11`](https://basescan.org/address/0xD3cAf18d292168075653322780EF961BF6394c11) | Certificates, scope hashes, revocation |
| **ReputationLedger** | [`0x1218...c6`](https://basescan.org/address/0x12181081eec99b541271f1915cD00111dB2f31c6) | Immutable audit trail of every change |

**Why blockchain?** Trust requires independent verification. Anyone can read these contracts directly on BaseScan without trusting AgentTrust. If we disappear, the reputation data lives on.

**Why Base?** Near-zero gas costs (~$0.001 per write), EVM-compatible, backed by Coinbase.

**Democratic design:** Only AgentTrust's operational wallet writes to the chain. Agents and developers never need wallets, never touch crypto. The blockchain is invisible infrastructure.

### Trust Mechanisms

**Reputation** — Track record over time, stored on-chain. 100 successful orders? High trust. 3 chargebacks? Low trust. Permanently recorded on Base L2.

**Vouching** — Established agents (score 60+) vouch for newcomers. Creates accountability chains. If someone you vouched for misbehaves, it reflects on you.

**Identity** — Verified agents get a trust bonus. Anonymous agents face restrictions. Accountability starts with identity.

### Real-Time Behavioral Tracking

The gateway doesn't just check IDs at the door — it watches what agents **do**:

```typescript
const gateway = createGateway({
  // ... actions config ...
  behavior: {
    maxActionsPerMinute: 30,
    maxFailuresBeforeFlag: 5,
    blockThreshold: 20,
    onSuspiciousActivity: (event) => {
      console.warn(`ALERT: ${event.flag} — ${event.description}`);
      // Slack notification, logging, etc.
    }
  }
});
```

| Detection | What it catches |
|-----------|----------------|
| `rapid_fire` | Too many requests per minute (rate abuse) |
| `high_failure_rate` | Many failed actions (probing / brute force) |
| `action_enumeration` | Trying many different endpoints (scanning) |
| `repeated_action` | Same action on loop (automation) |
| `scope_violation` | Accessing actions above trust level |
| `burst_detected` | Sudden activity spike after idle |

Each agent gets a **behavioral score (0-100)** per session. Violations degrade the score. Drop below threshold → **blocked mid-session**. Behavioral data is reported to the Station, so bad behavior follows the agent everywhere.

### ML-Powered Threat Detection (Optional)

Install `@huggingface/transformers` to enable AI-powered security — runs locally via ONNX Runtime, no API calls:

```bash
npm install @huggingface/transformers
```

```typescript
const gateway = createGateway({
  // ... actions config ...
  ml: {
    injectionThreshold: 0.85,   // Confidence for prompt injection detection
    urlThreshold: 0.80,         // Confidence for malicious URL detection
    onThreatDetected: (threat, agentId) => {
      console.warn(`ML THREAT from ${agentId}: ${threat.type} in ${threat.field}`);
    }
  }
});
```

| Model | What it detects | Size |
|-------|----------------|------|
| Prompt Injection Defender | Jailbreak attempts in request parameters | 4.4M params |
| Malicious URL Detector | Phishing/malware URLs in agent params | 67M params |

The ML layer sits between rule-based checks and action execution. If `@huggingface/transformers` isn't installed, the gateway works fine with rule-based detection only.

### Live Dashboard

Monitor your Station in real-time at `/dashboard`:

- Agent reputation overview and distribution
- Live action feed (allowed/denied)
- Activity timeline (last 24h)
- Certificate tracking
- Connected gateway monitoring

**Live:** [agentgateway-6f041c655eb3.herokuapp.com/dashboard](https://agentgateway-6f041c655eb3.herokuapp.com/dashboard)

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/developers/register` | No | Register, get API key |
| `GET` | `/developers/dashboard` | Yes | Dashboard with stats |
| `POST` | `/developers/agents` | Yes | Register an agent |
| `POST` | `/verify` | Yes | Check if agent is trusted |
| `POST` | `/report` | Yes | Report action outcome |
| `GET` | `/agents/:id/reputation` | Yes | Reputation breakdown |
| `POST` | `/agents/:id/stake` | Yes | Add stake/collateral |
| `POST` | `/agents/:id/vouch` | Yes | Vouch for another agent |
| `POST` | `/certificates/request` | Yes | Get signed certificate |
| `GET` | `/certificates/verify` | No | Verify a certificate |
| `GET` | `/.well-known/station-keys` | No | Station's public key |
| `GET` | `/.well-known/station-info` | No | Station metadata |

**Full interactive docs:** [agentgateway-6f041c655eb3.herokuapp.com/docs](https://agentgateway-6f041c655eb3.herokuapp.com/docs)

## Use Cases

- **E-commerce** — Let AI shopping agents browse and buy, with trust gates for high-value orders
- **Customer support** — AI agents that handle tickets, with reputation tracking per agent
- **Content platforms** — Allow AI to post/edit content, with trust-based rate limits
- **Financial services** — Agent-initiated transactions with stake requirements
- **API marketplaces** — Metered access based on agent reputation

## Roadmap

- [x] Web dashboard for real-time agent monitoring
- [x] ML-powered threat detection (prompt injection, malicious URLs)
- [x] Real-time behavioral tracking (6 detection algorithms)
- [x] Blockchain integration — Base L2 on-chain reputation, certificates, and audit ledger
- [ ] Webhook notifications for trust events
- [ ] Advanced ML behavioral models
- [ ] Agent-to-agent trust delegation
- [ ] Rate limiting by trust tier
- [ ] SDK for Python, Go, Rust
- [ ] Reputation decay over inactivity

## Contributing

We welcome contributions to the **gateway middleware**, **agent SDK**, **behavioral detection algorithms**, and **smart contracts**. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Whether it's improving detection algorithms, building SDKs in new languages, writing contract tests, or documentation — we'd love your help.

## License

MIT - see [LICENSE](LICENSE) for details. Use it anywhere, no strings attached.

---

<div align="center">

**Built for the agent economy.**

[Star this repo](https://github.com/mmsadek96/agentgateway) if you think AI agents need a trust layer.

</div>
