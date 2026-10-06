import { variables } from '../../env';

/**
 * A complete `$app/env/private` mock for tests. Vitest throws when code reads
 * an export the mock lacks, so every declared variable is present (undefined
 * unless given). The object can be changed between tests.
 */
export function mockEnv(values: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.keys(variables).map((name) => [name, undefined])), ...values };
}
