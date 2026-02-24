import { Router, RequestHandler } from 'express';
import { randomBytes } from 'crypto';
import { StationClient } from './station-client';
import { ActionRegistry } from './action-registry';
import { BehaviorTracker } from './behavior-tracker';
import { MLBehaviorAnalyzer } from './ml-analyzer';
import { createCertificateMiddleware } from './middleware/certificate';
import { generateAccessToken } from './access-token';
import { BotShield } from './bot-shield';
import {
  GatewayConfig,
  GatewayRequest,
  AgentContext,
  BotShieldConfig,
  DiscoveryPayload
} from './types';

/**
 * AgentGateway — the core class that website owners instantiate.
 * Creates an Express router with discovery, authentication, action execution,
 * and real-time behavioral tracking.
 *
 * Usage:
 *   const gateway = new AgentGateway({ ... });
 *   app.use('/agent-gateway', gateway.router());
 */
export class AgentGateway {
  private stationClient: StationClient;
  private actionRegistry: ActionRegistry;
  private behaviorTracker: BehaviorTracker;
  private mlAnalyzer: MLBehaviorAnalyzer;
  private config: GatewayConfig;

  // Bot Shield state
  private shieldEnabled: boolean;
  private shieldSecret: string;
  private shieldTtlSeconds: number;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.stationClient = new StationClient(
      config.stationUrl,
      config.stationApiKey,
      config.publicKeyRefreshInterval ?? 3600000 // 1 hour default
    );
    this.actionRegistry = new ActionRegistry(config.actions);
    this.behaviorTracker = new BehaviorTracker(config.behavior ?? {});
    this.mlAnalyzer = new MLBehaviorAnalyzer(config.ml ?? {});

    // Bot Shield setup
    this.shieldEnabled = config.botShield?.enabled ?? false;
    this.shieldSecret = config.botShield?.secret || randomBytes(32).toString('hex');
    this.shieldTtlSeconds = config.botShield?.tokenTtlSeconds ?? 45;

    if (this.shieldEnabled) {
      console.log(`[@agent-trust/gateway] Bot Shield enabled (token TTL: ${this.shieldTtlSeconds}s)`);
    }

