import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { StationClient } from '../station-client';
import { CertificatePayload, GatewayRequest } from '../types';

/**
 * Extract the JWT token from the request.
 * Supports Authorization: Bearer header and X-Agent-Certificate header.
 */
function extractToken(req: GatewayRequest): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check custom header
  const certHeader = req.headers['x-agent-certificate'] as string | undefined;
  if (certHeader) {
    return certHeader;
  }

  return null;
}

// ─── Revocation Cache ───
// SECURITY (#3): Cache revocation check results per JTI to avoid hitting the station
// on every request. Entries are cached until the certificate expires.
// Revoked certs are cached as `false`, valid certs as `true`.
const revocationCache = new Map<string, { valid: boolean; expiresAt: number }>();
const MAX_REVOCATION_CACHE = 5000;

/** Periodic cleanup of expired revocation cache entries (every 5 minutes) */
const revocationCleanupInterval = setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, entry] of revocationCache) {
    if (entry.expiresAt <= now) {
      revocationCache.delete(jti);
    }
  }
}, 300_000);
if (revocationCleanupInterval.unref) {
  revocationCleanupInterval.unref();
}

/**
 * Check if a certificate has been revoked, using the station's verify endpoint.
 * Results are cached per JTI until the certificate expires.
 */
async function checkRevocation(
  stationClient: StationClient,
  token: string,
  jti: string,
  exp: number
): Promise<boolean> {
  // Check cache first
  const cached = revocationCache.get(jti);
  if (cached) {
    return cached.valid;
  }

  try {
    // Ask the station if this certificate is still valid
    const result = await stationClient.verifyRemote(token);
    const isValid = result !== null;

    // Cache the result (evict oldest if full)
    if (revocationCache.size >= MAX_REVOCATION_CACHE) {
      // Evict expired entries first
      const now = Math.floor(Date.now() / 1000);
      for (const [oldJti, entry] of revocationCache) {
        if (entry.expiresAt <= now) {
          revocationCache.delete(oldJti);
        }
      }
      // If still full, evict the first entry
      if (revocationCache.size >= MAX_REVOCATION_CACHE) {
        const firstKey = revocationCache.keys().next().value;
        if (firstKey) revocationCache.delete(firstKey);
      }
    }

    revocationCache.set(jti, { valid: isValid, expiresAt: exp });
    return isValid;
  } catch {
    // If the station is unreachable, fail open (allow) but don't cache.
    // This preserves availability while still checking when possible.
    return true;
  }
}

export interface CertificateMiddlewareOptions {
  /**
   * SECURITY (#3): Enable remote revocation checking via the station.
   * When true, after local JWT verification succeeds, the middleware will
   * check with the station whether the certificate has been revoked.
   * Results are cached per JTI until the certificate expires.
   * Default: false (local-only verification for backward compatibility).
   */
  checkRevocation?: boolean;
}

/**
 * Create Express middleware that validates agent certificates.
 * Verifies the JWT signature locally using the station's cached public key.
 * Optionally checks certificate revocation status with the station (#3).
 * Attaches the decoded certificate payload to req.agentCertificate.
 */
export function createCertificateMiddleware(
  stationClient: StationClient,
  options?: CertificateMiddlewareOptions
) {
  const enableRevocationCheck = options?.checkRevocation ?? false;

  return async (req: GatewayRequest, res: Response, next: NextFunction) => {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Agent certificate required — pass JWT in Authorization: Bearer header'
      });
      return;
    }

    try {
      // Fetch the station's public key (cached)
      const publicKey = await stationClient.getPublicKey();

      // Verify the JWT locally
      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: 'agent-trust-station'
      }) as CertificatePayload;

      // Check agent status
      if (payload.status === 'banned' || payload.status === 'suspended') {
        res.status(403).json({
          success: false,
          error: `Agent is ${payload.status}`
        });
        return;
      }

      // SECURITY (#3): Check certificate revocation with the station.
      // Without this, a revoked certificate remains usable until it expires
      // (up to the certificate TTL, typically 5–15 minutes).
      if (enableRevocationCheck && payload.jti) {
        const isValid = await checkRevocation(stationClient, token, payload.jti, payload.exp);
        if (!isValid) {
          res.status(403).json({
            success: false,
            error: 'Certificate has been revoked'
          });
          return;
        }
      }

      // Attach to request
      req.agentCertificate = payload;
      req.agentToken = token;
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          success: false,
          error: 'Certificate expired — request a new one from the station'
        });
        return;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({
          success: false,
          error: 'Invalid certificate — signature verification failed'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Certificate validation failed'
      });
    }
  };
}
