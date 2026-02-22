import crypto from 'crypto';
import {
  BehaviorConfig,
  BehaviorEvent,
  BehaviorFlag,
  AgentSession,
  SessionAction,
  SessionStats,
  DerivativeResult
} from './types';
import { DerivativeMonitor } from './derivative-monitor';

/**
 * BehaviorTracker — real-time behavioral analysis of agent sessions.
 *
 * Tracks what agents do within a gateway and detects suspicious patterns:
 * - Rapid-fire requests (rate abuse)
 * - High failure rates (probing/brute force)
 * - Action enumeration (scanning available endpoints)
 * - Repeated identical actions (automation)
 * - Scope violations (trying actions above their trust level)
 * - Burst patterns (sudden activity after idle)
 *
 * Each agent gets a behavioral score (0-100) that starts at 100 and
 * decreases with each violation. If the score drops below the block
 * threshold, the agent is blocked mid-session.
 */
export class BehaviorTracker {
  private sessions: Map<string, AgentSession> = new Map();
  private config: Required<Omit<BehaviorConfig, 'onSuspiciousActivity' | 'derivatives'>> & {
    onSuspiciousActivity?: BehaviorConfig['onSuspiciousActivity'];
  };
  private derivativeMonitor: DerivativeMonitor;
  private derivativesEnabled: boolean;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: BehaviorConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      sessionTimeout: config.sessionTimeout ?? 300_000,        // 5 minutes
      maxActionsPerMinute: config.maxActionsPerMinute ?? 30,
      maxFailuresBeforeFlag: config.maxFailuresBeforeFlag ?? 5,
      maxUniqueActionsPerMinute: config.maxUniqueActionsPerMinute ?? 10,
      maxRepeatedActionsPerMinute: config.maxRepeatedActionsPerMinute ?? 10,
      violationPenalty: config.violationPenalty ?? 10,
      blockThreshold: config.blockThreshold ?? 20,
      onSuspiciousActivity: config.onSuspiciousActivity,
    };

    // Initialize derivative monitor
    this.derivativesEnabled = config.derivatives?.enabled !== false;
    this.derivativeMonitor = new DerivativeMonitor(config.derivatives);

    // Clean up expired sessions every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60_000);
  }

  /**
   * Record an action and analyze behavior.
   * Returns the current behavioral score and any new flags.
   */
  recordAction(
    agentId: string,
    externalId: string,
    actionName: string,
    params: Record<string, unknown>,
    success: boolean,
    scoreMet: boolean
  ): { behaviorScore: number; flags: BehaviorFlag[]; blocked: boolean } {
    if (!this.config.enabled) {
      return { behaviorScore: 100, flags: [], blocked: false };
    }

    const now = Date.now();
    let session = this.sessions.get(agentId);

    // Create new session if none exists or previous one expired
    if (!session || (now - session.lastActivityAt) > this.config.sessionTimeout) {
      session = {
        agentId,
        externalId,
        startedAt: now,
        lastActivityAt: now,
        behaviorScore: 100,
        actions: [],
        flags: new Set(),
        blocked: false
      };
      this.sessions.set(agentId, session);
    }

    // Record the action
    const action: SessionAction = {
      actionName,
      paramsHash: this.hashParams(actionName, params),
      success,
      scopeViolation: !scoreMet,
      timestamp: now
    };
    session.actions.push(action);
    session.lastActivityAt = now;

    // If already blocked, don't re-analyze
    if (session.blocked) {
      return { behaviorScore: session.behaviorScore, flags: Array.from(session.flags), blocked: true };
    }

    // ─── Run all behavioral checks ───
    const newFlags: BehaviorFlag[] = [];

    // Check 1: Rapid-fire detection
    if (this.checkRapidFire(session, now)) {
      newFlags.push('rapid_fire');
    }

    // Check 2: High failure rate
    if (this.checkHighFailureRate(session)) {
      newFlags.push('high_failure_rate');
    }

    // Check 3: Action enumeration
    if (this.checkActionEnumeration(session, now)) {
      newFlags.push('action_enumeration');
    }

    // Check 4: Repeated identical actions
    if (this.checkRepeatedActions(session, now)) {
      newFlags.push('repeated_action');
    }

    // Check 5: Scope violation
    if (!scoreMet) {
      newFlags.push('scope_violation');
    }

    // Check 6: Burst detection (activity after idle)
    if (this.checkBurstPattern(session, now)) {
      newFlags.push('burst_detected');
    }

    // ─── Derivative-based checks (7, 8, 9) ───
    let derivativeResult: DerivativeResult | undefined;
    if (this.derivativesEnabled) {
      // Compute current metric values from session
      const oneMinuteAgo = now - 60_000;
      const recentActions = session.actions.filter(a => a.timestamp > oneMinuteAgo);
      const recentFailures = recentActions.filter(a => !a.success).length;
      const recentUnique = new Set(recentActions.map(a => a.actionName)).size;
      const totalSuccessRate = session.actions.length > 0
        ? session.actions.filter(a => a.success).length / session.actions.length
        : 1;

      derivativeResult = this.derivativeMonitor.recordMetrics(agentId, {
        actions_per_minute: recentActions.length,
        failures_per_minute: recentFailures,
        unique_actions_per_minute: recentUnique,
        behavioral_score: session.behaviorScore,
        success_rate: totalSuccessRate,
      });

      // Check 7: Velocity spike (rate of change exceeds threshold)
      if (derivativeResult.flags.some(f => f.startsWith('velocity_spike'))) {
        newFlags.push('velocity_spike');
      }

      // Check 8: Accelerating attack (acceleration exceeds threshold)
      if (derivativeResult.flags.some(f => f.startsWith('accelerating_attack'))) {
        newFlags.push('accelerating_attack');
      }

      // Check 9: Predictive breach (forecasted score below block threshold)
      if (
        derivativeResult.predictedScore !== null &&
        derivativeResult.predictedScore <= this.config.blockThreshold &&
        session.behaviorScore > this.config.blockThreshold // only flag if not already below
      ) {
        newFlags.push('predictive_breach');
      }
    }

    // Apply penalties for NEW flags only
    for (const flag of newFlags) {
      if (!session.flags.has(flag)) {
        session.flags.add(flag);
        session.behaviorScore = Math.max(0, session.behaviorScore - this.config.violationPenalty);

        // Emit event
        if (this.config.onSuspiciousActivity) {
          const event: BehaviorEvent = {
            agentId,
            externalId,
            flag,
            description: this.getDescription(flag),
            behaviorScore: session.behaviorScore,
            sessionStats: this.getSessionStats(session),
            timestamp: new Date().toISOString()
          };
          this.config.onSuspiciousActivity(event);
        }
      }
    }

    // For repeated violations of the SAME type, apply reduced penalties
    for (const flag of newFlags) {
      if (session.flags.has(flag) && flag !== 'scope_violation') {
        // Escalating penalty: each repeat costs more
        session.behaviorScore = Math.max(0, session.behaviorScore - Math.floor(this.config.violationPenalty / 2));
      }
    }

    // Scope violations always cost (they're deliberate)
    if (!scoreMet && session.flags.has('scope_violation')) {
      session.behaviorScore = Math.max(0, session.behaviorScore - this.config.violationPenalty);
    }

    // Check if agent should be blocked
    if (session.behaviorScore <= this.config.blockThreshold) {
      session.blocked = true;
    }

    return {
      behaviorScore: session.behaviorScore,
      flags: newFlags,
      blocked: session.blocked
    };
  }

  /**
   * Check if an agent is currently blocked.
   */
  isBlocked(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    return session?.blocked ?? false;
  }

  /**
   * Get the current behavioral score for an agent.
   */
  getScore(agentId: string): number {
    const session = this.sessions.get(agentId);
    return session?.behaviorScore ?? 100;
  }

  /**
   * Get session stats for an agent.
   */
  getStats(agentId: string): SessionStats | null {
    const session = this.sessions.get(agentId);
    if (!session) return null;
    return this.getSessionStats(session);
  }

  /**
   * Manually block an agent.
   */
  blockAgent(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.blocked = true;
      session.behaviorScore = 0;
    }
  }

  /**
   * Clear an agent's session (reset).
   */
  clearSession(agentId: string): void {
    this.sessions.delete(agentId);
    this.derivativeMonitor.clearAgent(agentId);
  }

  /**
   * Get all active sessions (for monitoring/dashboard).
   */
  getActiveSessions(): Array<{ agentId: string; externalId: string; stats: SessionStats }> {
    const result: Array<{ agentId: string; externalId: string; stats: SessionStats }> = [];
    for (const session of this.sessions.values()) {
      result.push({
        agentId: session.agentId,
        externalId: session.externalId,
        stats: this.getSessionStats(session)
      });
    }
    return result;
  }

  /**
   * Destroy the tracker and stop cleanup interval.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.derivativeMonitor.clear();
  }

  // ─── Behavioral Checks ───

  /** Check 1: Too many actions per minute */
  private checkRapidFire(session: AgentSession, now: number): boolean {
    const oneMinuteAgo = now - 60_000;
    const recentActions = session.actions.filter(a => a.timestamp > oneMinuteAgo);
    return recentActions.length > this.config.maxActionsPerMinute;
  }

  /** Check 2: Too many failures */
  private checkHighFailureRate(session: AgentSession): boolean {
    const failures = session.actions.filter(a => !a.success).length;
    return failures >= this.config.maxFailuresBeforeFlag;
  }

  /** Check 3: Trying many different action types (scanning) */
  private checkActionEnumeration(session: AgentSession, now: number): boolean {
    const oneMinuteAgo = now - 60_000;
    const recentActions = session.actions.filter(a => a.timestamp > oneMinuteAgo);
    const uniqueActions = new Set(recentActions.map(a => a.actionName));
    return uniqueActions.size > this.config.maxUniqueActionsPerMinute;
  }

  /** Check 4: Same action with same params repeated (automation) */
  private checkRepeatedActions(session: AgentSession, now: number): boolean {
    const oneMinuteAgo = now - 60_000;
    const recentActions = session.actions.filter(a => a.timestamp > oneMinuteAgo);

    // Count identical action+params combos
    const counts = new Map<string, number>();
    for (const action of recentActions) {
      const key = action.paramsHash;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Check if any combo exceeds threshold
    for (const count of counts.values()) {
      if (count > this.config.maxRepeatedActionsPerMinute) {
        return true;
      }
    }
    return false;
  }

  /** Check 6: Sudden burst of activity after being idle */
  private checkBurstPattern(session: AgentSession, now: number): boolean {
    if (session.actions.length < 5) return false; // Need enough data

    const actions = session.actions;
    const lastFive = actions.slice(-5);
    const fiveActionsAgo = actions.length >= 6 ? actions[actions.length - 6] : null;

    if (!fiveActionsAgo) return false;

    // Gap between 6th-last and 5th-last action
    const gap = lastFive[0].timestamp - fiveActionsAgo.timestamp;

    // Time span of last 5 actions
    const recentSpan = lastFive[lastFive.length - 1].timestamp - lastFive[0].timestamp;

    // If there was a long idle period (>30s) followed by 5 rapid actions (<5s)
    return gap > 30_000 && recentSpan < 5_000;
  }

  // ─── Helpers ───

  private hashParams(actionName: string, params: Record<string, unknown>): string {
    const key = `${actionName}:${JSON.stringify(params, Object.keys(params).sort())}`;
    return crypto.createHash('md5').update(key).digest('hex').substring(0, 12);
  }

  private getSessionStats(session: AgentSession): SessionStats {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const recentActions = session.actions.filter(a => a.timestamp > oneMinuteAgo);

    const stats: SessionStats = {
      totalActions: session.actions.length,
      successfulActions: session.actions.filter(a => a.success).length,
      failedActions: session.actions.filter(a => !a.success).length,
      actionsLastMinute: recentActions.length,
      uniqueActionsLastMinute: new Set(recentActions.map(a => a.actionName)).size,
      sessionDuration: now - session.startedAt,
      scopeViolations: session.actions.filter(a => a.scopeViolation).length,
      flagsTriggered: Array.from(session.flags)
    };

    // Include derivative data if available
    if (this.derivativesEnabled) {
      const dState = this.derivativeMonitor.getState(session.agentId);
      if (dState) {
        stats.velocities = dState.velocities;
        stats.accelerations = dState.accelerations;
        stats.predictedScore = dState.predictedScore;
      }
    }

    return stats;
  }

  private getDescription(flag: BehaviorFlag): string {
    const descriptions: Record<BehaviorFlag, string> = {
      'rapid_fire': `Agent exceeded ${this.config.maxActionsPerMinute} actions per minute`,
      'high_failure_rate': `Agent has ${this.config.maxFailuresBeforeFlag}+ failed actions (possible probing)`,
      'action_enumeration': `Agent tried ${this.config.maxUniqueActionsPerMinute}+ unique actions in one minute (scanning)`,
      'repeated_action': `Agent repeated the same action ${this.config.maxRepeatedActionsPerMinute}+ times per minute (automation)`,
      'scope_violation': 'Agent attempted an action above their trust level',
      'session_anomaly': 'Unusual session pattern detected',
      'burst_detected': 'Sudden burst of activity after idle period',
      'velocity_spike': 'Metric rate-of-change exceeds threshold (ramping attack detected)',
      'accelerating_attack': 'Metric acceleration indicates escalating threat pattern',
      'predictive_breach': 'Forecasted behavioral score will breach block threshold within 30 seconds'
    };
    return descriptions[flag];
  }

  private cleanupSessions(): void {
    const now = Date.now();
    for (const [agentId, session] of this.sessions) {
      if ((now - session.lastActivityAt) > this.config.sessionTimeout) {
        this.sessions.delete(agentId);
      }
    }
  }
}
