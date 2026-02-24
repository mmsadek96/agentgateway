import {
  AgentClientConfig,
  CertificateResponse,
  GatewayDiscovery,
  ActionResponse,
  StationInfo
} from './types';

/**
 * Validate that a URL is safe to send credentials to (#21).
 * - Must be HTTPS (or localhost for development)
 * - Must not target private/internal IPs (SSRF prevention)
 */
function validateUrl(urlStr: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid ${label} URL: ${urlStr}`);
  }

  // Require HTTPS in production (allow http only for localhost dev)
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !isLocalhost) {
    throw new Error(`${label} URL must use HTTPS: ${urlStr}`);
  }

  // Block private/internal IPs to prevent SSRF (#21)
  const hostname = parsed.hostname;
  if (!isLocalhost) {
    // Block private IPv4 ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(hostname)) {
      throw new Error(`${label} URL targets a private IP address: ${hostname}`);
    }
    // Block private IPv6
    if (/^(fc|fd|fe80)/i.test(hostname)) {
      throw new Error(`${label} URL targets a private IPv6 address: ${hostname}`);
    }
    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      throw new Error(`${label} URL targets a cloud metadata endpoint: ${hostname}`);
    }
  }

  return parsed;
}

/**
 * Extract the origin (protocol + host) from a URL string.
 */
function getOrigin(urlStr: string): string {
  try {
    return new URL(urlStr).origin;
  } catch {
    return '';
  }
}

/**
 * AgentClient — the main class agents use to interact with the trust system.
 *
 * Handles:
 * - Requesting clearance certificates from the station
 * - Discovering gateway capabilities
 * - Executing actions on gateways with automatic certificate management
 * - Capturing Bot Shield access tokens for accessing protected website routes
 *
 * Usage:
 *   const agent = new AgentClient({
 *     stationUrl: 'https://station.example.com',
 *     apiKey: 'ats_xxxxx',
 *     agentId: 'my-agent-001'
 *   });
 *
 *   const result = await agent.executeAction(
 *     'https://shop.example.com/agent-gateway',
 *     'search_products',
 *     { query: 'blue widgets' }
 *   );
 *
 *   // Use the access token to hit protected website routes
 *   const page = await agent.fetchProtected('https://shop.example.com/api/products');
 */
export class AgentClient {
  private stationUrl: string;
  private apiKey: string;
  private agentId: string;

  // Certificate caching
  private currentCertificate: string | null = null;
  private certificateExpiry: number = 0;
  private currentScope: string[] | undefined;

  // Bot Shield access token (captured from gateway responses)
  private lastAccessToken: string | null = null;
  // Track which gateway origin issued the token (#23)
  private lastTokenOrigin: string | null = null;

  constructor(config: AgentClientConfig) {
    // Validate station URL at construction time (#21)
    validateUrl(config.stationUrl, 'Station');
    this.stationUrl = config.stationUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
  }

  // ─── Station Interaction ───

  /**
   * Request a clearance certificate from the station.
   * Caches the certificate and reuses it until 30 seconds before expiry.
   * @param forceRefresh - Force a new certificate even if cached one is valid
   * @param scope - Optional scope/purpose manifest — limits which gateway actions this certificate authorizes.
   *                Example: ["product-search", "view-inventory"] restricts the agent to only those actions.
   *                If omitted, the certificate has no scope restrictions (wildcard).
   */
  async getCertificate(forceRefresh = false, scope?: string[] | null): Promise<string> {
    // If scope is explicitly passed (including null to clear), update the stored scope
    // If scope is not passed (undefined), keep using the existing stored scope
    // Pass null to explicitly clear scope, pass undefined (or omit) to keep current scope
    const effectiveScope = scope === undefined ? this.currentScope : (scope === null ? undefined : scope);
    const scopeChanged = JSON.stringify(effectiveScope) !== JSON.stringify(this.currentScope);

    // Return cached certificate if still valid (with 30s buffer) and scope hasn't changed
    if (
      !forceRefresh &&
      !scopeChanged &&
      this.currentCertificate &&
      Date.now() < this.certificateExpiry - 30_000
    ) {
      return this.currentCertificate;
    }

    const body: Record<string, unknown> = { agentId: this.agentId };
    if (effectiveScope && effectiveScope.length > 0) {
      body.scope = effectiveScope;
    }

    const response = await fetch(`${this.stationUrl}/certificates/request`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(`Certificate request failed: ${error.error || response.statusText}`);
    }

    const { data } = await response.json() as { data: CertificateResponse };

    this.currentCertificate = data.token;
    this.certificateExpiry = new Date(data.expiresAt).getTime();
    this.currentScope = effectiveScope;

    return data.token;
  }

  /**
   * Get information about the station.
   */
  async getStationInfo(): Promise<StationInfo> {
    const response = await fetch(`${this.stationUrl}/.well-known/station-info`);

    if (!response.ok) {
      throw new Error(`Failed to get station info: ${response.statusText}`);
    }

    return response.json() as Promise<StationInfo>;
  }

  /**
   * Get the agent's current reputation score from the certificate.
   * Requests a fresh certificate to get the latest score.
   */
  async getScore(): Promise<number> {
    const response = await fetch(`${this.stationUrl}/certificates/request`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ agentId: this.agentId })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(`Failed to get score: ${error.error || response.statusText}`);
    }

    const { data } = await response.json() as { data: CertificateResponse };

    // Update cache while we're at it
    this.currentCertificate = data.token;
    this.certificateExpiry = new Date(data.expiresAt).getTime();

    return data.score;
  }

  // ─── Gateway Interaction ───

  /**
   * Discover what actions a gateway supports.
   * @param gatewayUrl - Base URL of the gateway (e.g., "https://shop.example.com/agent-gateway")
   */
  async discoverGateway(gatewayUrl: string): Promise<GatewayDiscovery> {
    // Validate gateway URL (#21, #22)
    validateUrl(gatewayUrl, 'Gateway');
    const url = gatewayUrl.replace(/\/+$/, '');
    const response = await fetch(`${url}/.well-known/agent-gateway`);

    if (!response.ok) {
      throw new Error(`Gateway discovery failed: ${response.statusText}`);
    }

    return response.json() as Promise<GatewayDiscovery>;
  }

  /**
   * Execute an action on a gateway.
   * Automatically manages the certificate (requests/caches/refreshes).
   * If the gateway returns a Bot Shield access token, it's captured automatically.
   *
   * @param gatewayUrl - Base URL of the gateway (must be HTTPS, no private IPs)
   * @param actionName - Name of the action to execute
   * @param params - Parameters for the action
   */
  async executeAction(
    gatewayUrl: string,
    actionName: string,
    params: Record<string, unknown> = {}
  ): Promise<ActionResponse> {
    // Validate gateway URL (#21, #22) — blocks SSRF and cert replay to arbitrary endpoints
    validateUrl(gatewayUrl, 'Gateway');
    const url = gatewayUrl.replace(/\/+$/, '');
    const certificate = await this.getCertificate();

    const response = await fetch(`${url}/actions/${encodeURIComponent(actionName)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${certificate}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ params })
    });

    const result = await response.json() as ActionResponse;

    // If certificate expired, retry once with a fresh certificate
    if (response.status === 401) {
      const freshCertificate = await this.getCertificate(true);

      const retryResponse = await fetch(`${url}/actions/${encodeURIComponent(actionName)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${freshCertificate}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ params })
      });

      const retryResult = await retryResponse.json() as ActionResponse;

      // Capture access token from retry response
      if (retryResult.accessToken) {
        this.lastAccessToken = retryResult.accessToken;
        this.lastTokenOrigin = getOrigin(gatewayUrl); // Track issuing gateway (#23)
      }

      return retryResult;
    }

    // Capture Bot Shield access token if present
    if (result.accessToken) {
      this.lastAccessToken = result.accessToken;
      this.lastTokenOrigin = getOrigin(gatewayUrl); // Track issuing gateway (#23)
    }

    return result;
  }

  /**
   * Execute multiple actions on a gateway in sequence.
   * Uses the same certificate for all actions (if it doesn't expire mid-batch).
   */
  async executeBatch(
    gatewayUrl: string,
    actions: Array<{ actionName: string; params?: Record<string, unknown> }>
  ): Promise<ActionResponse[]> {
    const results: ActionResponse[] = [];

    for (const action of actions) {
      const result = await this.executeAction(
        gatewayUrl,
        action.actionName,
        action.params || {}
      );
      results.push(result);

      // Stop on first failure if needed
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  // ─── Bot Shield (Protected Website Access) ───

  /**
   * Get the last access token received from a gateway action.
   * Returns null if no token has been received yet.
   *
   * Access tokens are short-lived (typically 45 seconds) and single-use.
   * Execute another gateway action to get a new token.
   */
  getLastAccessToken(): string | null {
    return this.lastAccessToken;
  }

  /**
   * Make a request to a protected website route using the Bot Shield access token.
   * The token is automatically included as the X-Gateway-Access-Token header.
   *
   * SECURITY: The target URL must share the same origin as the gateway that issued
   * the token (#23). This prevents token leakage to arbitrary domains.
   *
   * You must first execute a gateway action (via executeAction) to obtain a token.
   *
   * @param url - Full URL of the protected website route (must be same origin as gateway)
   * @param options - Standard fetch options (method, headers, body, etc.)
   * @returns The fetch Response object
   *
   * @example
   *   // Step 1: Execute an action to get a token
   *   await agent.executeAction(gatewayUrl, 'search_products', { query: 'shoes' });
   *
   *   // Step 2: Access protected website routes with the token
   *   const response = await agent.fetchProtected('https://shop.example.com/api/products');
   *   const data = await response.json();
   */
  async fetchProtected(url: string, options?: RequestInit): Promise<Response> {
    if (!this.lastAccessToken) {
      throw new Error(
        'No Bot Shield access token available. Execute a gateway action first to obtain one.'
      );
    }

    // Validate target URL (#21)
    validateUrl(url, 'Protected route');

    // SECURITY: Restrict token to same origin as the issuing gateway (#23).
    // This prevents the access token from being leaked to arbitrary domains.
    const targetOrigin = getOrigin(url);
    if (this.lastTokenOrigin && targetOrigin !== this.lastTokenOrigin) {
      throw new Error(
        `fetchProtected URL origin (${targetOrigin}) does not match the gateway that issued the token (${this.lastTokenOrigin}). ` +
        'Access tokens can only be used on the same origin as the issuing gateway.'
      );
    }

    // Token is single-use — clear it after use
    const token = this.lastAccessToken;
    this.lastAccessToken = null;
    this.lastTokenOrigin = null;

    const headers = new Headers(options?.headers);
    headers.set('X-Gateway-Access-Token', token);

    return fetch(url, { ...options, headers });
  }

  // ─── Scope Management ───

  /**
   * Set a default scope for all future certificate requests.
   * The scope restricts which gateway actions this agent can perform.
   * Pass undefined to clear the scope (wildcard access).
   *
   * Example:
   *   agent.setScope(['product-search', 'view-inventory']);
   */
  setScope(scope: string[] | undefined): void {
    if (JSON.stringify(scope) !== JSON.stringify(this.currentScope)) {
      this.currentScope = scope;
      // Invalidate cached certificate since scope changed
      this.currentCertificate = null;
      this.certificateExpiry = 0;
    }
  }

  /**
   * Get the current scope set on this client.
   */
  getScope(): string[] | undefined {
    return this.currentScope;
  }

  // ─── Utility ───

  /** Clear the cached certificate */
  clearCertificateCache(): void {
    this.currentCertificate = null;
    this.certificateExpiry = 0;
  }

  /** Check if there's a valid cached certificate */
  hasCachedCertificate(): boolean {
    return this.currentCertificate !== null && Date.now() < this.certificateExpiry - 30_000;
  }
}
