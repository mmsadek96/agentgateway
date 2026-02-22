/**
 * DerivativeMonitor — time-series velocity and acceleration tracking for agent behavior.
 *
 * Computes mathematical derivatives (rate of change) on behavioral metrics:
 *   - 1st derivative (velocity): How fast a metric is changing
 *   - 2nd derivative (acceleration): How fast the rate of change is changing
 *
 * This catches attacks that static thresholds miss:
 *   - Slow ramp-up attacks (velocity reveals gradual escalation)
 *   - Explosive probing (acceleration reveals sudden behavioral shifts)
 *   - Credential compromise (negative momentum on success rate)
 *
 * Uses sliding time windows with exponential smoothing to reduce noise.
 * Runs in O(1) per update — no external dependencies.
 */

import type { DerivativeConfig, DerivativeState, MetricSnapshot, DerivativeResult } from './types';

// ─── Tracked Metrics ───

export type MetricName =
  | 'actions_per_minute'
  | 'failures_per_minute'
  | 'unique_actions_per_minute'
  | 'behavioral_score'
  | 'success_rate';

// ─── Default Config ───

const DEFAULT_CONFIG: Required<DerivativeConfig> = {
  enabled: true,
  windowSeconds: 180,          // 3 minutes of history
  sampleIntervalMs: 10_000,   // Sample every 10 seconds
  maxSamples: 20,             // Keep last 20 samples (~3 min at 10s intervals)
  smoothingFactor: 0.3,       // EMA alpha (0.3 = moderate smoothing)
  velocityThresholds: {
    actions_per_minute: 8,     // Flag if actions/min velocity > 8
    failures_per_minute: 3,    // Flag if failures/min velocity > 3
    unique_actions_per_minute: 5,
    behavioral_score: -15,     // Flag if score dropping fast (negative = bad)
    success_rate: -0.3,        // Flag if success rate dropping fast
  },
  accelerationThresholds: {
    actions_per_minute: 4,     // Flag if accelerating
    failures_per_minute: 2,
    unique_actions_per_minute: 3,
    behavioral_score: -10,
    success_rate: -0.2,
  },
  useAccelerationBlocking: true,
  predictiveBlockingSeconds: 30,
};

// ─── DerivativeMonitor Class ───

export class DerivativeMonitor {
  private states: Map<string, DerivativeState> = new Map(); // agentId → state
  private config: Required<DerivativeConfig>;

  constructor(config: DerivativeConfig = {}) {
    this.config = {
      enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
      windowSeconds: config.windowSeconds ?? DEFAULT_CONFIG.windowSeconds,
      sampleIntervalMs: config.sampleIntervalMs ?? DEFAULT_CONFIG.sampleIntervalMs,
      maxSamples: config.maxSamples ?? DEFAULT_CONFIG.maxSamples,
      smoothingFactor: config.smoothingFactor ?? DEFAULT_CONFIG.smoothingFactor,
      velocityThresholds: { ...DEFAULT_CONFIG.velocityThresholds, ...config.velocityThresholds },
      accelerationThresholds: { ...DEFAULT_CONFIG.accelerationThresholds, ...config.accelerationThresholds },
      useAccelerationBlocking: config.useAccelerationBlocking ?? DEFAULT_CONFIG.useAccelerationBlocking,
      predictiveBlockingSeconds: config.predictiveBlockingSeconds ?? DEFAULT_CONFIG.predictiveBlockingSeconds,
    };
  }

