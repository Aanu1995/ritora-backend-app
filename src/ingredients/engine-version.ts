/**
 * Ingredient-intelligence engine version.
 *
 * Bump whenever any of the following changes:
 *   - conflict rules in `ingredients.data.ts`
 *   - safety-score weights in `safety-scorer.ts`
 *   - matching heuristics in `matching.service.ts`
 *
 * Clients (and future caches) use this to know when to re-render or invalidate.
 */
export const ENGINE_VERSION = 'v2';
