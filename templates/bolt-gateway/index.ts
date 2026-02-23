import express from 'express';
import { createGateway } from '@agent-trust/gateway';

const app = express();
app.use(express.json());

// ─── Configuration ───

const STATION_URL = process.env.STATION_URL || 'https://agentgateway-6f041c655eb3.herokuapp.com';
const STATION_API_KEY = process.env.STATION_API_KEY || '';
const AGENT_ID = process.env.AGENT_ID || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Mock Product Catalog ───

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
}

const catalog: Product[] = [
  { id: 'prod-001', name: 'Wireless Headphones', price: 79.99, category: 'electronics', description: 'Bluetooth over-ear headphones with noise cancellation', inStock: true },
  { id: 'prod-002', name: 'Mechanical Keyboard', price: 129.99, category: 'electronics', description: 'RGB mechanical keyboard with Cherry MX switches', inStock: true },
  { id: 'prod-003', name: 'Running Shoes', price: 94.50, category: 'sports', description: 'Lightweight running shoes with responsive cushioning', inStock: true },
  { id: 'prod-004', name: 'Coffee Maker', price: 49.99, category: 'kitchen', description: '12-cup programmable drip coffee maker', inStock: false },
  { id: 'prod-005', name: 'Backpack', price: 65.00, category: 'travel', description: 'Water-resistant laptop backpack with USB charging port', inStock: true },
  { id: 'prod-006', name: 'Desk Lamp', price: 34.99, category: 'office', description: 'LED desk lamp with adjustable brightness and color temperature', inStock: true },
  { id: 'prod-007', name: 'Yoga Mat', price: 29.99, category: 'sports', description: 'Non-slip exercise mat with carrying strap', inStock: true },
  { id: 'prod-008', name: 'Portable Charger', price: 24.99, category: 'electronics', description: '10000mAh portable power bank with fast charging', inStock: true },
];

// ─── In-Memory Cart ───

const cart: Map<string, Array<{ productId: string; quantity: number }>> = new Map();

// ─── Check API Key ───

if (!STATION_API_KEY) {
  console.log('\n========================================');
  console.log('  AgentTrust Gateway - Setup Required');
  console.log('========================================\n');
  console.log('No STATION_API_KEY found. To get started:\n');
  console.log('1. Register as a developer at:');
  console.log(`   ${STATION_URL}/api-docs\n`);
  console.log('2. Register an agent to get an Agent ID\n');
  console.log('3. Set these environment variables:');
  console.log('   STATION_API_KEY=your_api_key_here');
  console.log('   AGENT_ID=your_agent_id_here\n');
  console.log('The gateway will start in demo mode (actions');
  console.log('will be defined but certificate validation');
  console.log('requires a valid API key).\n');
  console.log('========================================\n');
}

// ─── Create Gateway ───

