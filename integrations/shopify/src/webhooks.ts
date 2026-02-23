/**
 * Shopify webhook handlers.
 *
 * These handlers are invoked when Shopify sends webhook notifications to the
 * app. They can be extended to update AgentTrust reputation scores based on
 * real order events (e.g. successful fulfilments boost the trust score of the
 * agent that placed the order).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Handle the ORDERS_CREATE webhook.
 *
 * Called by Shopify when a new order is created in the store.
 */
export function handleOrderCreated(
  topic: string,
  shop: string,
  body: WebhookPayload
): void {
  const orderId = body.id;
  const totalPrice = body.total_price;
  const email = body.email;

  console.log(
    `[Webhook] ${topic} | Shop: ${shop} | Order #${orderId} | Total: ${totalPrice} | Email: ${email}`
  );

  // TODO: Trigger AgentTrust score update when an agent-placed order is created.
  // Example:
  //   await agentTrustClient.recordEvent({
  //     agentId: resolveAgentFromOrder(body),
  //     event: 'order_created',
  //     metadata: { orderId, totalPrice },
  //   });
}

/**
 * Handle the ORDERS_FULFILLED webhook.
 *
 * Called by Shopify when an order is fully fulfilled. A successful fulfilment
 * is a strong positive signal for the agent's trust score.
 */
export function handleOrderFulfilled(
  topic: string,
  shop: string,
  body: WebhookPayload
): void {
  const orderId = body.id;
  const fulfillmentStatus = body.fulfillment_status;

  console.log(
    `[Webhook] ${topic} | Shop: ${shop} | Order #${orderId} | Fulfillment: ${fulfillmentStatus}`
  );

  // TODO: Trigger a positive trust score adjustment.
  // Example:
  //   await agentTrustClient.recordEvent({
  //     agentId: resolveAgentFromOrder(body),
  //     event: 'order_fulfilled',
  //     metadata: { orderId, fulfillmentStatus },
  //   });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register Shopify webhooks for the given shop.
 *
 * This uses the Shopify Admin REST API to create webhook subscriptions.
 * It should be called after a shop completes the OAuth flow.
 */
export async function registerWebhooks(
  shop: string,
  accessToken: string
): Promise<void> {
  const webhooks = [
    {
      topic: "orders/create",
      address: `https://${process.env.HOST}/webhooks/orders-create`,
    },
    {
      topic: "orders/fulfilled",
      address: `https://${process.env.HOST}/webhooks/orders-fulfilled`,
    },
  ];

  for (const webhook of webhooks) {
    const url = `https://${shop}/admin/api/2024-01/webhooks.json`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        webhook: {
          topic: webhook.topic,
          address: webhook.address,
          format: "json",
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Failed to register webhook ${webhook.topic} for ${shop}: ${errorBody}`
      );
    } else {
      console.log(
        `[Webhooks] Registered ${webhook.topic} for ${shop} -> ${webhook.address}`
      );
    }
  }
}
