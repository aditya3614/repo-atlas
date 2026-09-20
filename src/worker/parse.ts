import { parseRename, normalizePath } from './paths';

/**
 * Line-oriented parser for the Repo Atlas log format.
 *
 * Every commit is six lines by position — separator, hash, name, email, date,
 * subject — then, only when the commit touched files, a blank line and the
 * numstat rows. An empty commit emits no blank line at all: the next @@@ comes
 * straight after the subject (confirmed against git).
 *
 * Nothing is split on a separator character, because a subject may contain any
 * character, including tabs, pipes, quotes and the string "@@@". State is
 * carried between chunks so a 100 MB file can be fed in a piece at a time.
 */

export const BINARY_WEIGHT = 30;
export const SEP = '@@@';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly offending: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface CommitHead {
  hash: string;
  name: string;
  email: string;
  /** Author date in ms. NaN when git wrote something unparseable. */
  time: number;
  subject: string;
}

export interface Change {
  /** -1 for a binary file, which has no line counts. */
  adds: number;
  dels: number;
  path: string;
  /** Previous path when this change is a rename, otherwise null. */
  from: string | null;
  binary: boolean;
}

export interface ParseSink {
  commit(head: CommitHead): void;
  change(change: Change): void;
}

type State = 'sep' | 'hash' | 'name' | 'email' | 'date' | 'subject' | 'body';

export class LineParser {
  private state: State = 'sep';
  private head: CommitHead = { hash: '', name: '', email: '', time: 0, subject: '' };
  /** 1-based, for error messages that point at the real file. */
  private lineNo = 0;
  commits = 0;

  constructor(private readonly sink: ParseSink) {}

  private fail(text: string, message: string, hint: string): never {
    throw new ParseError(message, this.lineNo, text, hint);
  }

  push(line: string): void {
    this.lineNo++;

    switch (this.state) {
      case 'sep': {
        // Leading blank lines are tolerated; anything else is the wrong file.
        if (line.trim() === '') return;
        if (line !== SEP) {
          this.fail(
            line,
            'This does not look like the Repo Atlas log format',
            'Copy the command from the landing screen exactly — the --format flag is what writes the @@@ separators.',
          );
        }
        this.state = 'hash';
        return;
      }
      case 'hash':
        this.head.hash = line;
        this.state = 'name';
        return;
      case 'name':
        this.head.name = line;
        this.state = 'email';
        return;
      case 'email':
        this.head.email = line;
        this.state = 'date';
        return;
      case 'date':
        this.head.time = Date.parse(line);
        if (Number.isNaN(this.head.time)) {
          this.fail(
            line,
            'Could not read a commit date',
            'The date field must be ISO 8601, which is what %aI in the command produces.',
          );
        }
        this.state = 'subject';
        return;
      case 'subject':
        // A subject may be anything at all, including "@@@" or an empty line.
        this.head.subject = line;
        this.sink.commit({ ...this.head });
        this.commits++;
        this.state = 'body';
        return;
      case 'body': {
        if (line === SEP) {
          this.state = 'hash';
          return;
        }
        // The blank line after the subject, and the one git writes between a
        // commit's rows and the next separator.
        if (line === '') return;
        this.sink.change(this.parseNumstat(line));
        return;
      }
    }
  }

  private parseNumstat(line: string): Change {
    const t1 = line.indexOf('\t');
    const t2 = t1 === -1 ? -1 : line.indexOf('\t', t1 + 1);
    if (t1 === -1 || t2 === -1) {
      this.fail(
        line,
        'Malformed change line',
        'Each change is "added<TAB>deleted<TAB>path". Re-run the command with --numstat and without --stat or --shortstat.',
      );
    }

    const a = line.slice(0, t1);
    const d = line.slice(t1 + 1, t2);
    const raw = line.slice(t2 + 1);
    if (raw === '') {
      this.fail(line, 'A change line has no path', 'Re-run the command; this row is truncated.');
    }

    const binary = a === '-' && d === '-';
    let adds = 0;
    let dels = 0;
    if (!binary) {
      adds = a === '-' ? 0 : Number(a);
      dels = d === '-' ? 0 : Number(d);
      if (!Number.isFinite(adds) || !Number.isFinite(dels) || adds < 0 || dels < 0) {
        this.fail(
          line,
          'A change line has counts that are not numbers',
          'Each change is "added<TAB>deleted<TAB>path", where both counts are whole numbers or "-" for a binary file.',
        );
      }
    }

    const rename = parseRename(raw);
    return {
      adds,
      dels,
      binary,
      path: rename ? rename.to : normalizePath(raw),
      from: rename ? rename.from : null,
    };
  }

  /** Call once the input ends, to catch a truncated final record. */
  end(): void {
    if (this.state !== 'sep' && this.state !== 'body') {
      this.fail(
        '',
        'The file ends in the middle of a commit',
        'The log was cut short — re-run the command and let it finish writing the file.',
      );
    }
  }
}

/**
 * Feeds decoded text chunks to a LineParser, holding back the partial last line
 * so a record split across a chunk boundary still parses.
 */
export class ChunkSplitter {
  private tail = '';
  private first = true;

  constructor(private readonly parser: LineParser) {}

  push(chunk: string): void {
    let text = this.tail + chunk;
    if (this.first) {
      // A BOM would otherwise make line 1 fail the @@@ check.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      this.first = false;
    }
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      const end = nl > start && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      this.parser.push(text.slice(start, end));
      start = nl + 1;
    }
    this.tail = text.slice(start);
  }

  end(): void {
    if (this.tail !== '') {
      this.parser.push(this.tail.charCodeAt(this.tail.length - 1) === 13 ? this.tail.slice(0, -1) : this.tail);
      this.tail = '';
    }
    this.parser.end();
  }
}
