import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';

export interface AuthenticatedRequest extends Request {
  developer?: {
    id: string;
    email: string;
    companyName: string;
    plan: string;
  };
}

export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const apiKey = authHeader.substring(7);

  if (!apiKey) {
    res.status(401).json({ success: false, error: 'API key required' });
    return;
  }

  try {
    // Hash the API key to create a lookup fingerprint (first 8 chars of SHA-256)
    // This avoids iterating all developers for bcrypt comparison
    const keyFingerprint = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

    // Try fingerprint-based lookup first (fast path)
    const developerByFingerprint = await prisma.developer.findFirst({
      where: { apiKeyFingerprint: keyFingerprint }
    });

    if (developerByFingerprint) {
      const isValid = await bcrypt.compare(apiKey, developerByFingerprint.apiKeyHash);
      if (isValid) {
        req.developer = {
          id: developerByFingerprint.id,
          email: developerByFingerprint.email,
          companyName: developerByFingerprint.companyName,
          plan: developerByFingerprint.plan
        };
        next();
        return;
      }
    }

    // SECURITY (#69): Fallback for keys created before fingerprint was added.
    // Limit to developers without a fingerprint set to avoid iterating all rows.
    // Always perform at least one bcrypt.compare to make timing consistent.
    const developersWithoutFP = await prisma.developer.findMany({
      where: { apiKeyFingerprint: null }
    });

    let matchedDeveloper: typeof developersWithoutFP[0] | null = null;
    for (const developer of developersWithoutFP) {
      const isValid = await bcrypt.compare(apiKey, developer.apiKeyHash);
      if (isValid) {
        matchedDeveloper = developer;
        // Don't break — continue comparing to maintain constant-ish timing
      }
    }

    // If no developers without fingerprints exist, do a dummy bcrypt comparison
    // to prevent timing oracle that reveals whether fallback path was entered.
    if (developersWithoutFP.length === 0) {
      await bcrypt.compare(apiKey, '$2b$10$0000000000000000000000000000000000000000000000000000').catch(() => {});
    }

    if (matchedDeveloper) {
      // Backfill fingerprint for future fast lookups
      await prisma.developer.update({
        where: { id: matchedDeveloper.id },
        data: { apiKeyFingerprint: keyFingerprint }
      }).catch(() => {}); // Non-blocking backfill

      req.developer = {
        id: matchedDeveloper.id,
        email: matchedDeveloper.email,
        companyName: matchedDeveloper.companyName,
        plan: matchedDeveloper.plan
      };
      next();
      return;
    }

    res.status(401).json({ success: false, error: 'Invalid API key' });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

/**
 * Verify that the authenticated developer owns the specified agent.
 */
export async function verifyAgentOwnership(
  developerId: string,
  agentId: string,
  res: Response
): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { developerId: true }
  });
  if (!agent) {
    res.status(404).json({ success: false, error: 'Agent not found' });
    return false;
  }
  if (agent.developerId !== developerId) {
    res.status(403).json({ success: false, error: 'You do not own this agent' });
    return false;
  }
  return true;
}

export function generateApiKey(): string {
  // Use cryptographically secure random bytes instead of Math.random()
  const randomBytes = crypto.randomBytes(32);
  return 'ats_' + randomBytes.toString('base64url').slice(0, 32);
}

export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 10);
}
