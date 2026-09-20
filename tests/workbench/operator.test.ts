import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATOR_LABEL, operatorActor } from '../../src/server/workbench/mutations';

describe('operatorActor', () => {
  it('defaults to local-operator', () => {
    expect(operatorActor({})).toEqual({ kind: 'human', label: DEFAULT_OPERATOR_LABEL });
    expect(operatorActor({ OPERATOR_LABEL: '   ' })).toEqual({
      kind: 'human',
      label: DEFAULT_OPERATOR_LABEL,
    });
  });

  it('uses OPERATOR_LABEL, trimmed and bounded to the store limit', () => {
    expect(operatorActor({ OPERATOR_LABEL: ' rishabh ' }).label).toBe('rishabh');
    expect(operatorActor({ OPERATOR_LABEL: 'x'.repeat(200) }).label).toHaveLength(120);
  });
});
