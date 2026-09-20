import { describe, it, expect } from 'vitest';
import { parseRename, normalizePath } from './paths';

describe('parseRename', () => {
  // Every shape below was produced by real git and copied out of the fixture.
  it('handles a brace segment inside a path', () => {
    expect(parseRename('src/core/{engine.js => runner.js}')).toEqual({
      from: 'src/core/engine.js',
      to: 'src/core/runner.js',
    });
  });

  it('handles a brace segment at the front', () => {
    expect(parseRename('{src/core => lib/kernel}/runner.js')).toEqual({
      from: 'src/core/runner.js',
      to: 'lib/kernel/runner.js',
    });
  });

  it('handles a move into a directory', () => {
    expect(parseRename('pkg/{ => sub}/thing.txt')).toEqual({
      from: 'pkg/thing.txt',
      to: 'pkg/sub/thing.txt',
    });
  });

  it('handles a move out of a directory', () => {
    expect(parseRename('pkg/{sub => }/thing.txt')).toEqual({
      from: 'pkg/sub/thing.txt',
      to: 'pkg/thing.txt',
    });
  });

  it('handles the plain form, including spaces and non-ASCII', () => {
    expect(parseRename('sub/naïve file.txt => naïve file.txt')).toEqual({
      from: 'sub/naïve file.txt',
      to: 'naïve file.txt',
    });
  });

  it('handles a rename at the repository root', () => {
    expect(parseRename('{ => src}/index.js')).toEqual({ from: 'index.js', to: 'src/index.js' });
  });

  it('leaves an ordinary path alone', () => {
    expect(parseRename('src/core/runner.js')).toBeNull();
    expect(parseRename('weird{braces}.js')).toBeNull();
  });
});

describe('normalizePath', () => {
  it('collapses doubled slashes and strips a leading slash', () => {
    expect(normalizePath('//a//b/c')).toBe('a/b/c');
    expect(normalizePath('/x')).toBe('x');
  });
});
