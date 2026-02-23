import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import prisma from '../db/prisma';
import { loadPrivateKey, loadPublicKey } from '../utils/keys';
import { calculateReputationScore } from './reputation';
import { CertificatePayload, CertificateResult } from '../types';
import { issueCertificateOnChain, revokeCertificateOnChain } from './blockchain';

const CERTIFICATE_EXPIRY_SECONDS = parseInt(process.env.CERTIFICATE_EXPIRY_SECONDS || '300', 10);
const ISSUER = 'agent-trust-station';

/**
 * Issue a signed clearance certificate for an agent.
 * The certificate contains the agent's current reputation score and identity info.
 * Gateways verify this certificate to decide whether to allow the agent to act.
 */
export async function issueCertificate(
  agentExternalId: string,
  developerId: string,
  scope?: string[]
): Promise<CertificateResult> {
  // Look up the agent
  const agent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: agentExternalId } }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  if (agent.status === 'banned') {
    throw new Error('Agent is banned — cannot issue certificate');
  }

  if (agent.status === 'suspended') {
    throw new Error('Agent is suspended — cannot issue certificate');
  }

  // Calculate current reputation
  const factors = await calculateReputationScore(agent.id);
  const score = factors.totalScore;

  // Build JWT payload
  const jti = uuid();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + CERTIFICATE_EXPIRY_SECONDS;
  const expiresAt = new Date(exp * 1000);

  const payload: Omit<CertificatePayload, 'iat' | 'exp'> = {
    sub: agent.id,
    agentExternalId: agent.externalId,
    developerId: agent.developerId,
    score,
    identityVerified: agent.identityVerified,
    status: agent.status,
    totalActions: agent.totalActions,
    successRate: agent.totalActions > 0
      ? Math.round((agent.successfulActions / agent.totalActions) * 100) / 100
      : null,
    // Include scope manifest if provided — limits which gateway actions this cert authorizes
    ...(scope && scope.length > 0 ? { scope } : {}),
    iss: ISSUER,
    jti
  };

  // Sign with RS256
  const privateKey = loadPrivateKey();
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: CERTIFICATE_EXPIRY_SECONDS
  });

  // Record the certificate in the database
  await prisma.certificate.create({
    data: {
      jti,
      agentId: agent.id,
      score,
      expiresAt
    }
  });

  // Issue certificate on-chain (non-blocking)
  issueCertificateOnChain(jti, agent.id, score, scope, expiresAt)
    .catch((err) => console.error('[Blockchain] Failed to issue certificate on-chain:', err.message));

  return { token, expiresAt, score };
}

/**
 * Verify a certificate token.
 * Checks the cryptographic signature, expiry, and that the certificate hasn't been revoked.
 */
export async function verifyCertificate(token: string): Promise<CertificatePayload | null> {
  try {
    const publicKey = loadPublicKey();
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: ISSUER
    }) as CertificatePayload;

    // Check if the certificate has been revoked
    const cert = await prisma.certificate.findUnique({
      where: { jti: decoded.jti }
    });

    if (!cert) {
      return null; // Certificate not found in records
    }

    if (cert.revoked) {
      return null; // Certificate has been revoked
    }

    return decoded;
  } catch {
    return null; // Invalid signature, expired, or malformed
  }
}

/**
 * Revoke a certificate by its JTI.
 */
export async function revokeCertificate(jti: string): Promise<boolean> {
  try {
    await prisma.certificate.update({
      where: { jti },
      data: { revoked: true }
    });
    // Revoke on-chain too (non-blocking)
    revokeCertificateOnChain(jti)
      .catch((err) => console.error('[Blockchain] Failed to revoke certificate on-chain:', err.message));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the station's public key in PEM format.
 * Gateways use this to verify certificates locally without calling the station.
 */
export function getStationPublicKey(): string {
  return loadPublicKey();
}
