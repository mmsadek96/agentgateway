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

    // Fallback: iterate all developers (for keys created before fingerprint was added)
    const developers = await prisma.developer.findMany();
    for (const developer of developers) {
      const isValid = await bcrypt.compare(apiKey, developer.apiKeyHash);
      if (isValid) {
        // Backfill fingerprint for future fast lookups
        await prisma.developer.update({
          where: { id: developer.id },
          data: { apiKeyFingerprint: keyFingerprint }
        }).catch(() => {}); // Non-blocking backfill

        req.developer = {
          id: developer.id,
          email: developer.email,
          companyName: developer.companyName,
          plan: developer.plan
        };
        next();
        return;
      }
    }

    res.status(401).json({ success: false, error: 'Invalid API key' });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

export function generateApiKey(): string {
  // Use cryptographically secure random bytes instead of Math.random()
  const randomBytes = crypto.randomBytes(32);
  return 'ats_' + randomBytes.toString('base64url').slice(0, 32);
}

export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, 10);
}
