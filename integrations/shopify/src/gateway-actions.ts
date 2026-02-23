/**
 * AgentTrust gateway action definitions for Shopify store operations.
 *
 * Each action declares the minimum trust score an AI agent must hold before
 * it is allowed to execute the action. Lower-risk read operations have low
 * thresholds; write / purchase operations require higher trust.
 */

import { ShopifyClient } from "./shopify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
}

export interface ActionDefinition {
  description: string;
  minScore: number;
  parameters: Record<string, ActionParameter>;
  handler: (params: Record<string, any>) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the complete set of Shopify gateway actions.
 *
 * @param getShopClient - Callback that returns a ShopifyClient for the
 *   current request context (shop domain resolved from session / headers).
 */
export function createShopifyActions(
  getShopClient: () => ShopifyClient
): Record<string, ActionDefinition> {
  return {
    // ------------------------------------------------------------------
    // search_products  (minScore: 20)
    // ------------------------------------------------------------------
    search_products: {
      description:
        "Search for products in the Shopify store by query string. Returns product title, price, image, and handle.",
      minScore: 20,
      parameters: {
        query: {
          type: "string",
          description: "Search query (e.g. product name, keyword, SKU)",
          required: true,
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return (default 10, max 50)",
          required: false,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const limit = Math.min(params.limit ?? 10, 50);
        const products = await client.searchProducts(params.query, limit);
        return { products, count: products.length };
      },
    },

    // ------------------------------------------------------------------
    // get_product  (minScore: 30)
    // ------------------------------------------------------------------
    get_product: {
      description:
        "Get detailed information about a specific product including variants, images, and description.",
      minScore: 30,
      parameters: {
        product_id: {
          type: "number",
          description: "The numeric Shopify product ID",
          required: true,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const product = await client.getProduct(params.product_id);
        return {
          id: product.id,
          title: product.title,
          handle: product.handle,
          description: product.body_html,
          vendor: product.vendor,
          product_type: product.product_type,
          variants: product.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: v.price,
            sku: v.sku,
            inventory_quantity: v.inventory_quantity,
          })),
          images: product.images.map((img) => ({
            id: img.id,
            src: img.src,
            alt: img.alt,
          })),
        };
      },
    },

    // ------------------------------------------------------------------
    // get_inventory  (minScore: 40)
    // ------------------------------------------------------------------
    get_inventory: {
      description:
        "Get current inventory / stock levels for a product across all locations.",
      minScore: 40,
      parameters: {
        product_id: {
          type: "number",
          description: "The numeric Shopify product ID",
          required: true,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const levels = await client.getInventory(params.product_id);
        return {
          product_id: params.product_id,
          inventory_levels: levels.map((l) => ({
            inventory_item_id: l.inventory_item_id,
            location_id: l.location_id,
            available: l.available,
            updated_at: l.updated_at,
          })),
        };
      },
    },

    // ------------------------------------------------------------------
    // add_to_cart  (minScore: 50)
    // ------------------------------------------------------------------
    add_to_cart: {
      description:
        "Add products to a cart by creating a Shopify draft order with the specified line items.",
      minScore: 50,
      parameters: {
        line_items: {
          type: "array",
          description:
            'Array of objects with "variant_id" (number) and "quantity" (number)',
          required: true,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const lineItems = (params.line_items as any[]).map((item) => ({
          variant_id: Number(item.variant_id),
          quantity: Number(item.quantity),
        }));
        const draftOrder = await client.createDraftOrder(lineItems);
        return {
          draft_order_id: draftOrder.id,
          status: draftOrder.status,
          total_price: draftOrder.total_price,
          line_items: draftOrder.line_items.map((li) => ({
            title: li.title,
            quantity: li.quantity,
            price: li.price,
          })),
        };
      },
    },

    // ------------------------------------------------------------------
    // checkout  (minScore: 70)
    // ------------------------------------------------------------------
    checkout: {
      description:
        "Complete a draft order (checkout). Converts the draft into a finalised order and returns the order confirmation.",
      minScore: 70,
      parameters: {
        draft_order_id: {
          type: "number",
          description: "The draft order ID returned by the add_to_cart action",
          required: true,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const completed = await client.completeDraftOrder(
          params.draft_order_id
        );
        return {
          draft_order_id: completed.id,
          order_id: completed.order_id,
          status: completed.status,
          total_price: completed.total_price,
          confirmation: `Order #${completed.order_id} has been placed successfully.`,
        };
      },
    },

    // ------------------------------------------------------------------
    // track_order  (minScore: 40)
    // ------------------------------------------------------------------
    track_order: {
      description:
        "Get the current status of an order including financial and fulfillment status.",
      minScore: 40,
      parameters: {
        order_id: {
          type: "number",
          description: "The numeric Shopify order ID",
          required: true,
        },
      },
      handler: async (params) => {
        const client = getShopClient();
        const order = await client.getOrder(params.order_id);
        return {
          order_id: order.id,
          name: order.name,
          email: order.email,
          financial_status: order.financial_status,
          fulfillment_status: order.fulfillment_status ?? "unfulfilled",
          total_price: order.total_price,
          currency: order.currency,
          created_at: order.created_at,
          line_items: order.line_items.map((li) => ({
            title: li.title,
            quantity: li.quantity,
            price: li.price,
          })),
        };
      },
    },
  };
}
