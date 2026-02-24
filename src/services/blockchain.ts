import { ethers, Contract, Wallet, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';

// ─── Contract Addresses (Base Mainnet) ───
const AGENT_REGISTRY_ADDRESS = '0xb880bC6b0634812E85EC635B899cA197429069e8';
const CERTIFICATE_REGISTRY_ADDRESS = '0xD3cAf18d292168075653322780EF961BF6394c11';
const REPUTATION_LEDGER_ADDRESS = '0x12181081eec99b541271f1915cD00111dB2f31c6';

// ─── Minimal ABIs (only the functions we call) ───

const AGENT_REGISTRY_ABI = [
  'function registerAgent(bytes32 agentId, bytes32 externalId, bytes32 metadataHash) external',
  'function updateReputation(bytes32 agentId, uint16 newScore, uint32 newTotalActions, uint16 newSuccessRate) external',
  'function batchUpdateReputation(bytes32[] _agentIds, uint16[] newScores, uint32[] newTotalActions, uint16[] newSuccessRates) external',
  'function changeStatus(bytes32 agentId, uint8 newStatus, string reason) external',
  'function slashAgent(bytes32 agentId, uint16 scorePenalty, string reason) external',
  'function getAgent(bytes32 agentId) external view returns (tuple(bytes32 externalId, uint16 reputationScore, uint32 totalActions, uint16 successRate, uint8 status, uint40 registeredAt, uint40 lastUpdated, bytes32 metadataHash))',
  'function getReputation(bytes32 agentId) external view returns (uint16)',
  'function isActive(bytes32 agentId) external view returns (bool)',
  'function getAgentCount() external view returns (uint256 total, uint256 active)',
];

const CERTIFICATE_REGISTRY_ABI = [
  'function issueCertificate(bytes32 certId, bytes32 agentId, uint16 scoreAtIssuance, bytes32 scopeHash, uint40 expiresAt) external',
  'function revokeCertificate(bytes32 certId) external',
  'function batchIssueCertificates(bytes32[] certIds, bytes32[] _agentIds, uint16[] scores, bytes32[] scopeHashes, uint40[] expiries) external',
  'function verifyCertificate(bytes32 certId) external view returns (bool isValid, bytes32 agentId, uint16 score, bytes32 scopeHash)',
  'function getCertificate(bytes32 certId) external view returns (tuple(bytes32 agentId, uint16 scoreAtIssuance, bytes32 scopeHash, uint8 status, uint40 issuedAt, uint40 expiresAt, uint40 revokedAt))',
  'function getActiveCertificate(bytes32 agentId) external view returns (bytes32)',
  'function getStats() external view returns (uint256 total, uint256 active)',
];

const REPUTATION_LEDGER_ABI = [
  'function logEvent(bytes32 agentId, uint8 eventType, uint16 scoreBefore, uint16 scoreAfter, bytes32 evidenceHash) external',
  'function batchLogEvents(bytes32[] _agentIds, uint8[] eventTypes, uint16[] scoresBefore, uint16[] scoresAfter, bytes32[] evidenceHashes) external',
  'function getAgentHistory(bytes32 agentId) external view returns (uint256[])',
  'function getAgentEventCount(bytes32 agentId) external view returns (uint256)',
  'function getStats() external view returns (uint256 _totalEvents, uint256 _totalSlashes, uint256 _totalRewards)',
];

// ─── Status Mapping ───
const STATUS_MAP: Record<string, number> = {
  inactive: 0,
  active: 1,
  suspended: 2,
  banned: 3,
};

// ─── RPC Configuration ───
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// ─── Singleton Instances ───
let provider: JsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let agentRegistry: Contract | null = null;
let certificateRegistry: Contract | null = null;
let reputationLedger: Contract | null = null;
let initialized = false;

// ─── SECURITY (#34): Retry Queue ───
// Failed blockchain writes are queued for retry instead of being silently lost.
// The queue is in-memory (acceptable — the DB is the source of truth, blockchain
// is supplementary). A periodic flush attempts retries up to MAX_RETRIES times.
interface PendingOp {
  fn: () => Promise<string | null>;
  description: string;
  attempts: number;
  firstAttempt: number;
}
const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 30_000; // 30 seconds
const MAX_QUEUE_SIZE = 500;
const retryQueue: PendingOp[] = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Enqueue a failed blockchain operation for retry.
 */
function enqueueRetry(fn: () => Promise<string | null>, description: string): void {
  if (retryQueue.length >= MAX_QUEUE_SIZE) {
    console.warn(`[Blockchain] Retry queue full (${MAX_QUEUE_SIZE}) — dropping: ${description}`);
    return;
  }
  retryQueue.push({ fn, description, attempts: 1, firstAttempt: Date.now() });
}

/**
 * Flush the retry queue — attempt pending operations.
 */
async function flushRetryQueue(): Promise<void> {
  if (retryQueue.length === 0) return;

  const batch = retryQueue.splice(0, retryQueue.length);
  const requeue: PendingOp[] = [];

  for (const op of batch) {
    try {
      await op.fn();
      console.log(`[Blockchain] Retry succeeded: ${op.description} (attempt ${op.attempts + 1})`);
    } catch (err: any) {
      op.attempts++;
      if (op.attempts < MAX_RETRIES) {
        requeue.push(op);
      } else {
        console.error(`[Blockchain] Permanently failed after ${op.attempts} attempts: ${op.description} — ${err?.message || err}`);
      }
    }
  }

  // Put failed items back
  retryQueue.push(...requeue);
}

/**
 * Get retry queue stats for health monitoring.
 */
export function getBlockchainQueueStats(): { pending: number; maxSize: number } {
  return { pending: retryQueue.length, maxSize: MAX_QUEUE_SIZE };
}

/**
 * Initialize blockchain connection.
 * Silently fails if no private key — system works without blockchain.
 */
export function initBlockchain(): boolean {
  const privateKey = process.env.BASE_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[Blockchain] No BASE_PRIVATE_KEY set — on-chain features disabled');
    return false;
  }

  try {
    provider = new JsonRpcProvider(BASE_RPC_URL);
    wallet = new Wallet(privateKey, provider);
    agentRegistry = new Contract(AGENT_REGISTRY_ADDRESS, AGENT_REGISTRY_ABI, wallet);
    certificateRegistry = new Contract(CERTIFICATE_REGISTRY_ADDRESS, CERTIFICATE_REGISTRY_ABI, wallet);
    reputationLedger = new Contract(REPUTATION_LEDGER_ADDRESS, REPUTATION_LEDGER_ABI, wallet);
    initialized = true;
    console.log(`[Blockchain] Connected to Base mainnet — wallet: ${wallet.address}`);

    // Start retry queue flush interval (#34)
    if (!retryTimer) {
      retryTimer = setInterval(() => {
        flushRetryQueue().catch((err) =>
          console.error('[Blockchain] Retry flush error:', err)
        );
      }, RETRY_INTERVAL_MS);
      // Ensure the interval doesn't keep the process alive
      if (retryTimer && typeof retryTimer === 'object' && 'unref' in retryTimer) {
        (retryTimer as NodeJS.Timeout).unref();
      }
    }

    return true;
  } catch (err) {
    console.error('[Blockchain] Failed to initialize:', err);
    return false;
  }
}

