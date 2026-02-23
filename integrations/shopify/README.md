# AgentTrust Shopify Integration

Add the AgentTrust gateway to any Shopify store so that AI agents can browse products, manage carts, and place orders -- all governed by cryptographic trust scores.

## What It Does

This Shopify app installs as a standard OAuth application on a merchant's store and exposes an **AgentTrust Gateway** endpoint. AI agents authenticate via AgentTrust, receive a trust score, and then interact with the store through a curated set of actions. Higher-risk actions (like checkout) require higher trust scores, protecting merchants from untrusted or malicious agents.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **Shopify Partner Account** | Create one at [partners.shopify.com](https://partners.shopify.com) |
| **Shopify App** | Create an app in the Partner Dashboard to obtain API credentials |
| **AgentTrust Account** | Station URL and API key from [agenttrust.dev](https://agenttrust.dev) |

## Setup

1. **Clone and install dependencies**

   ```bash
   cd integrations/shopify
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your Shopify and AgentTrust credentials
   ```

3. **Update the Shopify app configuration**

   Edit `shopify.app.toml` and replace `REPLACE_WITH_CLIENT_ID` with your app's client ID from the Shopify Partner Dashboard. Update `application_url` and `redirect_urls` to match your deployment host.

4. **Run in development**

   ```bash
   npm run dev
   ```

5. **Build and run in production**

   ```bash
   npm run build
   npm start
   ```

6. **Install on a Shopify store**

   Navigate to `https://YOUR_HOST/auth?shop=STORE_NAME.myshopify.com` to begin the OAuth flow.

## Available Actions

Actions are exposed through the `/agent-gateway` endpoint. Each action enforces a minimum trust score.

| Action | minScore | Description |
|---|---|---|
| `search_products` | 20 | Search products by query string. Returns title, price, image, and handle. |
| `get_product` | 30 | Get full product details including variants and images. |
| `get_inventory` | 40 | Get stock / inventory levels for a product across all locations. |
| `add_to_cart` | 50 | Create a draft order with specified line items (variant ID + quantity). |
| `checkout` | 70 | Complete a draft order and receive an order confirmation. |
| `track_order` | 40 | Get order status including financial and fulfillment details. |

## How Agents Interact With the Store

1. The AI agent authenticates with AgentTrust and receives a trust score.
2. The agent sends a POST request to `/agent-gateway` with its trust score, the target shop domain, the desired action, and any parameters.
3. The gateway validates the trust score against the action's `minScore`.
4. If the score is sufficient the action executes against the Shopify Admin API and the result is returned.
5. If the score is too low a `403` response is returned with details about the required score.

**Example request:**

```json
POST /agent-gateway
{
  "shop": "example.myshopify.com",
  "action": "search_products",
  "params": { "query": "blue shirt", "limit": 5 },
  "trust_score": 45
}
```

**Example response:**

```json
{
  "success": true,
  "action": "search_products",
  "result": {
    "products": [
      {
        "id": "gid://shopify/Product/123",
        "title": "Classic Blue Shirt",
        "handle": "classic-blue-shirt",
        "price": "29.99",
        "currency": "USD",
        "image": "https://cdn.shopify.com/..."
      }
    ],
    "count": 1
  }
}
```

## Architecture

```
+------------------+       +-------------------------+       +------------------+
|                  |       |   AgentTrust Shopify    |       |                  |
|    AI Agent      +------>+   Gateway App           +------>+   Shopify Store  |
|                  |  POST |                         |  REST |   Admin API      |
|  (trust score)   |  /agent-gateway                |  /GraphQL               |
+------------------+       +------------+------------+       +------------------+
                                        |
                                        v
                           +------------+------------+
                           |                         |
                           |   AgentTrust Station    |
                           |   (score verification)  |
                           |                         |
                           +-------------------------+

OAuth Flow:
  Merchant --> /auth?shop=... --> Shopify consent --> /auth/callback --> Token stored

Webhooks:
  Shopify --> /webhooks/orders-create    --> handleOrderCreated()
  Shopify --> /webhooks/orders-fulfilled --> handleOrderFulfilled()
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_API_KEY` | Yes | Shopify app API key from the Partner Dashboard |
| `SHOPIFY_API_SECRET` | Yes | Shopify app API secret |
| `SHOPIFY_SCOPES` | Yes | Comma-separated OAuth scopes (default: `read_products,write_draft_orders,read_orders`) |
| `HOST` | Yes | Public hostname of this app (without protocol) |
| `AGENTTRUST_STATION_URL` | Yes | URL of the AgentTrust Station API |
| `AGENTTRUST_API_KEY` | Yes | API key for the AgentTrust Station |
| `PORT` | No | HTTP port (default: `3000`) |

## Resources

- [Shopify App Development Docs](https://shopify.dev/docs/apps)
- [Shopify Admin API Reference](https://shopify.dev/docs/api/admin-rest)
- [Shopify OAuth Flow](https://shopify.dev/docs/apps/auth/oauth)
- [AgentTrust Documentation](https://docs.agenttrust.dev)
- [AgentTrust GitHub](https://github.com/mmsadek96/agentgateway)
