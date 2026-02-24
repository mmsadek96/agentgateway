import { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken, AccessTokenPayload } from './access-token';
import { BotShieldConfig, GatewayRequest } from './types';

/**
 * BotShield — Express middleware that blocks direct bot access to websites.
 *
 * Websites mount this middleware on their routes to ensure that only:
 * 1. Browser users (detected via User-Agent heuristics)
 * 2. AI agents with a valid gateway-issued access token
 *
 * ...can access the protected routes. Bots without a valid token get a 403.
 *
 * Usage (same-process with gateway):
 *   const gateway = createGateway({ ..., botShield: { enabled: true } });
 *   app.use('/agent-gateway', gateway.router());
 *   app.use(gateway.shieldMiddleware());  // Auto-shares the secret
 *
 * Usage (standalone):
 *   import { createBotShield } from '@agent-trust/gateway';
 *   app.use(createBotShield({ secret: process.env.SHIELD_SECRET }));
 */
export class BotShield {
  private config: Required<Pick<BotShieldConfig, 'secret' | 'maxTokenAge' | 'allowBrowsers' | 'enforceNonce' | 'maxNonceCache'>> & BotShieldConfig;
  private usedNonces: Map<string, number> = new Map(); // nonce → expiry timestamp
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: BotShieldConfig) {
    // SECURITY (#44): Require 32-character minimum to match access-token recommendation
    // and ensure sufficient entropy for HMAC-SHA256 (256 bits = 32 hex chars).
    if (!config.secret || config.secret.length < 32) {
      throw new Error('BotShield requires a secret of at least 32 characters');
    }

    this.config = {
      maxTokenAge: 60,
      allowBrowsers: false, // Default to false — browser detection is spoofable (#19)
      enforceNonce: true,
      maxNonceCache: 10_000,
      ...config
    };

    // Periodic cleanup of expired nonces (every 60 seconds)
    this.cleanupInterval = setInterval(() => {
      this.cleanExpiredNonces();
    }, 60_000);

    // Don't keep the process alive just for cleanup
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Returns the Express middleware function.
   */
  middleware(): RequestHandler {
    return (req: GatewayRequest, res: Response, next: NextFunction): void => {
      // ─── 1. Check excluded paths ───
      if (this.isExcludedPath(req.path)) {
        next();
        return;
      }

      // ─── 2. Allow browser users through ───
      if (this.config.allowBrowsers) {
        const browserCheck = this.config.isBrowser || defaultIsBrowser;
        if (browserCheck(req)) {
          if (this.config.logger) {
            this.config.logger(`Browser detected — allowing: ${req.method} ${req.path}`);
          }
          next();
          return;
        }
      }

      // ─── 3. Extract access token ───
      const token = req.headers['x-gateway-access-token'] as string | undefined;

      if (!token) {
        this.blockRequest(req, res, 'No gateway access token provided');
        return;
      }

      // ─── 4. Verify HMAC signature and expiry ───
      const payload = verifyAccessToken(token, this.config.secret);

      if (!payload) {
        this.blockRequest(req, res, 'Invalid or expired gateway access token');
        return;
      }

      // ─── 5. Check max token age (stricter than expiry) ───
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.iat > this.config.maxTokenAge) {
        this.blockRequest(req, res, 'Gateway access token too old');
        return;
      }

      // ─── 6. Check gateway ID (if configured) ───
      if (this.config.gatewayId && payload.gatewayId !== this.config.gatewayId) {
        this.blockRequest(req, res, 'Token issued by unknown gateway');
        return;
      }

      // ─── 7. Enforce single-use nonce ───
      if (this.config.enforceNonce) {
        if (this.usedNonces.has(payload.nonce)) {
          this.blockRequest(req, res, 'Token already used (replay detected)');
          return;
        }

        // Clean expired nonces first to make room (safe — expired nonces can't be replayed)
        this.cleanExpiredNonces();

        // Only track if under capacity. If cache is full of UNEXPIRED nonces,
        // reject rather than evict (evicting unexpired nonces opens replay window) (#17)
        if (this.usedNonces.size >= this.config.maxNonceCache) {
          this.blockRequest(req, res, 'Nonce cache full — try again shortly');
          return;
        }

        // Track this nonce
        this.usedNonces.set(payload.nonce, payload.exp);
      }

      // ─── 8. Token is valid — allow through ───
      req.botShieldToken = payload;

      if (this.config.logger) {
        this.config.logger(`Agent ${payload.agentId} allowed via gateway token: ${req.method} ${req.path}`);
      }

      next();
    };
  }

  /**
   * Block a request with a 403 response.
   */
  private blockRequest(req: Request, res: Response, reason: string): void {
    if (this.config.logger) {
      this.config.logger(`BLOCKED: ${reason} — ${req.method} ${req.path} (UA: ${req.headers['user-agent'] || 'none'})`);
    }

    if (this.config.onBlocked) {
      this.config.onBlocked(req, res, reason);
      return;
    }

    res.status(403).json({
      error: 'Access denied',
      reason: 'Bot access to this website requires authentication through the AgentTrust gateway',
      gateway: '/.well-known/agent-gateway',
      hint: 'Execute an action via the gateway to receive an access token, then include it as the X-Gateway-Access-Token header'
    });
  }

  /**
   * Check if the request path is excluded from shield protection.
   */
  private isExcludedPath(requestPath: string): boolean {
    if (!this.config.excludePaths || this.config.excludePaths.length === 0) {
      return false;
    }

    // Normalize path to prevent traversal bypass (#45):
    // e.g., "/health/../admin" → "/admin" (not excluded)
    const { posix } = require('path');
    const normalized = posix.normalize(requestPath);

    return this.config.excludePaths.some(excluded => {
      // Exact match or prefix match with /
      return normalized === excluded || normalized.startsWith(excluded + '/');
    });
  }

  /**
   * Remove expired nonces from the cache.
   */
  private cleanExpiredNonces(): void {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    for (const [nonce, expiry] of this.usedNonces) {
      if (expiry <= now) {
        this.usedNonces.delete(nonce);
        cleaned++;
      }
    }

    if (cleaned > 0 && this.config.logger) {
      this.config.logger(`Cleaned ${cleaned} expired nonces (${this.usedNonces.size} remaining)`);
    }
  }

  // evictOldestNonces removed (#17): Evicting unexpired nonces opens a replay window.
  // Instead, we clean only expired nonces and reject if still full.

  /**
   * Clear the nonce cache (for testing or memory management).
   */
  clearNonceCache(): void {
    this.usedNonces.clear();
  }

  /**
   * Get the number of tracked nonces.
   */
  getNonceCacheSize(): number {
    return this.usedNonces.size;
  }

  /**
   * Destroy — clean up the nonce cleanup interval.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.usedNonces.clear();
  }
}

// ─── Default Browser Detection ───

/**
 * Heuristic-based browser detection.
 * Requires at least 3 of 4 "browser signals" to classify as a browser (#19).
 *
 * WARNING: All these signals are spoofable HTTP headers. This heuristic blocks
 * unsophisticated bots (curl, basic scrapers) but a determined attacker can
 * trivially spoof all 4 signals. For high-security use cases, either:
 * - Set `allowBrowsers: false` (default) and require all clients to use gateway tokens
 * - Provide a custom `isBrowser` function that uses JS challenges or fingerprinting
 *
 * The `isBrowser` config option allows overriding this for stricter checks.
 */
