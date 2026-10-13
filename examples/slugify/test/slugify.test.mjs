import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.mjs';

test('ASCII letters are lowercased', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('UPPER_CASE'), 'upper-case');
});

test('consecutive whitespace and underscores form one hyphen', () => {
  assert.equal(slugify('Many   __  Spaces___Here'), 'many-spaces-here');
  assert.equal(slugify('A\tB\n C__9'), 'a-b-c-9');
});

test('leading and trailing hyphens are removed', () => {
  assert.equal(slugify('---Hello_2026---'), 'hello-2026');
  assert.equal(slugify(' __ Hello World __ '), 'hello-world');
});

test('digits survive unchanged', () => {
  assert.equal(slugify('Release_2026__Version 2'), 'release-2026-version-2');
  assert.equal(slugify('1234567890'), '1234567890');
});

test('empty input and separator-only input produce an empty string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(' __ -- __ '), '');
});

test('an already normalized slug remains unchanged', () => {
  assert.equal(slugify('already-normalized-123'), 'already-normalized-123');
  assert.equal(slugify(slugify(' Project__Version 12 ')), 'project-version-12');
});

test('all ASCII whitespace separators are supported', () => {
  assert.equal(slugify('A\r\n\t\v\f_B'), 'a-b');
});
