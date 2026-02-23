// ─── Client Configuration ───

export interface AgentClientConfig {
  /** URL of the Agent Trust Station (e.g., "https://station.example.com") */
  stationUrl: string;

  /** Developer API key for authenticating with the station */
  apiKey: string;

  /** Agent's external ID (as registered with the station) */
  agentId: string;
}

// ─── Certificate ───

export interface CertificateResponse {
  token: string;
  expiresAt: string;
  score: number;
}

// ─── Gateway Discovery ───

export interface GatewayDiscovery {
  gatewayId: string;
  actions: Record<string, GatewayActionInfo>;
  certificateIssuer: string;
  version: string;
}

export interface GatewayActionInfo {
  description: string;
  minScore: number;
  parameters: Record<string, {
    type: string;
    required: boolean;
    description?: string;
  }>;
}

// ─── Action Execution ───

export interface ActionResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Bot Shield access token for subsequent requests to protected website routes */
  accessToken?: string;
}

// ─── Station Info ───

export interface StationInfo {
  name: string;
  version: string;
  endpoints: Record<string, string>;
  certificateConfig: {
    algorithm: string;
    issuer: string;
    defaultExpirySeconds: number;
  };
}
