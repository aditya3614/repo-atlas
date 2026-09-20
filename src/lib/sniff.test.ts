import { describe, it, expect } from 'vitest';
import { sniffInput } from './sniff';

const blob = (s: string) => new Blob([s], { type: 'text/plain' });

describe('sniffInput', () => {
  it('accepts a log that starts with the record separator', async () => {
    expect(await sniffInput(blob('@@@\nabc\n'))).toBeNull();
  });

  it('skips leading blank lines', async () => {
    expect(await sniffInput(blob('\n\n@@@\nabc\n'))).toBeNull();
  });

  it('reports the line number and text of the first offending line', async () => {
    const err = await sniffInput(blob('\ncommit 9f2c\n'));
    expect(err?.line).toBe(2);
    expect(err?.offending).toBe('commit 9f2c');
    expect(err?.hint).toMatch(/--format/);
  });

  it('has its own message for an empty file', async () => {
    expect((await sniffInput(blob('')))?.title).toMatch(/empty/i);
  });

  it('has its own message for content with no commit records', async () => {
    expect((await sniffInput(blob('\n   \n')))?.title).toMatch(/No commits/i);
  });
});
