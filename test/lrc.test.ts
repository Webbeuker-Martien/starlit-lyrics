import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findActiveIndex, parseLrc, parsePlain, tagToMs } from '../src/core/lrc.ts';

test('tagToMs treats the fraction as decimal', () => {
  assert.equal(tagToMs('00', '01', '5'), 1500);
  assert.equal(tagToMs('00', '01', '05'), 1050);
  assert.equal(tagToMs('00', '01', '50'), 1500);
  assert.equal(tagToMs('01', '02', '123'), 62123);
  assert.equal(tagToMs('2', '03'), 123000);
});

test('parses standard lines with 2- and 3-digit fractions', () => {
  const { lines, hasWordTiming } = parseLrc('[00:12.34]First line\n[00:15.678]Second line\r\n');
  assert.equal(hasWordTiming, false);
  assert.deepEqual(lines, [
    { timeMs: 12340, text: 'First line' },
    { timeMs: 15678, text: 'Second line' },
  ]);
});

test('skips metadata tags and blank lines, keeps empty timed lines as gaps', () => {
  const { lines } = parseLrc('[ar:Someone]\n[ti:Song]\n\n[00:01.00]\n[00:02.00]Words');
  assert.deepEqual(lines, [
    { timeMs: 1000, text: '' },
    { timeMs: 2000, text: 'Words' },
  ]);
});

test('expands repeated timestamps and sorts by time', () => {
  const { lines } = parseLrc('[00:30.00][00:10.00]Chorus\n[00:20.00]Verse');
  assert.deepEqual(
    lines.map((l) => [l.timeMs, l.text]),
    [
      [10000, 'Chorus'],
      [20000, 'Verse'],
      [30000, 'Chorus'],
    ],
  );
});

test('applies the [offset:] tag (positive = earlier) and clamps at zero', () => {
  const { lines } = parseLrc('[offset:+500]\n[00:00.20]A\n[00:10.00]B');
  assert.deepEqual(
    lines.map((l) => l.timeMs),
    [0, 9500],
  );
});

test('parses enhanced word timestamps', () => {
  const { lines, hasWordTiming } = parseLrc('[00:05.00]<00:05.00>Hello <00:05.60>bright <00:06.20>world<00:07.00>');
  assert.equal(hasWordTiming, true);
  assert.equal(lines[0].text, 'Hello bright world');
  assert.deepEqual(lines[0].words, [
    { timeMs: 5000, text: 'Hello ' },
    { timeMs: 5600, text: 'bright ' },
    { timeMs: 6200, text: 'world' },
  ]);
});

test('parsePlain trims and collapses blank runs', () => {
  assert.deepEqual(parsePlain('\n  one \ntwo\n\n\n three\n\n'), ['one', 'two', '', 'three']);
});

test('findActiveIndex returns the last line at or before the position', () => {
  const items = [{ timeMs: 1000 }, { timeMs: 2000 }, { timeMs: 3000 }];
  assert.equal(findActiveIndex(items, 0), -1);
  assert.equal(findActiveIndex(items, 999), -1);
  assert.equal(findActiveIndex(items, 1000), 0);
  assert.equal(findActiveIndex(items, 2500), 1);
  assert.equal(findActiveIndex(items, 99999), 2);
  assert.equal(findActiveIndex([], 5), -1);
});
