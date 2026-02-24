import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import developerRoutes from './routes/developers';
import agentRoutes from './routes/agents';
import verifyRoutes from './routes/verify';
import certificateRoutes from './routes/certificates';
import wellknownRoutes from './routes/wellknown';
import reportRoutes from './routes/reports';
import dashboardRoutes from './routes/dashboard';
import trustRoutes from './routes/trust';
import marketRoutes from './routes/markets';
import insuranceRoutes from './routes/insurance';
import vouchNftRoutes from './routes/vouchNft';
import governanceRoutes from './routes/governance';
import { initBlockchain } from './services/blockchain';
import { initDefiContracts } from './services/defi';

const app = express();

// Trust proxy (Heroku runs behind a reverse proxy)
app.set('trust proxy', 1);

// Initialize blockchain connection (non-blocking — works without it)
initBlockchain();
initDefiContracts();

// SECURITY (#39): Generate a per-request CSP nonce to replace 'unsafe-inline' for scripts.
// The nonce is attached to res.locals so templates/static files can reference it.
// For inline styles, 'unsafe-inline' is kept (lower risk than scripts).
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security headers
app.use((req, res, next) => {
  const nonce = res.locals.cspNonce;
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${nonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })(req, res, next);
});

// Middleware
// CORS: Use explicit origin list from env. In development, allow localhost.
// SECURITY (#27): No broad wildcard regexes like *.herokuapp.com — any Heroku app
// could make credentialed cross-origin requests. Use CORS_ORIGINS env var in production.
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : [
        /^https?:\/\/localhost(:\d+)?$/,
      ],
  credentials: true,
}));
// SECURITY (#42): Explicit body size limit to prevent memory exhaustion via large payloads
app.use(express.json({ limit: '100kb' }));

// Rate limiting — separate limits for authenticated vs public.
// API limiter keys on API key hash (not IP) to prevent X-Forwarded-For bypass (#14).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // authenticated API users get higher limit
  keyGenerator: (req: Request) => {
    // Use API key fingerprint if present (immune to IP spoofing)
    const authHeader = req.headers.authorization;
    if (authHeader) {
      return crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 16);
    }
    return req.ip || 'unknown';
  },
  message: { success: false, error: 'Too many requests, please try again later' }
});
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // public endpoints
  message: { success: false, error: 'Too many requests, please try again later' }
});
// Stricter rate limit for registration to prevent mass account creation (#16)
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 5, // Max 5 registrations per IP per hour
  message: { success: false, error: 'Too many registration attempts. Please try again later.' }
});
app.use(publicLimiter);

// SECURITY (#39): Serve dashboard with CSP nonce injected into inline scripts.
// This allows the nonce-based CSP to work with the dashboard's inline JavaScript.
app.get('/dashboard.html', (_req: Request, res: Response) => {
  const nonce = res.locals.cspNonce;
  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  try {
    let html = fs.readFileSync(dashboardPath, 'utf-8');
    html = html.replace('<script>', `<script nonce="${nonce}">`);
    res.type('html').send(html);
  } catch {
    res.status(404).send('Dashboard not found');
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// SECURITY (#76): Swagger UI only exposed in non-production to prevent API structure disclosure.
if (process.env.NODE_ENV !== 'production') {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Landing page
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes — apply per-API-key rate limiting to authenticated endpoints (#14, #28)
app.use('/developers/register', registrationLimiter); // Stricter limit on registration (#16)
app.use('/developers', developerRoutes);
app.use('/agents', apiLimiter, agentRoutes);
app.use('/', verifyRoutes);
app.use('/certificates', apiLimiter, certificateRoutes);
app.use('/.well-known', wellknownRoutes);
app.use('/reports', apiLimiter, reportRoutes);
app.use('/dashboard', dashboardRoutes);

// DeFi routes — apply per-API-key rate limit
app.use('/trust', apiLimiter, trustRoutes);
app.use('/markets', apiLimiter, marketRoutes);
app.use('/insurance', apiLimiter, insuranceRoutes);
app.use('/vouches/nft', apiLimiter, vouchNftRoutes);
app.use('/governance', apiLimiter, governanceRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
