/**
 * ML-Enhanced Behavioral Analysis
 *
 * Uses HuggingFace Transformers.js (ONNX Runtime) to run cybersecurity
 * models directly in Node.js for advanced threat detection:
 *
 * 1. Prompt Injection Detection — catches jailbreak attempts in agent params
 *
 * This module is OPTIONAL. If @huggingface/transformers is not installed,
 * the gateway works fine with rule-based detection only.
 *
 * Default model: protectai/deberta-v3-base-prompt-injection-v2 (157K+ downloads)
 * — DeBERTa-v3-base fine-tuned on prompt injection datasets
 * — Has proper onnx/ directory for Transformers.js compatibility
 *
 * Install: npm install @huggingface/transformers
 */

export type MLThreatType = 'prompt_injection' | 'malicious_url';

export interface MLThreat {
  type: MLThreatType;
  field: string;
  confidence: number;
  value: string;
}

export interface MLAnalysisResult {
  safe: boolean;
  threats: MLThreat[];
  analysisTimeMs: number;
}

export interface MLAnalyzerConfig {
  /** Enable/disable ML analysis (default: true if @huggingface/transformers is installed) */
  enabled?: boolean;

  /** Confidence threshold for prompt injection detection (0-1, default: 0.85) */
  injectionThreshold?: number;

  /** Confidence threshold for malicious URL detection (0-1, default: 0.80) */
  urlThreshold?: number;

  /** Minimum text length to analyze for injection (default: 10) */
  minTextLength?: number;

  /**
   * Custom prompt injection model ID.
   * Must have onnx/ directory on HuggingFace for Transformers.js compatibility.
   * Default: protectai/deberta-v3-base-prompt-injection-v2
   */
  injectionModel?: string;

  /**
   * Custom URL detection model ID (optional).
   * Must have onnx/ directory on HuggingFace for Transformers.js compatibility.
   * Default: none (URL detection uses pattern matching only)
   */
  urlModel?: string;

  /** Callback when an ML threat is detected */
  onThreatDetected?: (threat: MLThreat, agentId: string) => void;
}

// Internal type for the pipeline function from @huggingface/transformers
type PipelineResult = Array<{ label: string; score: number }>;
type PipelineFn = (input: string) => Promise<PipelineResult>;

/**
 * MLBehaviorAnalyzer — optional ML layer for the gateway.
 *
 * Loads HuggingFace models on first use and caches them.
 * Models run locally via ONNX Runtime — no API calls to HuggingFace after download.
 *
 * Usage:
 *   const ml = new MLBehaviorAnalyzer({ injectionThreshold: 0.9 });
 *   await ml.initialize(); // Loads models (first time downloads them)
 *   const result = await ml.analyzeRequest(params, agentId);
 *   if (!result.safe) { // block or flag the request }
 */
export class MLBehaviorAnalyzer {
  private config: Required<Omit<MLAnalyzerConfig, 'onThreatDetected' | 'urlModel'>> & Pick<MLAnalyzerConfig, 'onThreatDetected' | 'urlModel'>;
  private injectionDetector: PipelineFn | null = null;
  private urlDetector: PipelineFn | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private available = false;

