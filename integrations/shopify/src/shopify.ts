/**
 * Shopify API client helper.
 *
 * Provides a convenience wrapper around the Shopify Admin REST and GraphQL APIs
 * so that gateway actions can call typed methods instead of crafting raw HTTP
 * requests everywhere.
 */

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  inventory_quantity: number;
  inventory_item_id: number;
}

export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
}

export interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export interface ShopifyLineItem {
  variant_id: number;
  quantity: number;
}

export interface ShopifyDraftOrder {
  id: number;
  order_id: number | null;
  status: string;
  total_price: string;
  line_items: Array<{
    id: number;
    variant_id: number;
    product_id: number;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  created_at: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface ShopifyClient {
  searchProducts(query: string, limit?: number): Promise<any[]>;
  getProduct(productId: number): Promise<ShopifyProduct>;
  getInventory(productId: number): Promise<ShopifyInventoryLevel[]>;
  createDraftOrder(lineItems: ShopifyLineItem[]): Promise<ShopifyDraftOrder>;
  completeDraftOrder(draftOrderId: number): Promise<ShopifyDraftOrder>;
  getOrder(orderId: number): Promise<ShopifyOrder>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function shopifyFetch(
  shop: string,
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `https://${shop}/admin/api/2024-01${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Shopify API error ${response.status} on ${endpoint}: ${body}`
    );
  }

  return response.json();
}

async function shopifyGraphQL(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<any> {
  const url = `https://${shop}/admin/api/2024-01/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify GraphQL error ${response.status}: ${body}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(
      `Shopify GraphQL errors: ${JSON.stringify(json.errors)}`
    );
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Shopify API client bound to a specific shop and access token.
 */
export function createShopifyClient(
  shop: string,
  accessToken: string
): ShopifyClient {
  return {
    /**
     * Search products using GraphQL for efficient filtered queries.
     */
    async searchProducts(query: string, limit = 10): Promise<any[]> {
      const gqlQuery = `
        query searchProducts($query: String!, $first: Int!) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                featuredImage {
                  url
                  altText
                }
              }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(shop, accessToken, gqlQuery, {
        query,
        first: limit,
      });

      return data.products.edges.map((edge: any) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        price: edge.node.priceRangeV2?.minVariantPrice?.amount ?? null,
        currency:
          edge.node.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        image: edge.node.featuredImage?.url ?? null,
      }));
    },

    /**
     * Get full product details via the REST Admin API.
     */
    async getProduct(productId: number): Promise<ShopifyProduct> {
      const data = await shopifyFetch(
        shop,
        accessToken,
        `/products/${productId}.json`
      );
      return data.product;
    },

    /**
     * Get inventory levels for every variant of a product.
     */
    async getInventory(productId: number): Promise<ShopifyInventoryLevel[]> {
      // First retrieve the product to get inventory_item_ids from its variants
      const product = await this.getProduct(productId);
      const inventoryItemIds = product.variants.map(
        (v) => v.inventory_item_id
      );

      const idsParam = inventoryItemIds.join(",");
      const data = await shopifyFetch(
        shop,
        accessToken,
        `/inventory_levels.json?inventory_item_ids=${idsParam}`
      );

      return data.inventory_levels;
    },

    /**
     * Create a draft order containing the given line items.
     */
    async createDraftOrder(
      lineItems: ShopifyLineItem[]
    ): Promise<ShopifyDraftOrder> {
      const data = await shopifyFetch(
        shop,
        accessToken,
        "/draft_orders.json",
        {
          method: "POST",
          body: JSON.stringify({
            draft_order: {
              line_items: lineItems,
            },
          }),
        }
      );
      return data.draft_order;
    },

    /**
     * Complete (finalise) a draft order, turning it into a real order.
     */
    async completeDraftOrder(
      draftOrderId: number
    ): Promise<ShopifyDraftOrder> {
      const data = await shopifyFetch(
        shop,
        accessToken,
        `/draft_orders/${draftOrderId}/complete.json`,
        { method: "PUT" }
      );
      return data.draft_order;
    },

    /**
     * Get order details by order ID.
     */
    async getOrder(orderId: number): Promise<ShopifyOrder> {
      const data = await shopifyFetch(
        shop,
        accessToken,
        `/orders/${orderId}.json`
      );
      return data.order;
    },
  };
}
