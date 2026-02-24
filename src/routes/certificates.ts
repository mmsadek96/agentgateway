import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { issueCertificate, verifyCertificate } from '../services/certificates';

const router = Router();

// SECURITY (#29): Per-agent rate limit on certificate issuance.
// Prevents a single agent from flooding the station with cert requests.
// Keys on a hash of (API key + agentId) to limit per-agent, not just per-developer.
const certIssuanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 certificates per agent per minute
  keyGenerator: (req: Request) => {
    const authHeader = req.headers.authorization || '';
    const body = req.body as Record<string, unknown> | undefined;
    const agentId = body?.agentId || '';
    return crypto.createHash('sha256').update(`${authHeader}:${agentId}`).digest('hex').slice(0, 16);
  },
  message: { success: false, error: 'Too many certificate requests for this agent. Please try again later.' }
});

/**
 * POST /certificates/request
 * Agent requests a clearance certificate from the station.
 * Requires developer API key authentication.
 */
router.post('/request', certIssuanceLimiter, authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId, scope } = req.body;

    if (!agentId) {
      res.status(400).json({ success: false, error: 'agentId required' });
      return;
    }

    // Validate scope if provided — must be an array of non-empty strings
    if (scope !== undefined) {
      if (!Array.isArray(scope) || !scope.every((s: unknown) => typeof s === 'string' && s.length > 0)) {
        res.status(400).json({
          success: false,
          error: 'scope must be an array of non-empty strings (e.g., ["product-search", "view-inventory"])'
        });
        return;
      }
    }

    const result = await issueCertificate(agentId, developerId, scope);

    res.json({
      success: true,
      data: {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        score: result.score
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Certificate issuance failed';
    console.error('Certificate request error:', error);
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * GET /certificates/verify
 * Verify a certificate token.
 * Public endpoint — gateways call this to validate an agent's certificate.
 * Token can be passed as query param or in Authorization header.
 */
router.get('/verify', async (req: Request, res: Response) => {
  try {
    // Extract token from query param or Authorization header
    let token = req.query.token as string | undefined;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      res.status(400).json({
        success: false,
        error: 'Token required — pass as ?token= query param or Authorization: Bearer header'
      });
      return;
    }

    const payload = await verifyCertificate(token);

    if (!payload) {
      res.json({
        success: true,
        data: { valid: false, payload: null }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        valid: true,
        payload: {
          agentId: payload.sub,
          agentExternalId: payload.agentExternalId,
          developerId: payload.developerId,
          score: payload.score,
          identityVerified: payload.identityVerified,
          status: payload.status,
          totalActions: payload.totalActions,
          successRate: payload.successRate,
          scope: payload.scope || null,
          issuedAt: new Date(payload.iat * 1000).toISOString(),
          expiresAt: new Date(payload.exp * 1000).toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Certificate verify error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

export default router;
