export const PALETTE_SIZE = 8;
export const INTENSITY_PRESETS = Object.freeze([0, 20, 40, 60, 80]);

const SINGLE_ANCHOR_HUE_OFFSETS = [0, 18, -18, 36, -36, 54, -54, 72];
const SIBLING_HUE_OFFSETS = [0, 14, -14, 28, -28, 42, -42, 56, -56];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const channels = value.slice(0, 3).map(Number);
    if (!channels.every(Number.isFinite)) {
      return null;
    }
    const scale = channels.every(channel => channel >= 0 && channel <= 1)
      ? 1
      : 255;
    return channels.map(channel => clamp(channel / scale, 0, 1));
  }

  if (typeof value !== "string") {
    return null;
  }

  const color = value.trim();
  const hexMatch = color.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hexMatch) {
    let digits = hexMatch[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = digits
        .slice(0, 3)
        .split("")
        .map(character => character + character)
        .join("");
    } else {
      digits = digits.slice(0, 6);
    }
    return [0, 2, 4].map(
      index => Number.parseInt(digits.slice(index, index + 2), 16) / 255
    );
  }

  if (!/^rgba?\(/i.test(color)) {
    return null;
  }

  const channelMatches = color.match(/[-+]?(?:\d*\.)?\d+%?/g);
  if (!channelMatches || channelMatches.length < 3) {
    return null;
  }

  const channels = channelMatches.slice(0, 3).map(channel => {
    if (channel.endsWith("%")) {
      return clamp(Number.parseFloat(channel) / 100, 0, 1);
    }
    return clamp(Number.parseFloat(channel) / 255, 0, 1);
  });
  return channels.every(Number.isFinite) ? channels : null;
}

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

export function rgbToOklch(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.every(isFiniteNumber)) {
    throw new TypeError("rgbToOklch requires three finite RGB channels");
  }

  const [red, green, blue] = rgb.map(channel =>
    srgbToLinear(clamp(channel, 0, 1))
  );
  const long = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const medium = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const short = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const longRoot = Math.cbrt(long);
  const mediumRoot = Math.cbrt(medium);
  const shortRoot = Math.cbrt(short);
  const lightness =
    0.2104542553 * longRoot +
    0.793617785 * mediumRoot -
    0.0040720468 * shortRoot;
  const a =
    1.9779984951 * longRoot -
    2.428592205 * mediumRoot +
    0.4505937099 * shortRoot;
  const b =
    0.0259040371 * longRoot +
    0.7827717662 * mediumRoot -
    0.808675766 * shortRoot;

  return {
    l: lightness,
    c: Math.hypot(a, b),
    h: (((Math.atan2(b, a) * 180) / Math.PI + 360) % 360),
  };
}

export function oklchToRgb(color) {
  if (
    !color ||
    !isFiniteNumber(color.l) ||
    !isFiniteNumber(color.c) ||
    !isFiniteNumber(color.h)
  ) {
    throw new TypeError("oklchToRgb requires finite l, c, and h values");
  }

  const angle = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(angle);
  const b = color.c * Math.sin(angle);
  const longRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mediumRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const shortRoot = color.l - 0.0894841775 * a - 1.291485548 * b;
  const long = longRoot ** 3;
  const medium = mediumRoot ** 3;
  const short = shortRoot ** 3;

  return [
    linearToSrgb(
      4.0767416621 * long -
        3.3077115913 * medium +
        0.2309699292 * short
    ),
    linearToSrgb(
      -1.2684380046 * long +
        2.6097574011 * medium -
        0.3413193965 * short
    ),
    linearToSrgb(
      -0.0041960863 * long -
        0.7034186147 * medium +
        1.707614701 * short
    ),
  ];
}

function isInSrgbGamut(rgb) {
  return rgb.every(channel => channel >= 0 && channel <= 1);
}