const gateway = createGateway({
  stationUrl: STATION_URL,
  stationApiKey: STATION_API_KEY,
  gatewayId: 'bolt-demo-gateway',
  actions: {
    search_items: {
      description: 'Search the product catalog by keyword or category',
      minScore: 20,
      parameters: {
        query: { type: 'string', required: false, description: 'Search keyword to match against product names and descriptions' },
        category: { type: 'string', required: false, description: 'Filter by category (electronics, sports, kitchen, travel, office)' },
      },
      handler: async (params) => {
        let results = [...catalog];

        if (params.query) {
          const q = String(params.query).toLowerCase();
          results = results.filter(
            (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
          );
        }

        if (params.category) {
          const cat = String(params.category).toLowerCase();
          results = results.filter((p) => p.category === cat);
        }

        return {
          success: true,
          data: {
            count: results.length,
            items: results.map(({ id, name, price, category, inStock }) => ({
              id, name, price, category, inStock,
            })),
          },
        };
      },
    },

    get_item: {
      description: 'Get full details for a specific product by its ID',
      minScore: 30,
      parameters: {
        id: { type: 'string', required: true, description: 'The product ID (e.g., prod-001)' },
      },
      handler: async (params) => {
        const product = catalog.find((p) => p.id === String(params.id));
        if (!product) {
          return { success: false, error: `Product "${params.id}" not found` };
        }
        return { success: true, data: product };
      },
    },

    add_to_cart: {
      description: 'Add a product to the in-memory shopping cart',
      minScore: 50,
      parameters: {
        productId: { type: 'string', required: true, description: 'The product ID to add' },
        quantity: { type: 'number', required: false, description: 'Quantity to add (default: 1)' },
      },
      handler: async (params, agent) => {
        const productId = String(params.productId);
        const quantity = Number(params.quantity) || 1;

        const product = catalog.find((p) => p.id === productId);
        if (!product) {
          return { success: false, error: `Product "${productId}" not found` };
        }
        if (!product.inStock) {
          return { success: false, error: `Product "${product.name}" is out of stock` };
        }

        const agentCart = cart.get(agent.agentId) || [];
        const existing = agentCart.find((item) => item.productId === productId);
        if (existing) {
          existing.quantity += quantity;
        } else {
          agentCart.push({ productId, quantity });
        }
        cart.set(agent.agentId, agentCart);

        return {
          success: true,
          data: {
            message: `Added ${quantity}x "${product.name}" to cart`,
            cart: agentCart,
          },
        };
      },
    },

    checkout: {
      description: 'Place an order with the items currently in the cart',
      minScore: 70,
      parameters: {
        shippingAddress: { type: 'string', required: false, description: 'Shipping address (demo only)' },
      },
      handler: async (params, agent) => {
        const agentCart = cart.get(agent.agentId);
        if (!agentCart || agentCart.length === 0) {
          return { success: false, error: 'Cart is empty. Add items before checking out.' };
        }

        const items = agentCart.map((item) => {
          const product = catalog.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            name: product?.name || 'Unknown',
            price: product?.price || 0,
            quantity: item.quantity,
            subtotal: (product?.price || 0) * item.quantity,
          };
        });

        const total = items.reduce((sum, item) => sum + item.subtotal, 0);

        // Clear the cart after checkout
        cart.delete(agent.agentId);

        return {
          success: true,
          data: {
            orderId: `order-${Date.now()}`,
            items,
            total: Math.round(total * 100) / 100,
            shippingAddress: params.shippingAddress || 'N/A (demo)',
            status: 'confirmed',
            message: 'Order placed successfully (demo mode - no real charges)',
          },
        };
      },
    },
  },
  behavior: {
    enabled: true,
    maxActionsPerMinute: 30,
    maxFailuresBeforeFlag: 5,
    derivatives: {
      enabled: true,
      windowSeconds: 180,
      predictiveBlockingSeconds: 30,
    },
    onSuspiciousActivity: (event) => {
      console.warn(`[AgentTrust] Suspicious activity: ${event.flag} from agent ${event.agentId}`);
    },
  },
});

// ─── Routes ───

app.get('/', (_req, res) => {
  res.json({
    name: 'AgentTrust Gateway (Bolt Template)',
    version: '1.0.0',
    status: STATION_API_KEY ? 'configured' : 'setup_required',
    station: STATION_URL,
    gatewayPath: '/agent-gateway',
    discoveryUrl: '/agent-gateway/.well-known/agent-gateway',
    setup: !STATION_API_KEY
      ? {
          message: 'Set STATION_API_KEY and AGENT_ID environment variables to activate the gateway',
          steps: [
            `1. Go to ${STATION_URL}/api-docs and register as a developer`,
            '2. Register an agent to get an Agent ID',
            '3. Set STATION_API_KEY and AGENT_ID in your environment variables',
            '4. Restart the server',
          ],
        }
      : undefined,
    actions: {
      search_items: { minScore: 20, description: 'Search the product catalog' },
      get_item: { minScore: 30, description: 'Get product details by ID' },
      add_to_cart: { minScore: 50, description: 'Add a product to the cart' },
      checkout: { minScore: 70, description: 'Place an order' },
    },
  });
});

app.use('/agent-gateway', gateway.router());

// ─── Start Server ───

app.listen(PORT, () => {
  console.log(`\nAgentTrust Gateway running on port ${PORT}`);
  console.log(`  Root:       http://localhost:${PORT}/`);
  console.log(`  Gateway:    http://localhost:${PORT}/agent-gateway`);
  console.log(`  Discovery:  http://localhost:${PORT}/agent-gateway/.well-known/agent-gateway`);
  console.log(`  Actions:    http://localhost:${PORT}/agent-gateway/actions\n`);
});
