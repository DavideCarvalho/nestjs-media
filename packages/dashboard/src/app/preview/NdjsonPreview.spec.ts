import { describe, expect, it } from 'vitest';
import { parseNdjson } from './NdjsonPreview.js';

describe('parseNdjson', () => {
  it('columns are the union of the keys, in first-seen order', () => {
    const table = parseNdjson(
      [
        '{"ts":1,"level":"info","msg":"a"}',
        '{"ts":2,"msg":"b","trace":"x"}',
        '{"ts":3,"level":"warn","msg":"c"}',
      ].join('\n'),
    );
    expect(table.header).toEqual(['ts', 'level', 'msg', 'trace']);
  });

  it('never sorts the keys — the producer order survives', () => {
    const table = parseNdjson('{"z":1,"a":2,"m":3}');
    expect(table.header).toEqual(['z', 'a', 'm']);
  });

  it('gives a ragged row an empty cell for every key it is missing', () => {
    const table = parseNdjson(['{"a":1,"b":2}', '{"a":3}', '{"c":4}'].join('\n'));
    expect(table.header).toEqual(['a', 'b', 'c']);
    expect(table.body).toEqual([
      ['1', '2', ''],
      ['3', '', ''],
      ['', '', '4'],
    ]);
  });

  it('counts unparseable lines, skips them, and keeps the rest of the file', () => {
    const table = parseNdjson(
      ['{"a":1}', 'not json', '{"a":2}', '{"a":', 'NaN', '{"a":3}'].join('\n'),
    );
    expect(table.unparseable).toBe(3);
    expect(table.body).toEqual([['1'], ['2'], ['3']]);
  });

  it('survives a half-written record at the end of a log', () => {
    const table = parseNdjson(['{"a":1}', '{"a":2}', '{"a":'].join('\n'));
    expect(table.unparseable).toBe(1);
    expect(table.header).toEqual(['a']);
    expect(table.body).toEqual([['1'], ['2']]);
  });

  it('renders lines that are valid JSON but not objects in a single value column', () => {
    const table = parseNdjson(['1', '"two"', '[3,4]', 'true', 'null'].join('\n'));
    expect(table.header).toEqual(['value']);
    expect(table.body).toEqual([['1'], ['two'], ['[3,4]'], ['true'], ['']]);
    expect(table.unparseable).toBe(0);
  });

  it('mixes object and non-object lines into one table', () => {
    const table = parseNdjson(['{"a":1}', '7', '{"b":2}'].join('\n'));
    expect(table.header).toEqual(['a', 'value', 'b']);
    expect(table.body).toEqual([
      ['1', '', ''],
      ['', '7', ''],
      ['', '', '2'],
    ]);
  });

  it('renders nested objects and arrays as compact JSON, null as empty, strings unquoted', () => {
    const table = parseNdjson('{"s":"hi","n":1.5,"b":false,"nil":null,"o":{"k":[1,2]},"a":["x"]}');
    expect(table.header).toEqual(['s', 'n', 'b', 'nil', 'o', 'a']);
    expect(table.body).toEqual([['hi', '1.5', 'false', '', '{"k":[1,2]}', '["x"]']]);
  });

  it('ignores blank lines and CRLF carriage returns without counting them as failures', () => {
    const table = parseNdjson('{"a":1}\r\n\r\n{"a":2}\r\n');
    expect(table.unparseable).toBe(0);
    expect(table.body).toEqual([['1'], ['2']]);
  });

  it('reports an empty sample as an empty table rather than a failure', () => {
    expect(parseNdjson('')).toEqual({ header: [], body: [], unparseable: 0 });
  });

  it('keeps an empty object as a row with no cells to show', () => {
    const table = parseNdjson(['{}', '{"a":1}'].join('\n'));
    expect(table.header).toEqual(['a']);
    expect(table.body).toEqual([[''], ['1']]);
  });
});