export function isBlockchainEnabled(): boolean {
  return initialized;
}

// ─── Helper: Convert UUID to bytes32 ───
export function uuidToBytes32(uuid: string): string {
  return keccak256(toUtf8Bytes(uuid));
}

// ─── Helper: Convert string to bytes32 hash ───
function stringToBytes32(str: string): string {
  return keccak256(toUtf8Bytes(str));
}

// ─── Helper: Convert scope array to bytes32 hash ───
function scopeToHash(scope?: string[]): string {
  if (!scope || scope.length === 0) {
    return ethers.ZeroHash;
  }
  return keccak256(toUtf8Bytes(JSON.stringify(scope.sort())));
}

// ─── Helper: Score 0-100 to uint16 0-1000 ───
function scoreToUint16(score: number): number {
  return Math.round(score * 10);
}

// ─── Helper: Success rate 0-1 to uint16 0-1000 ───
function rateToUint16(rate: number): number {
  return Math.round(rate * 1000);
}

// ════════════════════════════════════════════════════
// AGENT REGISTRY OPERATIONS
// ════════════════════════════════════════════════════

/**
 * Register an agent on-chain.
 * Called when a new agent is created via the API.
 */
export async function registerAgentOnChain(
  agentUuid: string,
  externalId: string,
  developerEmail: string
): Promise<string | null> {
  if (!initialized || !agentRegistry) return null;

  try {
    const agentId = uuidToBytes32(agentUuid);
    const extId = stringToBytes32(externalId);
    const metaHash = stringToBytes32(`${externalId}:${developerEmail}`);

    const tx = await agentRegistry.registerAgent(agentId, extId, metaHash);
    console.log(`[Blockchain] Agent registered on-chain: ${agentUuid} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    // Don't fail the API call if blockchain write fails — enqueue for retry (#34)
    console.error(`[Blockchain] Failed to register agent on-chain:`, err.message || err);
    enqueueRetry(
      () => registerAgentOnChain(agentUuid, externalId, developerEmail),
      `registerAgent(${agentUuid})`
    );
    return null;
  }
}

/**
 * Update an agent's reputation score on-chain.
 */
export async function updateReputationOnChain(
  agentUuid: string,
  newScore: number,
  totalActions: number,
  successRate: number
): Promise<string | null> {
  if (!initialized || !agentRegistry) return null;

  try {
    const agentId = uuidToBytes32(agentUuid);
    const tx = await agentRegistry.updateReputation(
      agentId,
      scoreToUint16(newScore),
      totalActions,
      rateToUint16(successRate)
    );
    console.log(`[Blockchain] Reputation updated: ${agentUuid} -> ${newScore} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to update reputation:`, err.message || err);
    enqueueRetry(
      () => updateReputationOnChain(agentUuid, newScore, totalActions, successRate),
      `updateReputation(${agentUuid})`
    );
    return null;
  }
}

/**
 * Change agent status on-chain (active, suspended, banned).
 */
export async function changeStatusOnChain(
  agentUuid: string,
  newStatus: string,
  reason: string
): Promise<string | null> {
  if (!initialized || !agentRegistry) return null;

  try {
    const agentId = uuidToBytes32(agentUuid);
    const statusCode = STATUS_MAP[newStatus] ?? 0;
    const tx = await agentRegistry.changeStatus(agentId, statusCode, reason);
    console.log(`[Blockchain] Status changed: ${agentUuid} -> ${newStatus} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to change status:`, err.message || err);
    enqueueRetry(
      () => changeStatusOnChain(agentUuid, newStatus, reason),
      `changeStatus(${agentUuid}, ${newStatus})`
    );
    return null;
  }
}

/**
 * Slash an agent's reputation on-chain.
 */
export async function slashAgentOnChain(
  agentUuid: string,
  scorePenalty: number,
  reason: string
): Promise<string | null> {
  if (!initialized || !agentRegistry) return null;

  try {
    const agentId = uuidToBytes32(agentUuid);
    const tx = await agentRegistry.slashAgent(agentId, scoreToUint16(scorePenalty), reason);
    console.log(`[Blockchain] Agent slashed: ${agentUuid} by ${scorePenalty} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to slash agent:`, err.message || err);
    enqueueRetry(
      () => slashAgentOnChain(agentUuid, scorePenalty, reason),
      `slashAgent(${agentUuid})`
    );
    return null;
  }
}

// ════════════════════════════════════════════════════
// CERTIFICATE REGISTRY OPERATIONS
// ════════════════════════════════════════════════════

/**
 * Issue a certificate on-chain.
 * Called when a certificate is issued via the API.
 */
export async function issueCertificateOnChain(
  certJti: string,
  agentUuid: string,
  score: number,
  scope?: string[],
  expiresAtDate?: Date
): Promise<string | null> {
  if (!initialized || !certificateRegistry) return null;

  try {
    const certId = uuidToBytes32(certJti);
    const agentId = uuidToBytes32(agentUuid);
    const scopeHash = scopeToHash(scope);
    const expiresAt = expiresAtDate
      ? Math.floor(expiresAtDate.getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 300; // 5 min default

    const tx = await certificateRegistry.issueCertificate(
      certId,
      agentId,
      scoreToUint16(score),
      scopeHash,
      expiresAt
    );
    console.log(`[Blockchain] Certificate issued on-chain: ${certJti} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to issue certificate:`, err.message || err);
    enqueueRetry(
      () => issueCertificateOnChain(certJti, agentUuid, score, scope, expiresAtDate),
      `issueCertificate(${certJti})`
    );
    return null;
  }
}

/**
 * Revoke a certificate on-chain.
 */
export async function revokeCertificateOnChain(
  certJti: string
): Promise<string | null> {
  if (!initialized || !certificateRegistry) return null;

  try {
    const certId = uuidToBytes32(certJti);
    const tx = await certificateRegistry.revokeCertificate(certId);
    console.log(`[Blockchain] Certificate revoked: ${certJti} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to revoke certificate:`, err.message || err);
    enqueueRetry(
      () => revokeCertificateOnChain(certJti),
      `revokeCertificate(${certJti})`
    );
    return null;
  }
}

/**
 * Verify a certificate on-chain (FREE read call).
 * Anyone can call this without a wallet.
 */
export async function verifyCertificateOnChain(
  certJti: string
): Promise<{ isValid: boolean; agentId: string; score: number; scopeHash: string } | null> {
  // For reads, we can use a provider without a wallet
  if (!provider) {
    // Try to create a read-only provider even if wallet isn't set
    try {
      const readProvider = new JsonRpcProvider(BASE_RPC_URL);
      const readContract = new Contract(CERTIFICATE_REGISTRY_ADDRESS, CERTIFICATE_REGISTRY_ABI, readProvider);
      const certId = uuidToBytes32(certJti);
      const result = await readContract.verifyCertificate(certId);
      return {
        isValid: result.isValid,
        agentId: result.agentId,
        score: Number(result.score) / 10,
        scopeHash: result.scopeHash,
      };
    } catch {
      return null;
    }
  }

  try {
    const certId = uuidToBytes32(certJti);
    const result = await certificateRegistry!.verifyCertificate(certId);
    return {
      isValid: result.isValid,
      agentId: result.agentId,
      score: Number(result.score) / 10,
      scopeHash: result.scopeHash,
    };
  } catch (err: any) {
    console.error(`[Blockchain] Failed to verify certificate:`, err.message || err);
    return null;
  }
}

// ════════════════════════════════════════════════════
// REPUTATION LEDGER OPERATIONS
// ════════════════════════════════════════════════════

/**
 * Log a reputation event on-chain.
 * Event types: 0=score_update, 1=slash, 2=reward, 3=status_change
 */
export async function logReputationEventOnChain(
  agentUuid: string,
  eventType: number,
  scoreBefore: number,
  scoreAfter: number,
  evidenceDescription: string
): Promise<string | null> {
  if (!initialized || !reputationLedger) return null;

  try {
    const agentId = uuidToBytes32(agentUuid);
    const evidenceHash = stringToBytes32(evidenceDescription);
    const tx = await reputationLedger.logEvent(
      agentId,
      eventType,
      scoreToUint16(scoreBefore),
      scoreToUint16(scoreAfter),
      evidenceHash
    );
    console.log(`[Blockchain] Reputation event logged: ${agentUuid} ${scoreBefore}->${scoreAfter} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error(`[Blockchain] Failed to log reputation event:`, err.message || err);
    enqueueRetry(
      () => logReputationEventOnChain(agentUuid, eventType, scoreBefore, scoreAfter, evidenceDescription),
      `logReputationEvent(${agentUuid})`
    );
    return null;
  }
}

// ════════════════════════════════════════════════════
// READ-ONLY FUNCTIONS (for dashboard/public)
// ════════════════════════════════════════════════════

/**
 * Get on-chain agent count.
 */
export async function getOnChainAgentCount(): Promise<{ total: number; active: number } | null> {
  if (!provider) return null;

  try {
    const readContract = new Contract(AGENT_REGISTRY_ADDRESS, AGENT_REGISTRY_ABI, provider);
    const result = await readContract.getAgentCount();
    return { total: Number(result.total), active: Number(result.active) };
  } catch {
    return null;
  }
}

/**
 * Get on-chain certificate stats.
 */
export async function getOnChainCertStats(): Promise<{ total: number; active: number } | null> {
  if (!provider) return null;

  try {
    const readContract = new Contract(CERTIFICATE_REGISTRY_ADDRESS, CERTIFICATE_REGISTRY_ABI, provider);
    const result = await readContract.getStats();
    return { total: Number(result.total), active: Number(result.active) };
  } catch {
    return null;
  }
}

/**
 * Get on-chain reputation ledger stats.
 */
export async function getOnChainLedgerStats(): Promise<{ totalEvents: number; totalSlashes: number; totalRewards: number } | null> {
  if (!provider) return null;

  try {
    const readContract = new Contract(REPUTATION_LEDGER_ADDRESS, REPUTATION_LEDGER_ABI, provider);
    const result = await readContract.getStats();
    return {
      totalEvents: Number(result._totalEvents),
      totalSlashes: Number(result._totalSlashes),
      totalRewards: Number(result._totalRewards),
    };
  } catch {
    return null;
  }
}