  /**
   * Record a new metric sample for an agent.
   * Call this on every action with the current values of each metric.
   */
  recordMetrics(
    agentId: string,
    metrics: Partial<Record<MetricName, number>>
  ): DerivativeResult {
    if (!this.config.enabled) {
      return { velocities: {}, accelerations: {}, flags: [], predictedScore: null };
    }

    const now = Date.now();
    let state = this.states.get(agentId);

    if (!state) {
      state = { history: new Map(), lastSampleTime: 0 };
      this.states.set(agentId, state);
    }

    // Only sample at configured interval (avoid noise from rapid-fire updates)
    const shouldSample = (now - state.lastSampleTime) >= this.config.sampleIntervalMs;

    const velocities: Partial<Record<MetricName, number>> = {};
    const accelerations: Partial<Record<MetricName, number>> = {};
    const flags: string[] = [];

    for (const [metric, value] of Object.entries(metrics) as Array<[MetricName, number]>) {
      if (value === undefined || value === null) continue;

      let history = state.history.get(metric);
      if (!history) {
        history = [];
        state.history.set(metric, history);
      }

      if (shouldSample) {
        // Add new sample
        history.push({ timestamp: now, value, smoothedValue: value });

        // Apply exponential smoothing
        if (history.length >= 2) {
          const prev = history[history.length - 2];
          const alpha = this.config.smoothingFactor;
          history[history.length - 1].smoothedValue =
            alpha * value + (1 - alpha) * prev.smoothedValue;
        }

        // Keep window bounded
        if (history.length > this.config.maxSamples) {
          history.shift();
        }
      }

      // Calculate derivatives using smoothed values
      const derivatives = this.computeDerivatives(history);
      velocities[metric] = derivatives.velocity;
      accelerations[metric] = derivatives.acceleration;

      // Check velocity thresholds
      const velThreshold = this.config.velocityThresholds[metric];
      if (velThreshold !== undefined && derivatives.velocity !== 0) {
        // For score/success_rate, negative velocity is bad
        if (metric === 'behavioral_score' || metric === 'success_rate') {
          if (derivatives.velocity < velThreshold) {
            flags.push(`velocity_spike:${metric}`);
          }
        } else {
          // For action counts, positive velocity is bad
          if (derivatives.velocity > velThreshold) {
            flags.push(`velocity_spike:${metric}`);
          }
        }
      }

      // Check acceleration thresholds
      if (this.config.useAccelerationBlocking) {
        const accThreshold = this.config.accelerationThresholds[metric];
        if (accThreshold !== undefined && derivatives.acceleration !== 0) {
          if (metric === 'behavioral_score' || metric === 'success_rate') {
            if (derivatives.acceleration < accThreshold) {
              flags.push(`accelerating_attack:${metric}`);
            }
          } else {
            if (derivatives.acceleration > accThreshold) {
              flags.push(`accelerating_attack:${metric}`);
            }
          }
        }
      }
    }

    if (shouldSample) {
      state.lastSampleTime = now;
    }

    // Predictive blocking: forecast behavioral score
    let predictedScore: number | null = null;
    const scoreVelocity = velocities.behavioral_score;
    const currentScore = metrics.behavioral_score;
    if (
      scoreVelocity !== undefined &&
      currentScore !== undefined &&
      this.config.predictiveBlockingSeconds > 0
    ) {
      predictedScore = currentScore + scoreVelocity * this.config.predictiveBlockingSeconds;
      predictedScore = Math.max(0, Math.min(100, predictedScore));
    }

    return { velocities, accelerations, flags, predictedScore };
  }

  /**
   * Compute 1st and 2nd derivatives from a metric's history using finite differences.
   */
  private computeDerivatives(history: MetricSnapshot[]): { velocity: number; acceleration: number } {
    if (history.length < 2) {
      return { velocity: 0, acceleration: 0 };
    }

    const n = history.length;

    // 1st derivative (velocity) = change in smoothed value / change in time
    const dt1 = (history[n - 1].timestamp - history[n - 2].timestamp) / 1000; // seconds
    if (dt1 === 0) return { velocity: 0, acceleration: 0 };

    const velocity = (history[n - 1].smoothedValue - history[n - 2].smoothedValue) / dt1;

    // 2nd derivative (acceleration) — needs 3+ points
    if (history.length < 3) {
      return { velocity, acceleration: 0 };
    }

    const dt2 = (history[n - 1].timestamp - history[n - 3].timestamp) / 1000 / 2; // average timestep
    if (dt2 === 0) return { velocity, acceleration: 0 };

    const acceleration =
      (history[n - 1].smoothedValue - 2 * history[n - 2].smoothedValue + history[n - 3].smoothedValue) /
      (dt2 * dt2);

    return { velocity, acceleration };
  }

  /**
   * Get the current derivative state for an agent (for dashboard/monitoring).
   */
  getState(agentId: string): DerivativeResult | null {
    const state = this.states.get(agentId);
    if (!state) return null;

    const velocities: Partial<Record<MetricName, number>> = {};
    const accelerations: Partial<Record<MetricName, number>> = {};

    for (const [metric, history] of state.history) {
      const d = this.computeDerivatives(history);
      velocities[metric as MetricName] = d.velocity;
      accelerations[metric as MetricName] = d.acceleration;
    }

    return { velocities, accelerations, flags: [], predictedScore: null };
  }

  /**
   * Clear state for an agent (on session reset).
   */
  clearAgent(agentId: string): void {
    this.states.delete(agentId);
  }

  /**
   * Clear all state.
   */
  clear(): void {
    this.states.clear();
  }
}
