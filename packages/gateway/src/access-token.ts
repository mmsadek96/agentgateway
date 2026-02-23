import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ─── Access Token Types ───

export interface AccessTokenConfig {
  /** Shared secret for HMAC-SHA256 signing (minimum 32 characters recommended) */
  secret: string;
  /** Token TTL in seconds (default: 45) */
  ttlSeconds?: number;
}

export interface AccessTokenPayload {
  /** Agent's internal UUID (from certificate sub claim) */
  agentId: string;
  /** Gateway that issued this token */
  gatewayId: string;
  /** The action that was executed to earn this token */
  action: string;
  /** Issued-at timestamp (Unix seconds) */
  iat: number;
  /** Expiry timestamp (Unix seconds) */
  exp: number;
  /** Single-use nonce (16-byte hex string) */
  nonce: string;
}

// ─── Token Generation ───

/**
 * Generate a short-lived HMAC-SHA256 access token.
 *
 * Token format: `<base64url(payload)>.<base64url(hmac_signature)>`
 *
 * These tokens are issued by the gateway after successful action execution.
 * The website's BotShield middleware verifies them to ensure the request
 * came through the gateway rather than being a direct bot request.
 */
export function generateAccessToken(
  config: AccessTokenConfig,
  agentId: string,
  gatewayId: string,
  action: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.ttlSeconds ?? 45;

  const payload: AccessTokenPayload = {
    agentId,
    gatewayId,
    action,
    iat: now,
    exp: now + ttl,
    nonce: randomBytes(16).toString('hex')
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.secret)
    .update(payloadB64)
    .digest();
  const signatureB64 = Buffer.from(signature).toString('base64url');

  return `${payloadB64}.${signatureB64}`;
}

// ─── Token Verification ───

/**
 * Verify an HMAC-SHA256 access token.
 *
 * Returns the decoded payload if valid, or null if:
 * - Token is malformed (not two dot-separated parts)
 * - HMAC signature doesn't match (tampered or wrong secret)
 * - Token is expired
 * - Payload can't be decoded
 *
 * NOTE: Nonce enforcement (replay prevention) is handled by the BotShield
 * middleware, not here. This function only checks cryptographic validity.
 */
export function verifyAccessToken(
  token: string,
  secret: string
): AccessTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, signatureB64] = parts;

    // Recompute HMAC
    const expectedSignature = createHmac('sha256', secret)
      .update(payloadB64)
      .digest();

    // Decode provided signature
    const actualSignature = Buffer.from(signatureB64, 'base64url');

    // Timing-safe comparison to prevent timing attacks
    if (expectedSignature.length !== actualSignature.length) return null;
    if (!timingSafeEqual(expectedSignature, actualSignature)) return null;

    // Decode payload
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload: AccessTokenPayload = JSON.parse(payloadStr);

    // Check required fields
    if (
      !payload.agentId ||
      !payload.gatewayId ||
      !payload.action ||
      !payload.iat ||
      !payload.exp ||
      !payload.nonce
    ) {
      return null;
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}
