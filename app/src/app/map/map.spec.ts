import { markerRadius } from './map';

describe('markerRadius', () => {
  it('gives the biggest site the maximum radius', () => {
    expect(markerRadius(450, 450)).toBe(16);
  });

  it('grows with the square root (area proportional to the volume)', () => {
    // A quarter of the volume: half of the extra radius.
    expect(markerRadius(100, 400)).toBe(4 + 12 / 2);
  });

  it('uses the minimum radius when the volume is unknown', () => {
    expect(markerRadius(null, 450)).toBe(4);
  });
});
