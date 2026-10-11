import test from 'node:test';
import assert from 'node:assert/strict';
import { accentOf, colourOf, labToRgb, paletteOfPixels, rgbToLab, voiceOf } from '../android/src/lib/palette.ts';

// The colours in a cover, and the one of them the player is painted with.
//
// What matters here is not that k-means is k-means but that the answers are usable:
// the colours are colours the picture really contains, the same sleeve always comes
// back the same, a grey sleeve has nothing to give rather than a grey to give, and the
// swatch chosen to paint with is the colour in the picture rather than the biggest
// region of it - a sleeve that is four fifths dark background still has a colour.

/** RGBA bytes from a list of colours, which is all this needs of a picture. */
const pixels = (colours) => {
  const data = new Uint8ClampedArray(colours.length * 4);
  colours.forEach(([red, green, blue, alpha = 255], index) => {
    data[index * 4] = red;
    data[index * 4 + 1] = green;
    data[index * 4 + 2] = blue;
    data[index * 4 + 3] = alpha;
  });
  return data;
};
const repeated = (colour, count) => Array.from({ length: count }, () => colour);
const hexes = (swatches) => swatches.map((swatch) => colourOf(swatch.rgb));

test('a picture of one colour is one colour, and it is that colour', () => {
  const palette = paletteOfPixels(pixels(repeated([255, 0, 0], 64)));

  assert.equal(palette.length, 1);
  // Exact, not near: the swatch is the average of the pixels in its cluster, so a
  // picture of one colour answers with that colour rather than with the middle of the
  // five-bit bucket it was quantised into.
  assert.deepEqual(palette[0].rgb, [255, 0, 0]);
  assert.equal(palette[0].weight, 1);
});

test('two colours come back as two, each exactly', () => {
  const palette = paletteOfPixels(pixels([...repeated([255, 0, 0], 32), ...repeated([0, 0, 255], 32)]));

  assert.equal(palette.length, 2);
  assert.deepEqual(new Set(hexes(palette)), new Set(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']));
  // Half each, and the halves are what the weights are.
  assert.deepEqual(
    palette.map((swatch) => swatch.weight),
    [0.5, 0.5]
  );
});

test('the same picture always gives the same colours', () => {
  // k-means starts from a random choice, so without a fixed seed a sleeve would change
  // colour between two launches - and the player would change colour with it.
  const picture = pixels([
    ...repeated([200, 30, 30], 20),
    ...repeated([30, 200, 60], 20),
    ...repeated([40, 60, 200], 20),
    ...repeated([210, 200, 40], 20)
  ]);

  const first = hexes(paletteOfPixels(picture, 4));
  const second = hexes(paletteOfPixels(picture, 4));

  assert.deepEqual(second, first);
});

test('it looks for as many colours as asked for, and no more than there are', () => {
  const four = pixels([
    ...repeated([220, 20, 20], 16),
    ...repeated([20, 220, 20], 16),
    ...repeated([20, 20, 220], 16),
    ...repeated([220, 220, 20], 16)
  ]);
  assert.equal(paletteOfPixels(four, 3).length, 3);
  assert.equal(paletteOfPixels(four, 6).length, 4);

  // Empty clusters are dropped rather than answered with black: a picture of two
  // colours asked for six has two.
  const two = pixels([...repeated([255, 0, 0], 16), ...repeated([0, 255, 0], 16)]);
  assert.equal(paletteOfPixels(two, 6).length, 2);
});

test('nothing to look at is no colours at all', () => {
  assert.deepEqual(paletteOfPixels(pixels([])), []);
  // Transparent pixels are not colours either: a picture is what can be seen of it.
  assert.deepEqual(paletteOfPixels(pixels(repeated([255, 0, 0, 0], 32))), []);
});

test('the colours are the ones in the picture rather than averages of nothing', () => {
  const palette = paletteOfPixels(pixels([...repeated([10, 10, 10], 60), ...repeated([230, 40, 40], 20)]));

  // Both regions are in the picture, and each swatch is one of them.
  assert.equal(palette.length, 2);
  const red = palette.find((swatch) => swatch.rgb[0] > 150);
  assert.deepEqual(red.rgb, [230, 40, 40]);
});

test('the swatch to paint with is the colour in the picture, not the biggest region', () => {
  // The case this exists for: an album cover that is mostly dark and carries one
  // colour. The biggest region is five sixths of the picture and is not a colour.
  const mostlyDark = pixels([...repeated([18, 18, 22], 80), ...repeated([210, 40, 150], 16)]);
  const accent = accentOf(paletteOfPixels(mostlyDark));

  assert.ok(accent, 'a colourful swatch should have been found');
  assert.ok(accent[0] > 150 && accent[1] < 110, `expected the magenta, got ${colourOf(accent)}`);
});

test('a black and white sleeve has nothing to paint with', () => {
  // Black, white and the greys between them: not colours, and the caller's own colour
  // is a better answer than a grey drawn out of them.
  const greys = pixels([...repeated([0, 0, 0], 32), ...repeated([255, 255, 255], 32), ...repeated([128, 128, 128], 32)]);

  assert.equal(accentOf(paletteOfPixels(greys)), null);
  assert.equal(accentOf([]), null);
});

test('a muted colour is still a colour', () => {
  // A sleeve can be low in saturation and not be grey: the floor is what tells those
  // two apart, and it has to be low enough for a dusty pink.
  assert.ok(voiceOf([170, 140, 130]) > 0.12);
  assert.ok(voiceOf([128, 128, 128]) < 0.12);
});

test('Lab is a space a colour can come back out of', () => {
  for (const colour of [
    [255, 0, 0],
    [0, 200, 90],
    [12, 12, 12],
    [200, 200, 210]
  ]) {
    const back = labToRgb(rgbToLab(colour));
    const drift = Math.max(...colour.map((channel, index) => Math.abs(channel - back[index])));
    assert.ok(drift <= 1, `${colourOf(colour)} came back as ${colourOf(back)}`);
  }
});
