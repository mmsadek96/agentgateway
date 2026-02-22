# @agent-trust/sdk

Client SDK for AI agents to request trust certificates and interact with AgentTrust Gateways. Zero runtime dependencies. Part of the [AgentTrust](https://github.com/mmsadek96/agentgateway) ecosystem.

## Install

```bash
npm install @agent-trust/sdk
```

## Quick Start

```typescript
import { createAgentClient } from '@agent-trust/sdk';

const agent = createAgentClient({
  stationUrl: 'https://agentgateway-6f041c655eb3.herokuapp.com',
  apiKey: 'YOUR_API_KEY',
  agentId: 'my-agent-001'
});

// Discover what a gateway offers
const catalog = await agent.discoverGateway('https://shop.example.com/agent-gateway');
console.log(catalog.actions);

// Execute an action (certificate is handled automatically)
const result = await agent.executeAction(
  'https://shop.example.com/agent-gateway',
  'search_products',
  { query: 'mechanical keyboard' }
);

// Execute multiple actions in sequence
const results = await agent.executeBatch(
  'https://shop.example.com/agent-gateway',
  [
    { actionName: 'search_products', params: { query: 'keyboard' } },
    { actionName: 'get_product', params: { productId: 'prod_001' } }
  ]
);
```

## Features

- **Automatic certificate management** — requests, caches, and refreshes JWT certificates
- **Gateway discovery** — programmatically discover available actions
- **Action execution** — call gateway actions with automatic auth
- **Batch execution** — run multiple actions in sequence
- **Auto-retry** — retries once with fresh certificate on 401
- **Zero dependencies** — uses native `fetch` (Node 18+)
- **On-chain recording** — every certificate and reputation change is recorded on Base L2, creating an immutable trust history verifiable on [BaseScan](https://basescan.org/address/0xD3cAf18d292168075653322780EF961BF6394c11)

## API

### `createAgentClient(config)`

Creates an agent client instance.

```typescript
const agent = createAgentClient({
  stationUrl: string,  // URL of the AgentTrust Station
  apiKey: string,      // Developer API key
  agentId: string      // Agent's external ID
});
```

### Methods

| Method | Description |
|--------|-------------|
| `getCertificate(forceRefresh?)` | Get a signed JWT certificate |
| `getScore()` | Get current reputation score |
| `getStationInfo()` | Get station metadata |
| `discoverGateway(url)` | Discover gateway's available actions |
| `executeAction(url, action, params)` | Execute a single action |
| `executeBatch(url, actions)` | Execute multiple actions in sequence |
| `hasCachedCertificate()` | Check if a valid certificate is cached |
| `clearCertificateCache()` | Clear the cached certificate |

## Links

- [Full documentation](https://github.com/mmsadek96/agentgateway)
- [Live Station](https://agentgateway-6f041c655eb3.herokuapp.com/)
- [API docs](https://agentgateway-6f041c655eb3.herokuapp.com/docs)

## License

MIT
