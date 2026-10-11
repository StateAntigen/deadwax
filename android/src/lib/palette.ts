/**
 * The colours in a picture, by k-means in Lab.
 *
 * A single hue answers "what colour is this sleeve", which is all a tint needs, and
 * that is what `hue.ts` is for. This answers a different question - which colours are
 * in it - and it answers in a space where a distance is a distance a person would
 * see: two colours far apart in RGB can be a shade apart to the eye, and the other
 * way round.
 *
 * Clustering in Lab rather than RGB is the whole point of choosing this over the
 * cheaper quantisers: a picture's greens and blues are told apart properly instead
 * of being averaged into a muddy middle, and a small bright accent survives instead
 * of being swallowed by whichever region is biggest.
 *
 * Pure arithmetic over pixels and nothing else, so it can be tested with a handful of
 * pixels rather than a phone: the store, the host and the cover cache are somebody
 * else's business.
 */

export type Swatch = { rgb: [number, number, number]; weight: number };

/** How many colours to look for, and how hard. Six and twelve, as measured in the lab. */
export const PALETTE_COUNT = 6;
const KMEANS_PASSES = 12;
/**
 * Fixed, so the same sleeve always comes back the same colours: k-means starts from
 * a random choice, and a palette that changed between two identical draws is a
 * player that changes colour when it is reopened.
 */
const KMEANS_SEED = 20261007;
/**
 * How much colour a swatch has to have before it is worth painting with, on the same
 * measure `hue.ts` weighs its votes by. Above what a black-and-white sleeve can reach
 * and below a muted but real colour, so a grey cover falls back to the app's own
 * colour rather than tinting the player grey.
 */
const ACCENT_FLOOR = 0.12;

/* ---------------------------------------------------------------- colour space */

const WHITE = [0.95047, 1, 1.08883];

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

