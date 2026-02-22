// @agent-trust/gateway — AI Agent Gateway middleware for Express
//
// Install on any Express app to let trusted AI agents interact with your site.
// Agents present cryptographically signed certificates from the Agent Trust Station.
// The gateway verifies the certificate, checks the agent's reputation score,
// monitors real-time behavior, and executes the requested action if trusted.

export { AgentGateway, createGateway } from './gateway';
export { StationClient } from './station-client';
export { ActionRegistry } from './action-registry';
export { BehaviorTracker } from './behavior-tracker';
export { DerivativeMonitor } from './derivative-monitor';
export { MLBehaviorAnalyzer, createMLAnalyzer } from './ml-analyzer';

export type {
  GatewayConfig,
  ActionDefinition,
  ParameterDefinition,
  ActionHandler,
  AgentContext,
  ActionResult,
  PublicActionInfo,
  DiscoveryPayload,
  GatewayRequest,
  // Behavioral tracking types
  BehaviorConfig,
  BehaviorEvent,
  BehaviorFlag,
  SessionStats,
  AgentSession,
  // Derivative monitoring types
  DerivativeConfig,
  DerivativeResult,
  DerivativeState,
  MetricSnapshot
} from './types';

export type {
  MLAnalyzerConfig,
  MLThreat,
  MLThreatType,
  MLAnalysisResult
} from './ml-analyzer';
