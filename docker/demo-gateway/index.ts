import express from 'express';
import { createGateway } from '@agent-trust/gateway';

const STATION_URL = process.env.STATION_URL || 'http://localhost:3456';
const PORT = 3001;

// ─── Mock product data ───

const products = [
  { id: 'prod_001', name: 'Wireless Headphones', price: 79.99, category: 'electronics', inStock: true },
  { id: 'prod_002', name: 'Organic Coffee Beans', price: 24.50, category: 'food', inStock: true },
  { id: 'prod_003', name: 'Running Shoes', price: 129.99, category: 'sports', inStock: true },
  { id: 'prod_004', name: 'Mechanical Keyboard', price: 149.00, category: 'electronics', inStock: false },
  { id: 'prod_005', name: 'Yoga Mat', price: 35.00, category: 'sports', inStock: true },
  { id: 'prod_006', name: 'French Press', price: 42.99, category: 'kitchen', inStock: true },
  { id: 'prod_007', name: 'Bluetooth Speaker', price: 59.99, category: 'electronics', inStock: true },
  { id: 'prod_008', name: 'Trail Mix Variety Pack', price: 18.99, category: 'food', inStock: true },
];

const cart: Array<{ productId: string; quantity: number }> = [];

// ─── Bootstrap: register developer + agent, then start gateway ───

async function bootstrap() {
  console.log('[demo-gateway] Waiting 3 seconds for Station to be ready...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 1: Register a developer
  console.log(`[demo-gateway] Registering developer at ${STATION_URL}...`);
  const devRes = await fetch(`${STATION_URL}/developers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `demo-gateway-${Date.now()}@agenttrust.local`,
      companyName: 'Demo E-Commerce'
    })
  });
  const devData = await devRes.json() as any;

  if (!devData.success) {
    console.error('[demo-gateway] Failed to register developer:', devData.error);
    process.exit(1);
  }

  const apiKey = devData.data.apiKey;
  console.log(`[demo-gateway] Developer registered (key: ${apiKey.substring(0, 16)}...)`);

  // Step 2: Register an agent
  console.log('[demo-gateway] Registering demo agent...');
  const agentRes = await fetch(`${STATION_URL}/developers/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ externalId: 'demo-shop-agent' })
  });
  const agentData = await agentRes.json() as any;

  if (!agentData.success) {
    console.error('[demo-gateway] Failed to register agent:', agentData.error);
    process.exit(1);
  }

  console.log(`[demo-gateway] Agent registered: ${agentData.data.externalId} (score: ${agentData.data.reputationScore})`);

  // Step 3: Create the gateway with 4 e-commerce actions
  const gateway = createGateway({
    stationUrl: STATION_URL,
    gatewayId: 'demo-ecommerce',
    stationApiKey: apiKey,
    actions: {
      search_items: {
        description: 'Search the product catalog by keyword or category',
        minScore: 20,
        parameters: {
          query: { type: 'string', required: false, description: 'Search keyword' },
          category: { type: 'string', required: false, description: 'Filter by category' }
        },
        handler: async (params) => {
          let results = [...products];
          if (params.query) {
            const q = String(params.query).toLowerCase();
            results = results.filter(p =>
              p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
            );
          }
          if (params.category) {
            results = results.filter(p => p.category === String(params.category));
          }
          return { success: true, data: { products: results, total: results.length } };
        }
      },

      get_item: {
        description: 'Get detailed information about a specific product',
        minScore: 30,
        parameters: {
          productId: { type: 'string', required: true, description: 'The product ID to look up' }
        },
        handler: async (params) => {
          const product = products.find(p => p.id === String(params.productId));
          if (!product) {
            return { success: false, error: 'Product not found' };
          }
          return { success: true, data: product };
        }
      },

      add_to_cart: {
        description: 'Add a product to the shopping cart',
        minScore: 50,
        parameters: {
          productId: { type: 'string', required: true, description: 'The product ID to add' },
          quantity: { type: 'number', required: false, description: 'Quantity (default 1)' }
        },
        handler: async (params) => {
          const product = products.find(p => p.id === String(params.productId));
          if (!product) {
            return { success: false, error: 'Product not found' };
          }
          if (!product.inStock) {
            return { success: false, error: 'Product out of stock' };
          }
          const qty = Number(params.quantity) || 1;
          const existing = cart.find(c => c.productId === product.id);
          if (existing) {
            existing.quantity += qty;
          } else {
            cart.push({ productId: product.id, quantity: qty });
          }
          return {
            success: true,
            data: {
              added: { productId: product.id, name: product.name, quantity: qty },
              cartTotal: cart.reduce((sum, c) => {
                const p = products.find(pr => pr.id === c.productId);
                return sum + (p ? p.price * c.quantity : 0);
              }, 0)
            }
          };
        }
      },

      checkout: {
        description: 'Complete the purchase with the current cart contents',
        minScore: 70,
        parameters: {
          shippingAddress: { type: 'string', required: true, description: 'Delivery address' }
        },
        handler: async (params) => {
          if (cart.length === 0) {
            return { success: false, error: 'Cart is empty' };
          }
          const orderTotal = cart.reduce((sum, c) => {
            const p = products.find(pr => pr.id === c.productId);
            return sum + (p ? p.price * c.quantity : 0);
          }, 0);
          const orderId = `order_${Date.now()}`;
          const items = cart.map(c => {
            const p = products.find(pr => pr.id === c.productId)!;
            return { productId: c.productId, name: p.name, quantity: c.quantity, subtotal: p.price * c.quantity };
          });
          // Clear the cart after checkout
          cart.length = 0;
          return {
            success: true,
            data: {
              orderId,
              items,
              total: orderTotal,
              shippingAddress: String(params.shippingAddress),
              status: 'confirmed'
            }
          };
        }
      }
    }
  });

  // Step 4: Mount the gateway on an Express app
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', gateway: 'demo-ecommerce', stationUrl: STATION_URL });
  });

  // Mount the agent gateway
  app.use('/agent-gateway', gateway.router());

  app.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(56));
    console.log('  Demo E-Commerce Gateway');
    console.log('='.repeat(56));
    console.log(`  Gateway:    http://localhost:${PORT}/agent-gateway`);
    console.log(`  Discovery:  http://localhost:${PORT}/agent-gateway/.well-known/agent-gateway`);
    console.log(`  Actions:    http://localhost:${PORT}/agent-gateway/actions`);
    console.log(`  Health:     http://localhost:${PORT}/health`);
    console.log(`  Station:    ${STATION_URL}`);
    console.log('='.repeat(56));
    console.log('');
  });
}

bootstrap().catch(err => {
  console.error('[demo-gateway] Fatal error:', err);
  process.exit(1);
});
