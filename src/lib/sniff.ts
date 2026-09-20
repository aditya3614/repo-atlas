import type { InputError } from '../components/States';

/** 100 MB of numstat is roughly 200k commits; past this, suggest narrowing. */
const HUGE_BYTES = 120 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;

/**
 * A cheap look at the head of the input so an obviously wrong file is rejected
 * with a precise message before the worker spins up. Full validation, with line
 * numbers for malformed numstat rows, happens in the parser.
 */
export async function sniffInput(blob: Blob): Promise<InputError | null> {
  if (blob.size === 0) {
    return {
      title: 'That file is empty',
      hint: 'Re-run the command in your repository’s root — it writes to atlas.txt in the current directory.',
    };
  }

  if (blob.size > HUGE_BYTES) {
    return {
      title: 'That history is very large',
      detail: `${(blob.size / (1024 * 1024)).toFixed(0)} MB is more than a browser tab should hold at once.`,
      hint: 'Add --since="2 years ago" to the git log command, or limit it to a path: git log … -- src/',
    };
  }

  const head = await blob.slice(0, SNIFF_BYTES).text();
  const lines = head.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (line.trimEnd() === '@@@') return null;
    return {
      title: 'This does not look like the Repo Atlas log format',
      detail: 'The first line of the file should be the record separator @@@.',
      line: i + 1,
      offending: line.slice(0, 120),
      hint: 'Copy the command above exactly — the --format flag is what writes the @@@ separators.',
    };
  }

  return {
    title: 'No commits found',
    detail: 'The file has content, but no commit records in it.',
    hint: 'If you used --since or a path filter, widen it: that range may simply have no commits.',
  };
}