export function fitOklchToSrgb(color) {
  const candidate = {
    l: clamp(color.l, 0, 1),
    c: Math.max(0, color.c),
    h: ((color.h % 360) + 360) % 360,
  };

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const rgb = oklchToRgb(candidate);
    if (isInSrgbGamut(rgb)) {
      return rgb;
    }
    candidate.c *= 0.9;
  }

  return oklchToRgb(candidate).map(channel => clamp(channel, 0, 1));
}

export function formatCssColor(color) {
  const channels = fitOklchToSrgb(color).map(channel =>
    Math.round(clamp(channel, 0, 1) * 255)
  );
  return `rgb(${channels.join(" ")})`;
}

export function buildSwatchDataUri(color = null) {
  const fill = color ? formatCssColor(color) : "transparent";
  const defaultMark = color
    ? ""
    : '<path d="M4 14L14 4" stroke="#202124" stroke-width="2" stroke-linecap="round"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
    '<circle cx="9" cy="9" r="8" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="2"/>' +
    `<circle cx="9" cy="9" r="7" fill="${fill}" stroke="#202124" stroke-opacity="0.85" stroke-width="1.25"/>` +
    defaultMark +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function normalizeIntensityPreset(value, fallback = 40) {
  const numericValue = Number(value);
  if (INTENSITY_PRESETS.includes(numericValue)) {
    return numericValue;
  }
  return INTENSITY_PRESETS.includes(fallback) ? fallback : 40;
}

export function getFolderMixWeights(intensityPercent = 0) {
  const intensity = normalizeIntensityPreset(intensityPercent, 0) / 100;
  const roundWeight = value => Math.round(value * 10000) / 10000;
  return {
    behind: roundWeight(0.6 + 0.4 * intensity),
    frontDark: roundWeight(0.6 + 0.4 * intensity),
    frontLight: roundWeight(0.3 + 0.7 * intensity),
  };
}

export function getNativeFolderFrontColor(
  color,
  isDarkMode,
  intensityPercent = 0
) {
  const base = fitOklchToSrgb(color);
  const neutral = isDarkMode ? [0, 0, 0] : [1, 1, 1];
  const weights = getFolderMixWeights(intensityPercent);
  const baseWeight = isDarkMode ? weights.frontDark : weights.frontLight;
  return rgbToOklch(
    base.map(
      (channel, index) =>
        channel * baseWeight + neutral[index] * (1 - baseWeight)
    )
  );
}

export function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map(channel =>
    srgbToLinear(clamp(channel, 0, 1))
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(firstRgb, secondRgb) {
  const first = relativeLuminance(firstRgb);
  const second = relativeLuminance(secondRgb);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function getReferenceBackground(isDarkMode) {
  const channels = isDarkMode ? [23, 23, 26] : [240, 240, 244];
  return channels.map(channel => channel / 255);
}

export function adaptColorForContrast(
  color,
  background,
  targetContrast = 3.1
) {
  if (contrastRatio(fitOklchToSrgb(color), background) >= targetContrast) {
    return { ...color };
  }

  const adjusted = { ...color };
  const direction = relativeLuminance(background) < 0.35 ? 1 : -1;
  for (let attempt = 0; attempt < 28; attempt += 1) {
    adjusted.l = clamp(adjusted.l + direction * 0.025, 0.18, 0.92);
    if (
      contrastRatio(fitOklchToSrgb(adjusted), background) >= targetContrast
    ) {
      break;
    }
  }
  return adjusted;
}

function interpolateHue(start, end, amount) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * amount + 360) % 360;
}

export function interpolateOklch(start, end, amount) {
  return {
    l: start.l + (end.l - start.l) * amount,
    c: start.c + (end.c - start.c) * amount,
    h: interpolateHue(start.h, end.h, amount),
  };
}

export function getPaletteAnchorSlots(anchorCount, paletteSize = PALETTE_SIZE) {
  if (!Number.isInteger(anchorCount) || anchorCount < 1) {
    throw new RangeError("anchorCount must be a positive integer");
  }
  if (!Number.isInteger(paletteSize) || paletteSize < 1) {
    throw new RangeError("paletteSize must be a positive integer");
  }
  if (anchorCount === 1) {
    return [0];
  }
  return Array.from({ length: anchorCount }, (_, index) =>
    Math.round((index * (paletteSize - 1)) / (anchorCount - 1))
  );
}

export function buildPalette(
  anchorValues,
  {
    adaptive = false,
    isDarkMode = false,
    paletteSize = PALETTE_SIZE,
    referenceColor = null,
    targetContrast = 3.1,
  } = {}
) {
  const parsedAnchors = Array.from(anchorValues ?? [])
    .map(parseColor)
    .filter(Boolean);
  if (parsedAnchors.length === 0) {
    throw new Error("A palette requires at least one valid color anchor");
  }

  let anchors = parsedAnchors.map(rgbToOklch);
  if (anchors.length > paletteSize) {
    anchors = Array.from({ length: paletteSize }, (_, index) => {
      const anchorIndex = Math.round(
        (index * (anchors.length - 1)) / (paletteSize - 1)
      );
      return anchors[anchorIndex];
    });
  }

  let palette;
  if (anchors.length === 1) {
    const anchor = anchors[0];
    palette = Array.from({ length: paletteSize }, (_, index) => ({
      ...anchor,
      h:
        (anchor.h +
          SINGLE_ANCHOR_HUE_OFFSETS[index % SINGLE_ANCHOR_HUE_OFFSETS.length] +
          360) %
        360,
    }));
  } else {
    const slots = getPaletteAnchorSlots(anchors.length, paletteSize);
    palette = Array.from({ length: paletteSize }, (_, slot) => {
      let endIndex = slots.findIndex(anchorSlot => anchorSlot >= slot);
      if (endIndex <= 0) {
        return { ...anchors[Math.max(0, endIndex)] };
      }
      const startIndex = endIndex - 1;
      const span = slots[endIndex] - slots[startIndex];
      const amount = span === 0 ? 0 : (slot - slots[startIndex]) / span;
      return interpolateOklch(anchors[startIndex], anchors[endIndex], amount);
    });
  }

  const parsedReference = parseColor(referenceColor);
  if (parsedReference) {
    const reference = rgbToOklch(parsedReference);
    palette = palette.map(color => ({
      ...color,
      l: reference.l,
      c: reference.c,
    }));
  }

  if (!adaptive) {
    return palette;
  }

  const background = getReferenceBackground(isDarkMode);
  return palette.map(color =>
    adaptColorForContrast(color, background, targetContrast)
  );
}

export function deriveChildColor(
  parentColor,
  siblingIndex,
  {
    adaptive = false,
    isDarkMode = false,
    targetContrast = 3.1,
  } = {}
) {
  if (!Number.isInteger(siblingIndex) || siblingIndex < 0) {
    throw new RangeError("siblingIndex must be a non-negative integer");
  }

  const child = {
    l: clamp(parentColor.l + (isDarkMode ? 0.045 : -0.045), 0.24, 0.88),
    c: Math.max(0.045, parentColor.c * 0.88),
    h:
      (parentColor.h +
        SIBLING_HUE_OFFSETS[siblingIndex % SIBLING_HUE_OFFSETS.length] +
        360) %
      360,
  };

  return adaptive
    ? adaptColorForContrast(
        child,
        getReferenceBackground(isDarkMode),
        targetContrast
      )
    : child;
}

export function parseAssignments(value) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const assignments = {};
  for (const [folderId, slot] of Object.entries(parsed)) {
    if (
      folderId &&
      Number.isInteger(slot) &&
      slot >= 0 &&
      slot < PALETTE_SIZE
    ) {
      assignments[folderId] = slot;
    }
  }
  return assignments;
}

export function isPinnedZenFolder(folder) {
  return Boolean(folder?.isZenFolder && folder?.pinned);
}

export function getTopLevelPinnedFolder(folder) {
  if (!isPinnedZenFolder(folder)) {
    return null;
  }

  let topLevelFolder = folder;
  while (isPinnedZenFolder(topLevelFolder.group)) {
    topLevelFolder = topLevelFolder.group;
  }
  return topLevelFolder;
}
