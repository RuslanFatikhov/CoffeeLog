import { getLanguage } from "/static/js/i18n.js";

const WHEEL_REAL_DATA_ENDPOINT_BASE = "/static/data/wheel.realdata.v1";

let cache = null;

function getRing(meta, name, fallbackInner, fallbackOuter) {
  const ring = Array.isArray(meta?.rings) ? meta.rings.find((item) => item.name === name) : null;
  return {
    innerR: Number(ring?.innerR) || fallbackInner,
    outerR: Number(ring?.outerR) || fallbackOuter,
  };
}

function buildWeightMap(tree, defaultWeight) {
  const weights = new Map();

  const walk = (node) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      const leafWeight = Number(node?.weight) || defaultWeight;
      weights.set(node.id, leafWeight);
      return leafWeight;
    }
    const total = children.reduce((sum, child) => sum + walk(child), 0);
    weights.set(node.id, total);
    return total;
  };

  tree.forEach((node) => walk(node));
  return weights;
}

function emitSegment(segments, config) {
  segments.push({
    ring: config.ring,
    id: config.id,
    label: config.label,
    parentId: config.parentId || null,
    color: config.color || "#9aa0a6",
    innerR: config.innerR,
    outerR: config.outerR,
    startAngle: config.startAngle,
    endAngle: config.endAngle,
    selectable: Boolean(config.selectable),
  });
}

function buildSegments(payload) {
  const meta = payload?.meta || {};
  const tree = Array.isArray(payload?.tree) ? payload.tree : [];
  const defaultWeight = Number(meta.defaultWeight) || 1;

  const categoryRing = getRing(meta, "category", 70, 170);
  const subcategoryRing = getRing(meta, "subcategory", 170, 290);
  const flavorRing = getRing(meta, "flavor", 290, 310);

  const weights = buildWeightMap(tree, defaultWeight);
  const totalWeight = tree.reduce((sum, category) => sum + (weights.get(category.id) || 0), 0) || 1;

  const segments = [];
  let angleCursor = -90;

  tree.forEach((category) => {
    const categoryWeight = weights.get(category.id) || defaultWeight;
    const categorySpan = (categoryWeight / totalWeight) * 360;
    const categoryStart = angleCursor;
    const categoryEnd = categoryStart + categorySpan;
    angleCursor = categoryEnd;

    emitSegment(segments, {
      ring: "category",
      id: category.id,
      label: category.label,
      color: category.color,
      innerR: categoryRing.innerR,
      outerR: categoryRing.outerR,
      startAngle: categoryStart,
      endAngle: categoryEnd,
      selectable: false,
    });

    let subcategoryCursor = categoryStart;
    const subcategories = Array.isArray(category.children) ? category.children : [];
    subcategories.forEach((subcategory) => {
      const subcategoryWeight = weights.get(subcategory.id) || defaultWeight;
      const subcategorySpan = (subcategoryWeight / categoryWeight) * categorySpan;
      const subcategoryStart = subcategoryCursor;
      const subcategoryEnd = subcategoryStart + subcategorySpan;
      subcategoryCursor = subcategoryEnd;

      emitSegment(segments, {
        ring: "subcategory",
        id: subcategory.id,
        label: subcategory.label,
        parentId: category.id,
        color: subcategory.color || category.color,
        innerR: subcategoryRing.innerR,
        outerR: subcategoryRing.outerR,
        startAngle: subcategoryStart,
        endAngle: subcategoryEnd,
        selectable: false,
      });

      let flavorCursor = subcategoryStart;
      const flavors = Array.isArray(subcategory.children) ? subcategory.children : [];
      flavors.forEach((flavor) => {
        const flavorWeight = weights.get(flavor.id) || defaultWeight;
        const flavorSpan = (flavorWeight / subcategoryWeight) * subcategorySpan;
        const flavorStart = flavorCursor;
        const flavorEnd = flavorStart + flavorSpan;
        flavorCursor = flavorEnd;

        emitSegment(segments, {
          ring: "flavor",
          id: flavor.id,
          label: flavor.label,
          parentId: subcategory.id,
          color: flavor.color || subcategory.color || category.color,
          innerR: flavorRing.innerR,
          outerR: flavorRing.outerR,
          startAngle: flavorStart,
          endAngle: flavorEnd,
          selectable: true,
        });
      });
    });
  });

  return {
    segments,
    meta: {
      rings: {
        category: categoryRing,
        subcategory: subcategoryRing,
        flavor: flavorRing,
      },
    },
  };
}

export async function getWheelSegments() {
  if (cache) return cache;

  const lang = getLanguage();
  const endpoints = [
    `${WHEEL_REAL_DATA_ENDPOINT_BASE}.${lang}.json`,
    `${WHEEL_REAL_DATA_ENDPOINT_BASE}.en.json`,
    `${WHEEL_REAL_DATA_ENDPOINT_BASE}.json`,
  ];

  let payload = null;
  let lastStatus = 0;
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint);
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }
    payload = await response.json();
    break;
  }

  if (!payload) {
    throw new Error(`Failed to load wheel data (${lastStatus || "network"})`);
  }

  cache = buildSegments(payload);
  return cache;
}
