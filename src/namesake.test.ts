import { describe, expect, it } from 'vitest';
import { NAMESAKE_BODY, NAMESAKE_TITLE, greetTheConsole } from './namesake';

describe('greetTheConsole', () => {
  it('logs the namesake note exactly once, with the title styled', () => {
    const calls: unknown[][] = [];
    greetTheConsole({ info: (...args: unknown[]) => { calls.push(args); } });
    expect(calls).toHaveLength(1);
    const [format, titleStyle, bodyStyle] = calls[0]! as string[];
    expect(format).toBe(`%c${NAMESAKE_TITLE}%c\n\n${NAMESAKE_BODY}`);
    expect(titleStyle).toContain('bold');
    expect(bodyStyle).toBe('');
  });

  it('names Cray, his vector machines, and SIMD', () => {
    expect(NAMESAKE_TITLE).toContain('Seymour Cray');
    for (const term of ['CDC 6600', 'Cray-1', 'vector', 'SIMD']) expect(NAMESAKE_BODY).toContain(term);
  });
});
