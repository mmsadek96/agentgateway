---
name: agenttrust
description: Get trust certificates and interact with AgentTrust-protected websites. Verifies your reputation, requests signed JWT certificates from a Trust Station, and executes actions on gateways with automatic scope enforcement.
homepage: https://github.com/mmsadek96/agentgateway
metadata: {"openclaw":{"requires":{"env":["AGENTTRUST_STATION_URL","AGENTTRUST_API_KEY","AGENTTRUST_AGENT_ID"]}}}
---

# AgentTrust Skill

This skill lets you interact with websites protected by the [AgentTrust](https://github.com/mmsadek96/agentgateway) trust layer.

## What AgentTrust Does

AgentTrust is the blockchain-backed trust protocol for AI agents. Websites install an AgentTrust Gateway to verify agents before letting them act. You need a trust certificate to interact with these gateways — this skill handles that for you. Every certificate and reputation score is recorded on Base L2 (Coinbase's Ethereum Layer 2), creating an immutable trust history that anyone can independently verify.

## Setup

Set these environment variables:

```
AGENTTRUST_STATION_URL=https://agentgateway-6f041c655eb3.herokuapp.com
AGENTTRUST_API_KEY=your_developer_api_key
AGENTTRUST_AGENT_ID=your_agent_id
```

Then install the SDK:

```bash
npm install @agent-trust/sdk
```

## How to Use

### 1. Get Your Trust Certificate

Before interacting with any AgentTrust-protected gateway, request a certificate:

```javascript
const { createAgentClient } = require('@agent-trust/sdk');

const agent = createAgentClient({
  stationUrl: process.env.AGENTTRUST_STATION_URL,
  apiKey: process.env.AGENTTRUST_API_KEY,
  agentId: process.env.AGENTTRUST_AGENT_ID
});

// Get a certificate (cached automatically)
const certificate = await agent.getCertificate();
```

### 2. Get a Scoped Certificate (Recommended)

Scope manifests declare what you intend to do. Gateways trust scoped agents more:

```javascript
// Declare your purpose — only product-search and view-inventory
const certificate = await agent.getCertificate(false, ['product-search', 'view-inventory']);
```

### 3. Discover What a Gateway Offers

```javascript
const discovery = await agent.discoverGateway('https://shop.example.com/agent-gateway');
console.log(discovery.actions); // Available actions + their required scores
```

### 4. Execute an Action

```javascript
const result = await agent.executeAction(
  'https://shop.example.com/agent-gateway',
  'product-search',
  { query: 'blue widgets' }
);

if (result.success) {
  console.log('Results:', result.data);
} else {
  console.log('Failed:', result.error);
}
```

### 5. Check Your Reputation Score

```javascript
const score = await agent.getScore();
console.log(`Your trust score: ${score}/100`);
```

## Important Notes

- **Certificates expire in 5 minutes** — the SDK auto-refreshes them
- **Your reputation follows you** — good behavior raises your score, bad behavior lowers it permanently (recorded on Base L2)
- **Scope your certificates** — declare what you intend to do; gateways enforce it
- **Behavioral tracking is active** — gateways monitor for suspicious patterns (rapid requests, enumeration, etc.)
- **ML threat detection** — gateways scan parameters for prompt injection attempts
- **On-chain verification** — all trust data is recorded on Base L2 and independently verifiable on [BaseScan](https://basescan.org)

## Quick Reference

| Method | What it does |
|--------|-------------|
| `getCertificate()` | Get/refresh your trust certificate |
| `getCertificate(false, scope)` | Get a scoped certificate |
| `getScore()` | Check your reputation score (0-100) |
| `discoverGateway(url)` | See what a gateway offers |
| `executeAction(url, name, params)` | Run an action on a gateway |
| `executeBatch(url, actions)` | Run multiple actions in sequence |
| `setScope(scope)` | Set default scope for all future certificates |

## Links

- **GitHub:** https://github.com/mmsadek96/agentgateway
- **NPM Gateway:** https://www.npmjs.com/package/@agent-trust/gateway
- **NPM SDK:** https://www.npmjs.com/package/@agent-trust/sdk
- **Live Station:** https://agentgateway-6f041c655eb3.herokuapp.com/
- **API Docs:** https://agentgateway-6f041c655eb3.herokuapp.com/docs
- **Threat Model:** https://github.com/mmsadek96/agentgateway/blob/main/THREAT-MODEL.md
