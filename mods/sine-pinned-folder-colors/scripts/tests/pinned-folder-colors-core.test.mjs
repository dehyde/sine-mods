import assert from "node:assert/strict";
import test from "node:test";

import {
  INTENSITY_PRESETS,
  adaptColorForContrast,
  buildPalette,
  buildSwatchDataUri,
  contrastRatio,
  deriveChildColor,
  fitOklchToSrgb,
  getFolderMixWeights,
  getPaletteAnchorSlots,
  getNativeFolderFrontColor,
  getReferenceBackground,
  getTopLevelPinnedFolder,
  parseAssignments,
  parseColor,
  normalizeIntensityPreset,
  rgbToOklch,
} from "../pinned-folder-colors-core.uc.mjs";

test("parseColor accepts Zen RGB arrays and common CSS color strings", () => {
  assert.deepEqual(parseColor([255, 128, 0]), [1, 128 / 255, 0]);
  assert.deepEqual(parseColor("#ff8000"), [1, 128 / 255, 0]);
  assert.deepEqual(parseColor("rgb(255 128 0)"), [1, 128 / 255, 0]);
  assert.deepEqual(parseColor("rgb(100%, 50%, 0%)"), [1, 0.5, 0]);
  assert.equal(parseColor("not-a-color"), null);
  assert.equal(parseColor([1, Number.NaN, 0]), null);
});

test("the eight-color palette preserves every workspace anchor", () => {
  const anchors = ["#ff0000", "#00ff00", "#0000ff"];
  const palette = buildPalette(anchors);
  const slots = getPaletteAnchorSlots(anchors.length);

  assert.equal(palette.length, 8);
  anchors.forEach((anchor, index) => {
    const expected = rgbToOklch(parseColor(anchor));
    assert.ok(Math.abs(palette[slots[index]].l - expected.l) < 1e-10);
    assert.ok(Math.abs(palette[slots[index]].c - expected.c) < 1e-10);
  });
});

test("a single workspace anchor still produces distinct palette hues", () => {
  const palette = buildPalette(["#7a5bd8"]);
  const hues = new Set(palette.map(color => Math.round(color.h)));

  assert.equal(palette.length, 8);
  assert.equal(hues.size, 8);
});

test("workspace-primary normalization changes hue while preserving native intensity", () => {
  const reference = rgbToOklch(parseColor("#688f78"));
  const palette = buildPalette(["#ff0000", "#0000ff"], {
    referenceColor: "#688f78",
  });

  assert.equal(new Set(palette.map(color => Math.round(color.h))).size, 8);
  for (const color of palette) {
    assert.ok(Math.abs(color.l - reference.l) < 1e-10);
    assert.ok(Math.abs(color.c - reference.c) < 1e-10);
  }
});

test("native folder front colors follow Zen's light and dark mixing ratios", () => {
  const base = rgbToOklch(parseColor("#6699cc"));
  const lightFront = fitOklchToSrgb(getNativeFolderFrontColor(base, false));
  const darkFront = fitOklchToSrgb(getNativeFolderFrontColor(base, true));

  assert.deepEqual(
    lightFront.map(channel => Math.round(channel * 255)),
    [209, 224, 240]
  );
  assert.deepEqual(
    darkFront.map(channel => Math.round(channel * 255)),
    [61, 92, 122]
  );
});

test("intensity presets scale native fill weights without exceeding the palette", () => {
  assert.deepEqual(INTENSITY_PRESETS, [0, 20, 40, 60, 80]);
  assert.deepEqual(getFolderMixWeights(0), {
    behind: 0.6,
    frontDark: 0.6,
    frontLight: 0.3,
  });
  assert.deepEqual(getFolderMixWeights(40), {
    behind: 0.76,
    frontDark: 0.76,
    frontLight: 0.58,
  });
  assert.deepEqual(getFolderMixWeights(80), {
    behind: 0.92,
    frontDark: 0.92,
    frontLight: 0.86,
  });
  assert.equal(normalizeIntensityPreset(60), 60);
  assert.equal(normalizeIntensityPreset(57), 40);
});

test("folder swatch previews reflect the selected intensity", () => {
  const base = rgbToOklch(parseColor("#6699cc"));
  const nativeFront = fitOklchToSrgb(
    getNativeFolderFrontColor(base, false, 0)
  );
  const balancedFront = fitOklchToSrgb(
    getNativeFolderFrontColor(base, false, 40)
  );

  assert.ok(balancedFront[2] < nativeFront[2]);
  assert.ok(balancedFront[0] < nativeFront[0]);
});

test("menu swatches contain their color, a contrasting outline, and a reset mark", () => {
  const colorSwatch = decodeURIComponent(
    buildSwatchDataUri(rgbToOklch(parseColor("#ff8000"))).split(",")[1]
  );
  assert.match(colorSwatch, /fill="rgb\(\d+ \d+ \d+\)"/);
  assert.match(colorSwatch, /stroke="#ffffff"/);
  assert.match(colorSwatch, /stroke="#202124"/);

  const defaultSwatch = decodeURIComponent(buildSwatchDataUri().split(",")[1]);
  assert.match(defaultSwatch, /fill="transparent"/);
  assert.match(defaultSwatch, /<path /);
});

test("contrast-aware mode only adjusts colors that miss the target", () => {
  const darkBackground = getReferenceBackground(true);
  const lowContrast = rgbToOklch(parseColor("#242428"));
  const adjusted = adaptColorForContrast(lowContrast, darkBackground, 3.1);

  assert.ok(
    contrastRatio(fitOklchToSrgb(adjusted), darkBackground) >= 3.1
  );

  const highContrast = rgbToOklch(parseColor("#f5d93d"));
  assert.deepEqual(
    adaptColorForContrast(highContrast, darkBackground, 3.1),
    highContrast
  );
});

test("children shift lightness and chroma while siblings shift hue", () => {
  const parent = rgbToOklch(parseColor("#7257d9"));
  const firstChild = deriveChildColor(parent, 0, { isDarkMode: true });
  const secondChild = deriveChildColor(parent, 1, { isDarkMode: true });

  assert.ok(firstChild.l > parent.l);
  assert.ok(firstChild.c < parent.c);
  assert.equal(Math.round(firstChild.h), Math.round(parent.h));
  assert.notEqual(Math.round(secondChild.h), Math.round(firstChild.h));
});

test("saved assignments discard corrupt and out-of-range values", () => {
  assert.deepEqual(
    parseAssignments('{"folder-a":2,"folder-b":8,"folder-c":"3"}'),
    { "folder-a": 2 }
  );
  assert.deepEqual(parseAssignments("broken json"), {});
  assert.deepEqual(parseAssignments([]), {});
});

test("top-level lookup walks nested pinned Zen folders", () => {
  const root = { isZenFolder: true, pinned: true, group: null };
  const child = { isZenFolder: true, pinned: true, group: root };
  const grandchild = { isZenFolder: true, pinned: true, group: child };

  assert.equal(getTopLevelPinnedFolder(grandchild), root);
  assert.equal(getTopLevelPinnedFolder({}), null);
});