    // Initialize ML models in the background (non-blocking)
    this.mlAnalyzer.initialize().catch(() => {
      // Silently handled — ML is optional
    });
  }

  /**
   * Get the behavior tracker instance (for monitoring/dashboard).
   */
  getBehaviorTracker(): BehaviorTracker {
    return this.behaviorTracker;
  }

  /**
   * Get the ML analyzer instance (for monitoring/status checks).
   */
  getMLAnalyzer(): MLBehaviorAnalyzer {
    return this.mlAnalyzer;
  }

  /**
   * Create and return the Express router for this gateway.
   * Mount it on any path: app.use('/agent-gateway', gateway.router())
   */
  router(): Router {
    const router = Router();

    // ─── Discovery Endpoints ───

    /**
     * GET /.well-known/agent-gateway
     * Machine-readable manifest of available actions.
     * Agents call this to discover what this gateway offers.
     */
    router.get('/.well-known/agent-gateway', (_req, res) => {
      const payload: Record<string, unknown> = {
        gatewayId: this.config.gatewayId,
        actions: this.actionRegistry.getDiscoveryPayload(),
        certificateIssuer: 'agent-trust-station',
        version: '1.3.0',
        security: {
          behavioralTracking: true,
          mlAnalysis: this.mlAnalyzer.isAvailable(),
          scopeEnforcement: true,
          botShield: this.shieldEnabled
        }
      };

      // Advertise Bot Shield so agents know to use the access token
      if (this.shieldEnabled) {
        payload.botShield = {
          enabled: true,
          tokenHeader: 'X-Gateway-Access-Token',
          tokenLifetime: this.shieldTtlSeconds,
          description: 'After executing an action, use the returned accessToken to access protected website routes'
        };
      }

      res.json(payload);
    });

    /**
     * GET /actions
     * Alternative discovery endpoint — list available actions.
     */
    router.get('/actions', (_req, res) => {
      res.json({
        gatewayId: this.config.gatewayId,
        actions: this.actionRegistry.getDiscoveryPayload()
      });
    });

    /**
     * GET /behavior/sessions
     * Monitoring endpoint — view active agent sessions and their behavioral scores.
     * Useful for dashboards and real-time monitoring.
     */
    router.get('/behavior/sessions', (_req, res) => {
      res.json({
        success: true,
        data: {
          activeSessions: this.behaviorTracker.getActiveSessions()
        }
      });
    });

    // ─── Protected Action Endpoints ───

    // Certificate validation middleware
    const validateCert = createCertificateMiddleware(this.stationClient);

    /**
     * POST /actions/:actionName
     * Execute an action. Requires a valid agent certificate.
     *
     * Flow:
     * 1. Validate certificate (JWT signature + expiry)
     * 2. Check behavioral score (is agent blocked mid-session?)
     * 3. Check reputation score vs. action minScore
     * 4. Validate parameters
     * 5. Execute handler
     * 6. Record behavior + report to station
     */
    router.post('/actions/:actionName', validateCert, async (req: GatewayRequest, res) => {
      const { actionName } = req.params;
      const params = req.body.params || {};
      const certificate = req.agentCertificate!;

      // ─── Behavioral Check: Is agent blocked mid-session? ───
      if (this.behaviorTracker.isBlocked(certificate.sub)) {
        const stats = this.behaviorTracker.getStats(certificate.sub);
        res.status(403).json({
          success: false,
          error: 'Agent blocked due to suspicious behavior',
          behaviorScore: 0,
          flags: stats?.flagsTriggered || [],
          hint: 'Your behavioral score dropped too low. Wait for session to expire and improve behavior.'
        });

        // Report the block to station
        this.stationClient.submitReport({
          agentId: certificate.sub,
          gatewayId: this.config.gatewayId,
          certificateJti: certificate.jti,
          actions: [{
            actionType: actionName,
            outcome: 'failure',
            metadata: { reason: 'behavioral_block', params },
            performedAt: new Date().toISOString()
          }]
        }).catch(err => {
          console.error(`[@agent-trust/gateway] Failed to submit report:`, err.message);
        });

        return;
      }

      // Check if action exists
      const action = this.actionRegistry.getAction(actionName);
      if (!action) {
        // Record the unknown action attempt
        this.behaviorTracker.recordAction(
          certificate.sub,
          certificate.agentExternalId,
          actionName,
          params,
          false,
          false
        );

        res.status(404).json({
          success: false,
          error: `Action "${actionName}" not found`,
          availableActions: this.actionRegistry.getActionNames()
        });
        return;
      }

      // ─── Scope Enforcement: Check certificate scope manifest ───
      // If the certificate declares a scope, only actions listed in scope are allowed.
      // This catches misaligned behavior — e.g., a "product-search" agent trying to access "checkout".
      if (certificate.scope && certificate.scope.length > 0) {
        if (!certificate.scope.includes(actionName)) {
          // Record the scope violation
          this.behaviorTracker.recordAction(
            certificate.sub,
            certificate.agentExternalId,
            actionName,
            params,
            false,
            false  // Not a score violation — it's a scope violation
          );

          // Report scope violation to station
          this.stationClient.submitReport({
            agentId: certificate.sub,
            gatewayId: this.config.gatewayId,
            certificateJti: certificate.jti,
            actions: [{
              actionType: actionName,
              outcome: 'failure',
              metadata: {
                reason: 'scope_violation',
                declaredScope: certificate.scope,
                attemptedAction: actionName,
                params
              },
              performedAt: new Date().toISOString()
            }]
          }).catch(err => {
            console.error(`[@agent-trust/gateway] Failed to submit scope violation report:`, err.message);
          });

          res.status(403).json({
            success: false,
            error: `Action "${actionName}" is outside this certificate's declared scope`,
            declaredScope: certificate.scope,
            hint: 'Request a new certificate with the correct scope, or use a wildcard scope.'
          });
          return;
        }
      }

      // ─── ML Analysis: Check params for threats (prompt injection, malicious URLs) ───
      if (this.mlAnalyzer.isAvailable()) {
        const mlResult = await this.mlAnalyzer.analyzeRequest(params, certificate.sub);
        if (!mlResult.safe) {
          // Record the ML-detected threat as a behavioral event
          this.behaviorTracker.recordAction(
            certificate.sub,
            certificate.agentExternalId,
            actionName,
            params,
            false,
            false
          );

          // Report to station
          this.stationClient.submitReport({
            agentId: certificate.sub,
            gatewayId: this.config.gatewayId,
            certificateJti: certificate.jti,
            actions: [{
              actionType: actionName,
              outcome: 'failure',
              metadata: {
                reason: 'ml_threat_detected',
                threats: mlResult.threats,
                analysisTimeMs: mlResult.analysisTimeMs,
                params
              },
              performedAt: new Date().toISOString()
            }]
          }).catch(err => {
            console.error(`[@agent-trust/gateway] Failed to submit ML threat report:`, err.message);
          });

          res.status(403).json({
            success: false,
            error: 'Request blocked: Threat detected in parameters',
            threats: mlResult.threats.map(t => ({
              type: t.type,
              field: t.field,
              confidence: t.confidence
            })),
            analysisTimeMs: mlResult.analysisTimeMs,
            hint: 'Your request parameters contain content flagged as potentially malicious.'
          });
          return;
        }
      }

      // Build agent context from certificate
      const agentContext: AgentContext = {
        agentId: certificate.sub,
        externalId: certificate.agentExternalId,
        developerId: certificate.developerId,
        score: certificate.score,
        identityVerified: certificate.identityVerified,
        scope: certificate.scope
      };

      // Check if score meets threshold BEFORE executing
      const scoreMet = agentContext.score >= action.minScore;

      // Execute the action (actionRegistry handles score check internally)
      const result = await this.actionRegistry.execute(actionName, params, agentContext);

      // ─── Record behavior and analyze ───
      const behavior = this.behaviorTracker.recordAction(
        certificate.sub,
        certificate.agentExternalId,
        actionName,
        params,
        result.success,
        scoreMet
      );

      // Attach behavioral data to response
      req.behaviorScore = behavior.behaviorScore;
      req.behaviorFlags = behavior.flags;

      // Submit report to station asynchronously (fire-and-forget)
      this.stationClient.submitReport({
        agentId: certificate.sub,
        gatewayId: this.config.gatewayId,
        certificateJti: certificate.jti,
        actions: [{
          actionType: actionName,
          outcome: result.success ? 'success' : 'failure',
          metadata: {
            params,
            behaviorScore: behavior.behaviorScore,
            behaviorFlags: behavior.flags,
            blocked: behavior.blocked
          },
          performedAt: new Date().toISOString()
        }]
      }).catch(err => {
        console.error(`[@agent-trust/gateway] Failed to submit report to station:`, err.message);
      });

      // Return result to the agent.
      // SECURITY: Explicitly pick allowed fields instead of spreading the handler result.
      // A malicious action handler could inject `accessToken`, `behavior`, or other
      // gateway-controlled fields if we used `{ ...result }` (#18).
      const response: Record<string, unknown> = {
        success: result.success,
        ...(result.data !== undefined && { data: result.data }),
        ...(result.error !== undefined && { error: result.error }),
      };

      // Include behavioral info in response
      if (behavior.flags.length > 0 || behavior.behaviorScore < 80) {
        response.behavior = {
          score: behavior.behaviorScore,
          flags: behavior.flags,
          warning: behavior.behaviorScore < 50
            ? 'Your behavioral score is low. Continued suspicious activity will result in blocking.'
            : behavior.flags.length > 0
              ? 'Behavioral flags detected. Adjust your interaction pattern.'
              : undefined
        };
      }

      // If agent was just blocked by this action
      if (behavior.blocked) {
        res.status(403).json({
          success: false,
          error: 'Agent blocked due to suspicious behavior detected during this session',
          behavior: {
            score: behavior.behaviorScore,
            flags: behavior.flags
          }
        });
        return;
      }

      // ─── Bot Shield: Issue access token on success ───
      if (result.success && this.shieldEnabled) {
        const accessToken = generateAccessToken(
          { secret: this.shieldSecret, ttlSeconds: this.shieldTtlSeconds },
          certificate.sub,
          this.config.gatewayId,
          actionName
        );
        response.accessToken = accessToken;
        res.setHeader('X-Gateway-Access-Token', accessToken);
      }

      if (result.success) {
        res.json(response);
      } else {
        res.status(403).json(response);
      }
    });

    return router;
  }

  // ─── Bot Shield ───

  /**
   * Create a BotShield middleware pre-configured with this gateway's secret.
   * Mount on your website routes to block direct bot access.
   *
   * Usage:
   *   const gateway = createGateway({ ..., botShield: { enabled: true } });
   *   app.use('/agent-gateway', gateway.router());
   *   app.use(gateway.shieldMiddleware({ excludePaths: ['/health'] }));
   */
  shieldMiddleware(overrides?: Partial<BotShieldConfig>): RequestHandler {
    if (!this.shieldEnabled) {
      throw new Error(
        'Bot Shield is not enabled on this gateway. Set botShield: { enabled: true } in GatewayConfig.'
      );
    }

    const shield = new BotShield({
      secret: this.shieldSecret,
      gatewayId: this.config.gatewayId,
      ...overrides
    });

    return shield.middleware();
  }

  // SECURITY (#52): getShieldSecret() removed — exposing the raw HMAC secret via a public
  // getter risks accidental logging or serialization. For different-process deployments,
  // configure the secret explicitly via environment variables (e.g., SHIELD_SECRET)
  // on both the gateway and shield processes.

  /**
   * Check if Bot Shield is enabled on this gateway.
   */
  isShieldEnabled(): boolean {
    return this.shieldEnabled;
  }

  /**
   * Destroy the gateway and clean up resources.
   */
  destroy(): void {
    this.behaviorTracker.destroy();
  }
}

/**
 * Factory function — creates an AgentGateway instance.
 *
 * Example:
 *   const gateway = createGateway({
 *     stationUrl: 'https://station.example.com',
 *     gatewayId: 'my-site',
 *     stationApiKey: 'ats_xxxxx',
 *     actions: {
 *       'search': {
 *         description: 'Search products',
 *         minScore: 30,
 *         parameters: { query: { type: 'string', required: true } },
 *         handler: async (params) => db.search(params.query)
 *       }
 *     },
 *     behavior: {
 *       maxActionsPerMinute: 20,  // Stricter rate limit
 *       onSuspiciousActivity: (event) => {
 *         console.warn('Suspicious agent:', event);
 *       }
 *     }
 *   });
 *   app.use('/agent-gateway', gateway.router());
 */
export function createGateway(config: GatewayConfig): AgentGateway {
  return new AgentGateway(config);
}
