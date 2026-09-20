/**
 * Deterministic synthetic history generator.
 *
 * Used for the performance budget (20,000 files, 100,000 commits) and by the
 * checkpoint tests. Seeded, so the same seed always produces the same bytes.
 *
 * It deliberately contains the shapes that make the real thing interesting:
 * bursts of activity, quiet gaps, renames, directory-wide refactors, deletions,
 * bot commits, and one folder that only ever has a single author.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUMANS = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Grace Hopper', 'grace@example.com'],
  ['Alan Turing', 'alan@example.com'],
  ['Katherine Johnson', 'katherine@example.com'],
  ['Barbara Liskov', 'barbara@example.com'],
  ['Donald Knuth', 'don@example.com'],
  ['Margaret Hamilton', 'margaret@example.com'],
  ['Radia Perlman', 'radia@example.com'],
  ['Leslie Lamport', 'leslie@example.com'],
  ['Jean Bartik', 'jean@example.com'],
];
const BOTS = [
  ['dependabot[bot]', 'support@dependabot.com'],
  ['renovate[bot]', 'bot@renovateapp.com'],
];
/** Everything under here is written by one person, so the bus factor is 1. */
const SOLO_DIR = 'src/legacy/ledger';
const SOLO_AUTHOR = 5;

const AREAS = ['core', 'ui', 'api', 'store', 'render', 'parser', 'net', 'crypto', 'db', 'cli'];
const SUBS = ['internal', 'helpers', 'adapters', 'hooks', 'model', 'view', 'util'];
const STEMS = ['index', 'client', 'server', 'queue', 'cache', 'schema', 'router', 'stream', 'codec', 'pool'];
const EXTS = ['.ts', '.tsx', '.js', '.json', '.md', '.css', '.png'];
const VERBS = ['fix', 'add', 'refactor', 'tidy', 'speed up', 'document', 'test', 'drop'];

export function generate({ commits = 100_000, files = 20_000, seed = 42 } = {}) {
  const rnd = mulberry32(seed);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const out = [];

  /** Live paths, and the subset that belongs to the single-owner folder. */
  const live = [];
  const isSolo = new Set();

  const newPath = (solo) => {
    if (solo) return `${SOLO_DIR}/${pick(STEMS)}${live.length}.ts`;
    const depth = rnd();
    const area = pick(AREAS);
    if (depth < 0.25) return `src/${area}/${pick(STEMS)}${live.length}${pick(EXTS)}`;
    if (depth < 0.8) return `src/${area}/${pick(SUBS)}/${pick(STEMS)}${live.length}${pick(EXTS)}`;
    return `src/${area}/${pick(SUBS)}/${pick(SUBS)}/${pick(STEMS)}${live.length}${pick(EXTS)}`;
  };

  let t = Date.UTC(2019, 0, 7, 9, 0, 0);
  const HOUR = 3600_000;

  for (let k = 0; k < commits; k++) {
    // Time: mostly minutes apart inside a burst, with one long quiet gap and
    // occasional weekend-sized holes.
    const phase = k / commits;
    const burst = Math.sin(phase * 47) > 0.72;
    if (k === Math.floor(commits * 0.62)) t += 96 * 24 * HOUR; // the quiet gap
    t += burst ? HOUR * (0.012 + rnd() * 0.08) : HOUR * (0.1 + rnd() * 1.5);
    // A few commits carry an older author date, the way a rebase leaves them.
    const stamped = rnd() < 0.004 ? t - 30 * 24 * HOUR : t;

    const bot = rnd() < 0.06;
    const soloTurn = rnd() < 0.05;
    const [name, email] = bot ? pick(BOTS) : soloTurn ? HUMANS[SOLO_AUTHOR] : pick(HUMANS);

    const rows = [];
    const touch = (path, adds, dels) => rows.push(`${adds}\t${dels}\t${path}`);

    const growing = live.length < files && (live.length < files * 0.35 || rnd() < 0.35);
    const roll = rnd();

    if (roll < 0.015 && live.length > 200) {
      // Directory-wide refactor: every file under one area moves at once.
      const from = `src/${pick(AREAS)}/${pick(SUBS)}`;
      const to = `src/${pick(AREAS)}/${pick(SUBS)}`;
      let moved = 0;
      for (let i = 0; i < live.length && moved < 40; i++) {
        if (!live[i].startsWith(`${from}/`)) continue;
        const next = to + live[i].slice(from.length);
        if (next === live[i]) continue;
        touch(`{${from} => ${to}}${live[i].slice(from.length)}`, 0, 0);
        live[i] = next;
        moved++;
      }
      if (moved === 0) touch(newPath(false), 1 + Math.floor(rnd() * 40), 0);
    } else if (roll < 0.05 && live.length > 50) {
      // Single rename, in the brace form git uses inside a directory.
      const i = Math.floor(rnd() * live.length);
      const path = live[i];
      const slash = path.lastIndexOf('/');
      const dir = path.slice(0, slash);
      const base = path.slice(slash + 1);
      const next = `${pick(STEMS)}${k}${base.slice(base.lastIndexOf('.'))}`;
      touch(`${dir}/{${base} => ${next}}`, Math.floor(rnd() * 12), Math.floor(rnd() * 8));
      live[i] = `${dir}/${next}`;
    } else if (roll < 0.075 && live.length > 300) {
      // Deletion: numstat shows every line removed.
      const i = Math.floor(rnd() * live.length);
      touch(live[i], 0, 20 + Math.floor(rnd() * 200));
      isSolo.delete(live[i]);
      live.splice(i, 1);
    } else {
      const n = 1 + Math.floor(Math.pow(rnd(), 2) * 26);
      for (let j = 0; j < n; j++) {
        if (growing && rnd() < 0.5) {
          const solo = soloTurn && rnd() < 0.6;
          const path = newPath(solo);
          live.push(path);
          if (solo) isSolo.add(path);
          touch(path, 5 + Math.floor(rnd() * 300), 0);
        } else if (live.length > 0) {
          let i = Math.floor(rnd() * live.length);
          // The single-owner folder is only ever edited by its owner.
          if (isSolo.has(live[i]) && !soloTurn) i = Math.floor(rnd() * live.length);
          const path = live[i];
          if (isSolo.has(path) && !soloTurn) continue;
          if (path.endsWith('.png')) touch(path, '-', '-');
          else touch(path, Math.floor(rnd() * 90), Math.floor(rnd() * 60));
        }
      }
      if (rows.length === 0) touch(newPath(false), 3, 0);
    }

    const hash = (k * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
    const subject = bot
      ? `chore(deps): bump ${pick(STEMS)} from 1.${k % 40}.0 to 1.${(k % 40) + 1}.0`
      : `${pick(VERBS)} ${pick(AREAS)}: ${pick(STEMS)} ${pick(SUBS)}`;

    out.push('@@@', hash, name, email, new Date(stamped).toISOString(), subject);
    if (rows.length > 0) {
      out.push('');
      for (const r of rows) out.push(r);
    }
  }

  return out.join('\n') + '\n';
}
