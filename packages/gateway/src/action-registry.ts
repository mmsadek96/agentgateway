import {
  ActionDefinition,
  ActionResult,
  AgentContext,
  PublicActionInfo
} from './types';

// ─── Input Sanitization Constants (#20) ───
const MAX_STRING_LENGTH = 10_000;  // Max length for any single string parameter
const MAX_OBJECT_DEPTH = 5;        // Max nesting depth for object/array parameters
const MAX_TOTAL_PARAMS = 50;       // Max total number of parameters (including nested keys)

/**
 * Manages action definitions and handles execution.
 * Validates parameters, checks score thresholds, and runs handler functions.
 */
export class ActionRegistry {
  private actions: Map<string, ActionDefinition>;

  constructor(actions: Record<string, ActionDefinition>) {
    this.actions = new Map(Object.entries(actions));
  }

  /** Get an action definition by name */
  getAction(name: string): ActionDefinition | undefined {
    return this.actions.get(name);
  }

  /** Get all action names */
  getActionNames(): string[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Get the public discovery payload (schemas without handler functions).
   * This is safe to expose to external agents.
   */
  getDiscoveryPayload(): Record<string, PublicActionInfo> {
    const payload: Record<string, PublicActionInfo> = {};

    for (const [name, def] of this.actions) {
      payload[name] = {
        description: def.description,
        minScore: def.minScore,
        parameters: def.parameters
      };
    }

    return payload;
  }

  /**
   * Validate parameters against an action's schema.
   * Returns an array of error messages (empty if valid).
   *
   * Security (#20): Enforces maxLength for strings, maxDepth for nested objects,
   * and a total parameter count limit to prevent DoS via deeply nested or oversized payloads.
   */
  validateParams(actionName: string, params: Record<string, unknown>): string[] {
    const action = this.actions.get(actionName);
    if (!action) {
      return [`Action "${actionName}" not found`];
    }

    const errors: string[] = [];

    // Global check: total parameter count (prevents oversized payloads)
    const totalKeys = this.countKeys(params, 0);
    if (totalKeys > MAX_TOTAL_PARAMS) {
      errors.push(`Too many parameters: ${totalKeys} exceeds maximum of ${MAX_TOTAL_PARAMS}`);
      return errors; // Bail early — don't waste time validating each field
    }

    // Check required parameters
    for (const [paramName, paramDef] of Object.entries(action.parameters)) {
      const value = params[paramName];

      if (paramDef.required && (value === undefined || value === null)) {
        errors.push(`Parameter "${paramName}" is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        // Type checking
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== paramDef.type) {
          errors.push(
            `Parameter "${paramName}" must be of type ${paramDef.type}, got ${actualType}`
          );
          continue;
        }

        // String length check (#20)
        if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
          errors.push(
            `Parameter "${paramName}" exceeds max length: ${value.length} > ${MAX_STRING_LENGTH}`
          );
        }

        // Object/array depth check (#20)
        if (typeof value === 'object' && value !== null) {
          const depth = this.measureDepth(value);
          if (depth > MAX_OBJECT_DEPTH) {
            errors.push(
              `Parameter "${paramName}" exceeds max nesting depth: ${depth} > ${MAX_OBJECT_DEPTH}`
            );
          }
        }
      }
    }

    // Check for unknown parameters
    const knownParams = new Set(Object.keys(action.parameters));
    for (const paramName of Object.keys(params)) {
      if (!knownParams.has(paramName)) {
        errors.push(`Unknown parameter "${paramName}"`);
      }
    }

    return errors;
  }

  /**
   * Measure the nesting depth of an object or array.
   */
  private measureDepth(value: unknown, current = 0): number {
    if (current > MAX_OBJECT_DEPTH) return current; // Short-circuit

    if (Array.isArray(value)) {
      let max = current + 1;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          max = Math.max(max, this.measureDepth(item, current + 1));
        }
      }
      return max;
    }

    if (typeof value === 'object' && value !== null) {
      let max = current + 1;
      for (const v of Object.values(value)) {
        if (typeof v === 'object' && v !== null) {
          max = Math.max(max, this.measureDepth(v, current + 1));
        }
      }
      return max;
    }

    return current;
  }

  /**
   * Count total number of keys (including nested) in a params object.
   */
  private countKeys(value: unknown, current: number): number {
    if (current > MAX_TOTAL_PARAMS) return current; // Short-circuit

    if (Array.isArray(value)) {
      let count = current;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          count = this.countKeys(item, count);
        }
      }
      return count;
    }

    if (typeof value === 'object' && value !== null) {
      let count = current;
      for (const v of Object.values(value)) {
        count++;
        if (typeof v === 'object' && v !== null) {
          count = this.countKeys(v, count);
        }
      }
      return count;
    }

    return current;
  }

  /**
   * Execute an action.
   * Checks score threshold, validates params, then calls the handler.
   */
  async execute(
    actionName: string,
    params: Record<string, unknown>,
    agentContext: AgentContext
  ): Promise<ActionResult> {
    const action = this.actions.get(actionName);

    if (!action) {
      return {
        success: false,
        error: `Action "${actionName}" not found`
      };
    }

    // Check minimum score
    if (agentContext.score < action.minScore) {
      return {
        success: false,
        error: `Insufficient reputation score: ${agentContext.score} < ${action.minScore} required`
      };
    }

    // Validate parameters
    const validationErrors = this.validateParams(actionName, params);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: `Parameter validation failed: ${validationErrors.join(', ')}`
      };
    }

    // Execute the handler
    try {
      const data = await action.handler(params, agentContext);
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action execution failed';
      return { success: false, error: message };
    }
  }
}
