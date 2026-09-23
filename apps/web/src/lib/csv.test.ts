import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('CSV export', () => {
  it('neutralises spreadsheet formulas from untrusted contact names', () => {
    expect(csvCell('=HYPERLINK("http://x","klik")')).toBe('"\'=HYPERLINK(""http://x"",""klik"")"');
    expect(csvCell('+62 812')).toBe('"\'+62 812"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('Ahmad')).toBe('"Ahmad"');
  });

  it('keeps real numbers and empty values intact, with a UTF-8 BOM', () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv([['a', 1]])).toBe('﻿"a","1"');
  });
});