/** sRGB to CIE Lab, D65. */
export function rgbToLab(rgb: [number, number, number]): [number, number, number] {
  const red = srgbToLinear(rgb[0]);
  const green = srgbToLinear(rgb[1]);
  const blue = srgbToLinear(rgb[2]);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / WHITE[0];
  const y = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / WHITE[1];
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / WHITE[2];
  const f = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(lab: [number, number, number]): [number, number, number] {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  const finv = (value: number) => {
    const cube = value * value * value;
    return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
  };
  const x = WHITE[0] * finv(fx);
  const y = WHITE[1] * finv(fy);
  const z = WHITE[2] * finv(fz);
  return [
    linearToSrgb(x * 3.2406 + y * -1.5372 + z * -0.4986),
    linearToSrgb(x * -0.9689 + y * 1.8758 + z * 0.0415),
    linearToSrgb(x * 0.0557 + y * -0.204 + z * 1.057)
  ];
}

const labDistance = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How colourful a colour is: its saturation, faded out at both ends of lightness. */
export function voiceOf(rgb: [number, number, number]): number {
  const red = rgb[0] / 255;
  const green = rgb[1] / 255;
  const blue = rgb[2] / 255;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const range = high - low;
  if (range === 0) return 0;
  const lightness = (high + low) / 2;
  const saturation = range / (1 - Math.abs(2 * lightness - 1));
  return saturation * Math.min(1, 4 * Math.min(lightness, 1 - lightness));
}

/** A colour as anything CSS can be handed. */
export function colourOf(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

/* --------------------------------------------------------------------- k-means */

/** A seeded generator, so a palette is the same on every launch and every device. */
function randomOf(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The colours in a set of RGBA pixels.
 *
 * Clustered over a colour map rather than over the pixels: each channel cut to five
 * bits, so a JPEG's noise collapses into regions instead of thousands of
 * near-identical points, with the count of pixels behind each region carried along as
 * its weight. That is what makes this cost a millisecond rather than a second, and it
 * is the same pre-pass the cheaper quantisers use.
 *
 * Each returned colour is the average of the pixels that landed in its cluster rather
 * than the cluster's centre in Lab: the centre is what the clustering is measured by
 * and the average is what the pixels in it actually are, which is the difference
 * between "a colour near here" and a colour this picture really contains.
 */
export function paletteOfPixels(
  pixels: Uint8ClampedArray,
  count = PALETTE_COUNT,
  seed = KMEANS_SEED
): Swatch[] {
  const map = new Map<number, { rgb: [number, number, number]; n: number; sum: [number, number, number] }>();
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const packed = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
    const entry = map.get(packed);
    if (entry) {
      entry.n += 1;
      entry.sum[0] += red;
      entry.sum[1] += green;
      entry.sum[2] += blue;
    } else {
      map.set(packed, {
        rgb: [((red >> 3) << 3) | 4, ((green >> 3) << 3) | 4, ((blue >> 3) << 3) | 4],
        n: 1,
        sum: [red, green, blue]
      });
    }
  }
  const points = [...map.values()].map((entry) => ({
    lab: rgbToLab(entry.rgb),
    rgb: entry.rgb,
    n: entry.n,
    sum: entry.sum
  }));
  if (points.length === 0) return [];

  const random = randomOf(seed);
  // k-means++: spread the seeds by distance, so two clusters do not start in the same
  // flat region of the sleeve and then stay there.
  const centres: Array<[number, number, number]> = [points[Math.floor(random() * points.length)].lab];
  while (centres.length < count && centres.length < points.length) {
    const weights = points.map((point) => {
      let nearest = Infinity;
      for (const centre of centres) nearest = Math.min(nearest, labDistance(point.lab, centre));
      return nearest * nearest * point.n;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = random() * total;
    let index = 0;
    while (index < weights.length - 1 && pick > weights[index]) {
      pick -= weights[index];
      index += 1;
    }
    centres.push(points[index].lab);
  }

  const assignment = new Array<number>(points.length).fill(0);
  for (let pass = 0; pass < KMEANS_PASSES; pass += 1) {
    let moved = false;
    for (let index = 0; index < points.length; index += 1) {
      let best = 0;
      let bestDistance = Infinity;
      for (let centre = 0; centre < centres.length; centre += 1) {
        const distance = labDistance(points[index].lab, centres[centre]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = centre;
        }
      }
      if (assignment[index] !== best) {
        assignment[index] = best;
        moved = true;
      }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let index = 0; index < points.length; index += 1) {
      const bucket = sums[assignment[index]];
      bucket[0] += points[index].lab[0] * points[index].n;
      bucket[1] += points[index].lab[1] * points[index].n;
      bucket[2] += points[index].lab[2] * points[index].n;
      bucket[3] += points[index].n;
    }
    for (let centre = 0; centre < centres.length; centre += 1) {
      if (sums[centre][3] === 0) continue;
      centres[centre] = [sums[centre][0] / sums[centre][3], sums[centre][1] / sums[centre][3], sums[centre][2] / sums[centre][3]];
    }
    if (!moved) break;
  }

  // What each cluster is made of, in the pixels' own colours.
  const colours = centres.map(() => ({
    n: 0,
    sum: [0, 0, 0] as [number, number, number]
  }));
  for (let index = 0; index < points.length; index += 1) {
    const bucket = colours[assignment[index]];
    bucket.n += points[index].n;
    bucket.sum[0] += points[index].sum[0];
    bucket.sum[1] += points[index].sum[1];
    bucket.sum[2] += points[index].sum[2];
  }
  const total = points.reduce((sum, point) => sum + point.n, 0);
  return colours
    .filter((bucket) => bucket.n > 0)
    .map((bucket) => ({
      rgb: bucket.sum.map((channel) => Math.round(channel / bucket.n)) as [number, number, number],
      weight: bucket.n / total
    }))
    .sort((left, right) => right.weight - left.weight);
}

/**
 * The swatch to paint with, or nothing when the picture has no colour to give.
 *
 * The one with the most colour in it rather than the biggest one: a sleeve can be
 * four fifths dark grey and still carry one colour worth naming, and the biggest
 * region of a picture is usually its background. Ties go to the heavier swatch,
 * because the palette arrives sorted by weight.
 *
 * A picture whose colours are all grey has no such swatch, and that is answered rather
 * than guessed at: the caller's own colour is a better answer than a grey invented
 * from a black-and-white sleeve.
 */
export function accentOf(swatches: Swatch[]): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestVoice = ACCENT_FLOOR;
  for (const swatch of swatches) {
    const voice = voiceOf(swatch.rgb);
    if (voice > bestVoice) {
      bestVoice = voice;
      best = swatch.rgb;
    }
  }
  return best;
}
