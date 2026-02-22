# @agent-trust/gateway

Express middleware that lets trusted AI agents interact with your website. Part of the [AgentTrust](https://github.com/mmsadek96/agentgateway) ecosystem.

## Install

```bash
npm install @agent-trust/gateway
```

## Quick Start

```typescript
import express from 'express';
import { createGateway } from '@agent-trust/gateway';

const app = express();
app.use(express.json());

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
      minScore: 70,  // Higher trust required
      parameters: {
        productId: { type: 'string', required: true },
        quantity: { type: 'number', required: true }
      },
      handler: async (params, agent) => {
        return await db.orders.create({ ...params, agentId: agent.agentId });
      }
    }
  },
  behavior: {
    maxActionsPerMinute: 30,
    onSuspiciousActivity: (event) => {
      console.warn('Suspicious agent:', event.flag, event.description);
    }
  }
});

app.use('/agent-gateway', gateway.router());
app.listen(3000);
```

## Features

- **Certificate verification** — validates RS256 JWT certificates from the AgentTrust Station
- **Score-based access** — different actions require different reputation levels
- **Real-time behavioral tracking** — detects and blocks suspicious agents mid-session
- **Auto-reporting** — reports agent behavior back to Station automatically (synced to Base L2 on-chain)
- **Discovery endpoints** — agents can discover available actions programmatically
- **On-chain trust** — every certificate and reputation score is recorded on Base L2, independently verifiable on [BaseScan](https://basescan.org/address/0xb880bC6b0634812E85EC635B899cA197429069e8)

## Behavioral Tracking

The gateway monitors agent behavior in real-time and detects:

| Detection | What it catches |
|-----------|----------------|
| `rapid_fire` | Too many requests per minute |
| `high_failure_rate` | Probing / brute force |
| `action_enumeration` | Scanning endpoints |
| `repeated_action` | Automation (same action on loop) |
| `scope_violation` | Accessing above trust level |
| `burst_detected` | Sudden activity after idle |

Agents get a behavioral score (0-100) that degrades with violations. Drop below threshold = blocked mid-session.

## API

### Routes (mounted on your chosen path)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent-gateway` | Discovery manifest |
| `GET` | `/actions` | List available actions |
| `POST` | `/actions/:name` | Execute an action (cert required) |
| `GET` | `/behavior/sessions` | Monitor active sessions |

## Links

- [Full documentation](https://github.com/mmsadek96/agentgateway)
- [Live Station](https://agentgateway-6f041c655eb3.herokuapp.com/)
- [API docs](https://agentgateway-6f041c655eb3.herokuapp.com/docs)

## License

MIT
