import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
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

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts in dashboard
}));

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : [
        /\.herokuapp\.com$/,
        /\.agenttrust\.dev$/,
        /^https?:\/\/localhost(:\d+)?$/,
      ],
  credentials: true,
}));
app.use(express.json());

// Rate limiting — separate limits for authenticated vs public
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // authenticated API users get higher limit
  message: { success: false, error: 'Too many requests, please try again later' }
});
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // public endpoints
  message: { success: false, error: 'Too many requests, please try again later' }
});
app.use(publicLimiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Swagger docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Landing page
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/developers', developerRoutes);
app.use('/agents', agentRoutes);
app.use('/', verifyRoutes);
app.use('/certificates', certificateRoutes);
app.use('/.well-known', wellknownRoutes);
app.use('/reports', reportRoutes);
app.use('/dashboard', dashboardRoutes);

// DeFi routes
app.use('/trust', trustRoutes);
app.use('/markets', marketRoutes);
app.use('/insurance', insuranceRoutes);
app.use('/vouches/nft', vouchNftRoutes);
app.use('/governance', governanceRoutes);

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