  constructor(config: MLAnalyzerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      injectionThreshold: config.injectionThreshold ?? 0.85,
      urlThreshold: config.urlThreshold ?? 0.80,
      minTextLength: config.minTextLength ?? 10,
      injectionModel: config.injectionModel ?? 'protectai/deberta-v3-base-prompt-injection-v2',
      urlModel: config.urlModel,
      onThreatDetected: config.onThreatDetected
    };
  }

  /**
   * Initialize the ML models. Call this once at startup.
   * Models are downloaded on first run and cached locally.
   * If @huggingface/transformers is not installed, this is a no-op.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return this.available;
    if (this.initPromise) {
      await this.initPromise;
      return this.available;
    }

    this.initPromise = this._doInitialize();
    await this.initPromise;
    return this.available;
  }

  private async _doInitialize(): Promise<void> {
    if (!this.config.enabled) {
      this.initialized = true;
      this.available = false;
      return;
    }

    try {
      // Dynamic import — if the package isn't installed, this throws
      // Use string variable to avoid TypeScript module resolution error
      const moduleName = '@huggingface/transformers';
      const transformers = await import(/* webpackIgnore: true */ moduleName);
      const pipeline = transformers.pipeline;

      console.log('[@agent-trust/gateway] Loading ML models for behavioral analysis...');

      // Load prompt injection detector
      // protectai/deberta-v3-base-prompt-injection-v2 has onnx/ directory
      const startInjection = Date.now();
      this.injectionDetector = await pipeline(
        'text-classification',
        this.config.injectionModel
      ) as unknown as PipelineFn;
      console.log(`[@agent-trust/gateway] Prompt injection model loaded (${Date.now() - startInjection}ms)`);

      // Optionally load URL detector if a model is specified
      if (this.config.urlModel) {
        try {
          const startUrl = Date.now();
          this.urlDetector = await pipeline(
            'text-classification',
            this.config.urlModel
          ) as unknown as PipelineFn;
          console.log(`[@agent-trust/gateway] URL detection model loaded (${Date.now() - startUrl}ms)`);
        } catch (urlErr: unknown) {
          const urlMsg = urlErr instanceof Error ? urlErr.message : String(urlErr);
          console.warn(`[@agent-trust/gateway] URL model failed to load (continuing without it):`, urlMsg);
        }
      }

      this.available = true;
      console.log('[@agent-trust/gateway] ML behavioral analysis ACTIVE');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
        console.log(
          '[@agent-trust/gateway] ML analysis disabled: @huggingface/transformers not installed. ' +
          'Install it with: npm install @huggingface/transformers'
        );
      } else {
        console.warn('[@agent-trust/gateway] ML analysis disabled due to error:', message);
      }

      this.available = false;
    }

    this.initialized = true;
  }

  /**
   * Check if ML analysis is available and active.
   */
  isAvailable(): boolean {
    return this.available && this.initialized;
  }

  /**
   * Analyze an agent's request parameters for threats.
   *
   * Checks:
   * 1. All string params for prompt injection attempts
   * 2. All URL-like params for phishing/malware (if URL model is loaded)
   *
   * Returns { safe: true } if no threats detected or ML is unavailable.
   */
  async analyzeRequest(
    params: Record<string, unknown>,
    agentId?: string
  ): Promise<MLAnalysisResult> {
    const startTime = Date.now();

    // If ML isn't available, return safe (rule-based checks still apply)
    if (!this.available || !this.initialized) {
      return { safe: true, threats: [], analysisTimeMs: 0 };
    }

    const threats: MLThreat[] = [];

    // Recursively extract string values from params
    const stringValues = this.extractStrings(params);

    for (const { key, value } of stringValues) {
      // Check for prompt injection
      if (value.length >= this.config.minTextLength && this.injectionDetector) {
        try {
          const result = await this.injectionDetector(value);
          // protectai model uses "INJECTION" label
          // Other models may use "LABEL_1", "1", or "jailbreak"
          const injectionResult = result.find(
            r => r.label.toUpperCase() === 'INJECTION' ||
                 r.label.toLowerCase().includes('injection') ||
                 r.label.toLowerCase().includes('jailbreak') ||
                 r.label === 'LABEL_1' ||
                 r.label === '1'
          );

          if (injectionResult && injectionResult.score >= this.config.injectionThreshold) {
            const threat: MLThreat = {
              type: 'prompt_injection',
              field: key,
              confidence: Math.round(injectionResult.score * 100) / 100,
              value: value.substring(0, 100) + (value.length > 100 ? '...' : '')
            };
            threats.push(threat);

            if (this.config.onThreatDetected && agentId) {
              this.config.onThreatDetected(threat, agentId);
            }
          }
        } catch (e) {
          // SECURITY (#49): Fail closed — if ML inference fails, treat it as a potential
          // threat rather than silently passing. An attacker could craft inputs that crash
          // the model to bypass detection.
          console.warn('[@agent-trust/gateway] ML injection check failed for field:', key, '— treating as suspicious');
          threats.push({
            type: 'prompt_injection',
            field: key,
            confidence: 0,
            value: `[ML inference error — field blocked as precaution: ${value.substring(0, 50)}...]`
          });
        }
      }

      // Check for malicious URLs (only if URL model is loaded)
      if (this.isUrlLike(value) && this.urlDetector) {
        try {
          const domain = this.extractDomain(value);
          if (domain) {
            const result = await this.urlDetector(domain);
            const malwareResult = result.find(
              r => r.label.toLowerCase().includes('malware') ||
                   r.label.toLowerCase().includes('malicious') ||
                   r.label.toLowerCase().includes('phishing') ||
                   r.label === 'LABEL_1' ||
                   r.label === '1'
            );

            if (malwareResult && malwareResult.score >= this.config.urlThreshold) {
              const threat: MLThreat = {
                type: 'malicious_url',
                field: key,
                confidence: Math.round(malwareResult.score * 100) / 100,
                value: value.substring(0, 200)
              };
              threats.push(threat);

              if (this.config.onThreatDetected && agentId) {
                this.config.onThreatDetected(threat, agentId);
              }
            }
          }
        } catch (e) {
          // SECURITY (#49): Fail closed for URL checks too
          console.warn('[@agent-trust/gateway] ML URL check failed for field:', key, '— treating as suspicious');
          threats.push({
            type: 'malicious_url',
            field: key,
            confidence: 0,
            value: `[ML inference error — URL blocked as precaution: ${value.substring(0, 100)}]`
          });
        }
      }
    }

    return {
      safe: threats.length === 0,
      threats,
      analysisTimeMs: Date.now() - startTime
    };
  }

  // ─── Helpers ───

  // SECURITY (#48): Limits for extractStrings to prevent DoS via deeply nested params
  // or objects with thousands of string fields. Without these limits, an attacker can
  // send { a: { b: { c: { ... 1000 levels deep ... } } } } to cause stack overflow,
  // or { k1: "x", k2: "x", ... k10000: "x" } to trigger 10,000 ML inference calls.
  private static readonly MAX_EXTRACT_DEPTH = 10;
  private static readonly MAX_EXTRACT_STRINGS = 100;

  /**
   * Recursively extract string values from nested objects/arrays.
   * SECURITY (#48): Bounded by MAX_EXTRACT_DEPTH and MAX_EXTRACT_STRINGS.
   */
  private extractStrings(
    obj: Record<string, unknown>,
    prefix = '',
    depth = 0
  ): Array<{ key: string; value: string }> {
    const result: Array<{ key: string; value: string }> = [];

    // Stop recursing beyond max depth to prevent stack overflow
    if (depth >= MLBehaviorAnalyzer.MAX_EXTRACT_DEPTH) {
      return result;
    }

    for (const [key, value] of Object.entries(obj)) {
      // Stop collecting once we have enough strings to analyze
      if (result.length >= MLBehaviorAnalyzer.MAX_EXTRACT_STRINGS) {
        break;
      }

      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        result.push({ key: fullKey, value });
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length && result.length < MLBehaviorAnalyzer.MAX_EXTRACT_STRINGS; i++) {
          const item = value[i];
          if (typeof item === 'string') {
            result.push({ key: `${fullKey}[${i}]`, value: item });
          } else if (typeof item === 'object' && item !== null) {
            result.push(...this.extractStrings(item as Record<string, unknown>, `${fullKey}[${i}]`, depth + 1));
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        result.push(...this.extractStrings(value as Record<string, unknown>, fullKey, depth + 1));
      }
    }

    return result;
  }

  /**
   * Check if a string looks like a URL.
   */
  private isUrlLike(value: string): boolean {
    return /^https?:\/\//i.test(value) || /^www\./i.test(value);
  }

  /**
   * Extract domain from a URL string.
   */
  private extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url.startsWith('www.') ? `https://${url}` : url);
      return parsed.hostname;
    } catch {
      return null;
    }
  }
}

/**
 * Factory function — creates an MLBehaviorAnalyzer instance.
 *
 * Example:
 *   const ml = createMLAnalyzer({
 *     injectionThreshold: 0.9,
 *     onThreatDetected: (threat, agentId) => {
 *       console.warn(`ML threat from ${agentId}:`, threat);
 *     }
 *   });
 *   await ml.initialize();
 */
export function createMLAnalyzer(config?: MLAnalyzerConfig): MLBehaviorAnalyzer {
  return new MLBehaviorAnalyzer(config);
}
