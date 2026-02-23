# AgentTrust Gateway - Bolt Template

Deploy a trust-verified AI agent gateway with Bolt. This template creates an Express server with the `@agent-trust/gateway` middleware, pre-configured with a demo product catalog that AI agents can interact with using cryptographic certificates.

## Quick Deploy

Click the button below to deploy this template instantly on Bolt:

[![Deploy with Bolt](https://img.shields.io/badge/Deploy%20with-Bolt-blue)](https://bolt.new)

## What This Does

This template runs an Express server that:

- Exposes 4 demo actions (search, get item, add to cart, checkout) gated by reputation score
- Verifies AI agent certificates issued by the AgentTrust Station
- Tracks agent behavior in real-time with derivative-based anomaly detection
- Blocks suspicious agents mid-session if behavioral scores drop too low

## Getting API Keys

1. Visit the AgentTrust Station API docs at your Station URL (default: `https://agentgateway-6f041c655eb3.herokuapp.com/api-docs`)
2. Register as a developer using `POST /developers/register`
3. Register an agent using `POST /agents` with your developer API key
4. Copy your API key and agent ID

## Environment Variables

Set these in your Bolt project environment settings:

| Variable | Required | Description |
|---|---|---|
| `STATION_API_KEY` | Yes | Your developer API key from the Station |
| `AGENT_ID` | Yes | Your registered agent's ID |
| `STATION_URL` | No | Station URL (default: `https://agentgateway-6f041c655eb3.herokuapp.com`) |
| `PORT` | No | Server port (default: `3000`) |

## How Actions Work

Each action requires a minimum reputation score. Agents present a cryptographic certificate (JWT) signed by the Station, and the gateway verifies the score before executing the action.

| Action | Min Score | Description |
|---|---|---|
| `search_items` | 20 | Search the product catalog by keyword or category |
| `get_item` | 30 | Get full details for a product by ID |
| `add_to_cart` | 50 | Add a product to the in-memory shopping cart |
| `checkout` | 70 | Place an order with cart contents |

Higher-risk actions require higher reputation scores. New agents start with a score that increases as they build trust through successful interactions.

## Endpoints

- `GET /` - Gateway info and setup instructions
- `GET /agent-gateway/.well-known/agent-gateway` - Machine-readable action discovery
- `GET /agent-gateway/actions` - List available actions
- `POST /agent-gateway/actions/:actionName` - Execute an action (requires certificate)
- `GET /agent-gateway/behavior/sessions` - View active agent sessions

## Customization

To add your own actions, edit the `actions` object in `index.ts`. Each action needs:

- `description` - What the action does
- `minScore` - Minimum reputation score (0-100) required
- `parameters` - Parameter schema with types and descriptions
- `handler` - Async function that receives params and agent context

## Links

- GitHub: https://github.com/mmsadek96/agentgateway
- NPM: https://www.npmjs.com/package/@agent-trust/gateway
- Station API Docs: https://agentgateway-6f041c655eb3.herokuapp.com/api-docs
