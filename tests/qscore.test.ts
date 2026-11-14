import { describe, expect, it } from 'vitest';
import { fmtQ } from '../src/lib/analysis';

describe('fmtQ', () => {
  it('converts accuracy to a Phred quality', () => {
    expect(fmtQ(0.9)).toBe('Q10.0');
    expect(fmtQ(0.99)).toBe('Q20.0');
    expect(fmtQ(0.25)).toBe('Q1.2');
  });
  it('bounds a perfect score by the number of answers', () => {
    expect(fmtQ(1, 100)).toBe('Q≥20');
    expect(fmtQ(1)).toBe('Q>40');
  });
  it('handles missing values', () => { expect(fmtQ(null)).toBe('–'); expect(fmtQ(NaN)).toBe('–'); });
});
