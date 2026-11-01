/**
 * Host configuration.
 *
 * v1 exposes exactly one knob to the user — the balance refresh interval — plus
 * the per-turn refresh toggle. Both live in the plugin's Config so DSH's own
 * settings surface can edit them.
 *
 * `@deepseek-ai/schemastery` is a package DSH ships and resolves for profile
 * plugins (the market plugin imports it the same way). It is loaded dynamically
 * so a deployment that cannot resolve it still activates this plugin: the raw
 * YAML row config is then validated by `resolveConfig` alone, and the plugin's
 * own settings page remains the configuration surface.
 */

export const CONFIG_DEFAULTS = Object.freeze({
  balanceRefreshSeconds: 60,
  balanceRefreshOnTurnEnd: true,
});

export const BALANCE_REFRESH_MIN_SECONDS = 15;
export const BALANCE_REFRESH_MAX_SECONDS = 3600;

/**
 * @param {unknown} raw
 * @returns {{balanceRefreshSeconds:number, balanceRefreshOnTurnEnd:boolean}}
 */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const seconds = Number(input.balanceRefreshSeconds);
  const clamped = Number.isFinite(seconds)
    ? Math.min(BALANCE_REFRESH_MAX_SECONDS, Math.max(BALANCE_REFRESH_MIN_SECONDS, Math.round(seconds)))
    : CONFIG_DEFAULTS.balanceRefreshSeconds;
  return {
    balanceRefreshSeconds: clamped,
    balanceRefreshOnTurnEnd: input.balanceRefreshOnTurnEnd !== false,
  };
}

/**
 * @returns {Promise<unknown>} a Config schema, or `undefined` when schemastery
 *   cannot be resolved in this deployment (the plugin still runs).
 */
export async function loadConfigSchema() {
  try {
    const mod = await import('@deepseek-ai/schemastery');
    const z = mod.default ?? mod;
    return z
      .object({
        balanceRefreshSeconds: z
          .number()
          .step(1)
          .min(BALANCE_REFRESH_MIN_SECONDS)
          .max(BALANCE_REFRESH_MAX_SECONDS)
          .default(CONFIG_DEFAULTS.balanceRefreshSeconds)
          .description('How often the DeepSeek balance is polled, in seconds.'),
        balanceRefreshOnTurnEnd: z
          .boolean()
          .default(CONFIG_DEFAULTS.balanceRefreshOnTurnEnd)
          .description('Refresh the balance once at the end of every turn.'),
      })
      .description('Token Monitor settings');
  } catch {
    return undefined;
  }
}