function defaultIsBrowser(req: Request): boolean {
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept'] || '';

  let signals = 0;

  // Signal 1: UA contains browser rendering engine identifiers
  if (/Mozilla\/\d/.test(ua) && /AppleWebKit|Gecko/.test(ua)) {
    signals++;
  }

  // Signal 2: UA contains known browser name
  if (/\b(Chrome|Firefox|Safari|Edge|Opera|Brave|Vivaldi)\b/.test(ua)) {
    signals++;
  }

  // Signal 3: Accepts HTML (browsers request HTML pages)
  if (accept.includes('text/html')) {
    signals++;
  }

  // Signal 4: Fetch Metadata API headers (modern browsers send these)
  if (req.headers['sec-fetch-mode'] || req.headers['sec-fetch-site']) {
    signals++;
  }

  // Require 3 of 4 signals (raised from 2 to reduce spoofability)
  return signals >= 3;
}

// ─── Factory Function ───

/**
 * Create a BotShield middleware in one call.
 *
 * Example:
 *   import { createBotShield } from '@agent-trust/gateway';
 *
 *   app.use(createBotShield({
 *     secret: process.env.SHIELD_SECRET,
 *     allowBrowsers: true,
 *     excludePaths: ['/health', '/api/public'],
 *     logger: console.log
 *   }));
 */
export function createBotShield(config: BotShieldConfig): RequestHandler {
  const shield = new BotShield(config);
  return shield.middleware();
}
