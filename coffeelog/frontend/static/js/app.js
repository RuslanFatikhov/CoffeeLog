import { deleteEntry, getAllEntries, getEntry, getUnsyncedEntries, putEntries, putEntry } from "#idb";
import { applyTranslations, getLanguage, setLanguage, t } from "/static/js/i18n.js";

const APP_VERSION = document.documentElement.dataset.appVersion || "0.1";
const APP_VERSION_KEY = "coffeelog_app_version";
const PROCESS_OPTIONS = ["Washed", "Natural", "Honey", "Anaerobic"];
const BREW_METHOD_OPTIONS = ["Espresso", "V60", "Aeropress", "Chemex", "French Press", "Cupping"];
const BREW_METHOD_ICONS = {
  Espresso: "/static/icons/brew-method/espresso.png",
  V60: "/static/icons/brew-method/v60.png",
  Aeropress: "/static/icons/brew-method/aeropress.png",
  Chemex: "/static/icons/brew-method/chemex.png",
  "French Press": "/static/icons/brew-method/french-press.png",
  Cupping: "/static/icons/brew-method/cupping.png",
};
const RANDOM_COFFEE_PREFIXES = ["Morning", "Velvet", "Sunrise", "Roaster's", "Caramel", "Midnight", "Cloud", "Cocoa"];
const RANDOM_COFFEE_SUFFIXES = ["Blend", "Brew", "Espresso", "Cup", "Roast", "Drip", "V60", "Shot"];
const HISTORY_PREVIEW_LIMIT = 5;
const MAX_PHOTOS = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/heif", "image/heic"]);
const COUNTRIES_ENDPOINT_BASE = "/static/data/countries";

let deferredInstallPrompt = null;
let countriesCache = null;

function normalizeEntry(entry) {
  return entry;
}

function ensureUserKey() {
  const key = localStorage.getItem("coffeelog_user_key");
  if (key) return key;

  const newKey = crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}-${Math.random()}`;
  localStorage.setItem("coffeelog_user_key", newKey);
  return newKey;
}

function showMessage(target, message, type = "") {
  if (!target) return;
  target.textContent = message;
  target.className = `inline-message ${type}`.trim();
  target.hidden = false;
}

function parseListInput(value) {
  return (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function initCreateFlavorWheel(form) {
  const viewportEl = form.querySelector("[data-create-wheel-viewport]");
  const svgEl = form.querySelector("[data-create-wheel-svg]");
  const rootEl = form.querySelector("[data-create-wheel-root]");
  const selectedLabelEl = form.querySelector("[data-create-wheel-selected-label]");
  const centerFocusEl = form.querySelector("[data-create-wheel-center-focus]");
  const centerFocusTextEl = form.querySelector("[data-create-wheel-center-focus-text]");
  const flavorInput = form.elements.namedItem("flavor_wheel");
  if (!viewportEl || !svgEl || !rootEl || !selectedLabelEl || !centerFocusEl || !centerFocusTextEl || !flavorInput) {
    return;
  }

  try {
    const [{ getWheelSegments }, { WheelController }] = await Promise.all([
      import("/static/js/wheel.data.js"),
      import("/static/js/wheel.controller.js"),
    ]);
    const result = await getWheelSegments();
    const segments = Array.isArray(result?.segments) ? result.segments : [];
    if (segments.length === 0) return;

    const controller = new WheelController({
      viewportEl,
      svgEl,
      rootEl,
      selectedLabelEl,
      centerFocusEl,
      centerFocusTextEl,
      data: segments,
      // Wheel center position in SVG space: lower X pushes center further left (stronger crop).
      centerX: -500,
      // Vertical offset of the whole wheel group inside viewport.
      centerY: 400,
      // Global wheel size multiplier (all ring radii scale together).
      radiusScale: 4,
      // Rotation sensitivity for mouse wheel / trackpad scroll.
      scrollSpeed: 0.085,
      // Rotation sensitivity for vertical drag/touch move.
      dragSpeed: 0.28,
      onSelectionChange: (selectedEntries) => {
        flavorInput.value = selectedEntries.map((entry) => entry.label).join(", ");
      },
    });

    controller.init();
    const initialValues = parseListInput(flavorInput.value);
    if (initialValues.length > 0) {
      controller.setSelectedByLabels(initialValues);
    }
  } catch (_error) {
    selectedLabelEl.textContent = t("wheel.unavailable", "Wheel unavailable");
  }
}

function normalizeCountryList(payload) {
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.countries) ? payload.countries : [];
  return source
    .map((item) => {
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { shortName: "🌍", fullName: name } : null;
      }
      const shortName = String(
        item?.["short-name"] ?? item?.short_name ?? item?.shortName ?? item?.flag ?? "🌍"
      ).trim();
      const fullName = String(
        item?.["full-name"] ?? item?.full_name ?? item?.fullName ?? item?.name ?? ""
      ).trim();
      if (!fullName) return null;
      return {
        shortName: shortName || "🌍",
        fullName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }));
}

async function loadCountries() {
  if (Array.isArray(countriesCache)) return countriesCache;
  const lang = getLanguage();
  const localizedEndpoint = `${COUNTRIES_ENDPOINT_BASE}.${lang}.json?v=${encodeURIComponent(APP_VERSION)}`;
  const fallbackEndpoint = `${COUNTRIES_ENDPOINT_BASE}.en.json?v=${encodeURIComponent(APP_VERSION)}`;
  const legacyEndpoint = `${COUNTRIES_ENDPOINT_BASE}.json?v=${encodeURIComponent(APP_VERSION)}`;

  const fetchCountries = async (url) => {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeCountryList(payload);
  };

  try {
    countriesCache =
      (await fetchCountries(localizedEndpoint)) ??
      (lang !== "en" ? await fetchCountries(fallbackEndpoint) : null) ??
      (await fetchCountries(legacyEndpoint)) ??
      [];
    return countriesCache;
  } catch (_error) {
    countriesCache = [];
    return countriesCache;
  }
}

function mergeOriginValue(country, details) {
  const countryText = String(country || "").trim();
  const detailsText = String(details || "").trim();
  if (!countryText) return detailsText;
  if (!detailsText) return countryText;
  const lowerDetails = detailsText.toLowerCase();
  const lowerCountry = countryText.toLowerCase();
  if (lowerDetails === lowerCountry || lowerDetails.startsWith(`${lowerCountry},`)) {
    return detailsText;
  }
  return `${countryText}, ${detailsText}`;
}

function splitOriginValue(rawOrigin, countries) {
  const origin = String(rawOrigin || "").trim();
  if (!origin || !Array.isArray(countries) || countries.length === 0) {
    return { country: "", details: origin };
  }
  const lowerOrigin = origin.toLowerCase();
  const countryNames = countries
    .map((country) => String(country?.fullName || "").trim())
    .filter(Boolean);
  const byLength = countryNames.sort((a, b) => b.length - a.length);
  for (const normalizedCountry of byLength) {
    if (!normalizedCountry) continue;
    const lowerCountry = normalizedCountry.toLowerCase();
    if (lowerOrigin === lowerCountry) {
      return { country: normalizedCountry, details: "" };
    }
    if (lowerOrigin.startsWith(`${lowerCountry},`)) {
      return {
        country: normalizedCountry,
        details: origin.slice(normalizedCountry.length + 1).trimStart(),
      };
    }
  }
  return { country: "", details: origin };
}

function initOriginCountryPicker(form, countries) {
  const countryInput = form.elements.namedItem("origin_country");
  const openBtn = form.querySelector("[data-origin-sheet-open]");
  const openLabel = form.querySelector("[data-origin-country-label]");
  const sheet = form.querySelector("[data-origin-sheet]");
  const sheetPanel = form.querySelector(".origin-sheet-panel");
  const searchInput = form.querySelector("[data-origin-country-search]");
  const listEl = form.querySelector("[data-origin-country-list]");
  if (
    !countryInput ||
    !openBtn ||
    !openLabel ||
    !sheet ||
    !sheetPanel ||
    !searchInput ||
    !listEl ||
    !Array.isArray(countries)
  ) {
    return;
  }

  const closeButtons = Array.from(form.querySelectorAll("[data-origin-sheet-close]"));
  const countriesByName = new Map(countries.map((country) => [country.fullName, country]));
  let closeTimerId = null;

  const updateSelectedState = () => {
    const selectedName = String(countryInput.value || "").trim();
    const selectedCountry = countriesByName.get(selectedName) || null;
    openLabel.textContent = selectedCountry?.shortName || "🌍";
    openBtn.setAttribute(
      "aria-label",
      selectedCountry
        ? t("form.selected_country", `Selected country: ${selectedCountry.fullName}`, { country: selectedCountry.fullName })
        : t("form.select_country", "Select country")
    );
  };

  const renderCountryList = (queryText = "") => {
    const query = String(queryText || "")
      .trim()
      .toLowerCase();
    const filtered = query
      ? countries.filter((country) => country.fullName.toLowerCase().includes(query))
      : countries;

    listEl.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("countries.empty", "No countries found.");
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((country) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "origin-country-option";
      option.innerHTML = `<span class="origin-country-flag">${country.shortName}</span><span>${country.fullName}</span>`;
      option.addEventListener("click", () => {
        countryInput.value = country.fullName;
        updateSelectedState();
        closeSheet();
      });
      listEl.appendChild(option);
    });
  };

  const closeSheet = () => {
    if (sheet.hidden || sheet.classList.contains("is-closing")) return;
    sheet.classList.remove("is-open");
    sheet.classList.add("is-closing");
    openBtn.setAttribute("aria-expanded", "false");

    const finalizeClose = () => {
      sheet.hidden = true;
      sheet.classList.remove("is-closing");
      closeTimerId = null;
    };

    const onTransitionEnd = () => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    };

    sheetPanel.addEventListener("transitionend", onTransitionEnd);
    closeTimerId = window.setTimeout(() => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    }, 260);
  };

  const openSheet = () => {
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    sheet.hidden = false;
    sheet.classList.remove("is-closing");
    renderCountryList("");
    searchInput.value = "";
    window.requestAnimationFrame(() => {
      sheet.classList.add("is-open");
      searchInput.focus();
    });
    openBtn.setAttribute("aria-expanded", "true");
  };

  openBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openSheet();
  });
  closeButtons.forEach((button) => button.addEventListener("click", closeSheet));
  searchInput.addEventListener("input", () => {
    renderCountryList(searchInput.value);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet();
    }
  });

  updateSelectedState();
}

function stringifyList(value) {
  if (!Array.isArray(value) || value.length === 0) return "-";
  return value.join(", ");
}

function ratingValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numericValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fillSelect(selectEl, options) {
  if (!selectEl || selectEl.tagName !== "SELECT") return;
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    const optionKey = `option.${String(value).trim().toLowerCase().replace(/\s+/g, "_")}`;
    option.textContent = t(optionKey, value);
    selectEl.appendChild(option);
  });
}

function initBrewMethodPicker(form) {
  const brewMethodInput = form.elements.namedItem("brew_method");
  const openBtn = form.querySelector("[data-brew-sheet-open]");
  const selectedLabel = form.querySelector("[data-brew-selected-label]");
  const sheet = form.querySelector("[data-brew-sheet]");
  const sheetPanel = form.querySelector(".brew-sheet-panel");
  const optionsContainer = form.querySelector("[data-brew-options]");
  if (!brewMethodInput || !openBtn || !selectedLabel || !sheet || !sheetPanel || !optionsContainer) return;

  const closeButtons = Array.from(form.querySelectorAll("[data-brew-sheet-close]"));
  let closeTimerId = null;

  const updateSelectedState = () => {
    const value = (brewMethodInput.value || "").trim();
    selectedLabel.textContent = value || t("common.select", "Select");
    openBtn.dataset.hasValue = value ? "true" : "false";
  };

  const closeSheet = () => {
    if (sheet.hidden || sheet.classList.contains("is-closing")) return;
    sheet.classList.remove("is-open");
    sheet.classList.add("is-closing");
    openBtn.setAttribute("aria-expanded", "false");

    const finalizeClose = () => {
      sheet.hidden = true;
      sheet.classList.remove("is-closing");
      closeTimerId = null;
    };

    const onTransitionEnd = () => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    };

    sheetPanel.addEventListener("transitionend", onTransitionEnd);
    closeTimerId = window.setTimeout(() => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    }, 260);
  };

  const openSheet = () => {
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    sheet.hidden = false;
    sheet.classList.remove("is-closing");
    window.requestAnimationFrame(() => {
      sheet.classList.add("is-open");
    });
    openBtn.setAttribute("aria-expanded", "true");
  };

  optionsContainer.innerHTML = "";
  BREW_METHOD_OPTIONS.forEach((methodName) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "brew-method-option";
    btn.dataset.value = methodName;
    const methodKey = `option.${String(methodName).trim().toLowerCase().replace(/\s+/g, "_")}`;
    btn.innerHTML = `<img src="${BREW_METHOD_ICONS[methodName]}" alt="" /><span>${t(methodKey, methodName)}</span>`;
    btn.addEventListener("click", () => {
      brewMethodInput.value = methodName;
      updateSelectedState();
      closeSheet();
    });
    optionsContainer.appendChild(btn);
  });

  openBtn.addEventListener("click", openSheet);
  closeButtons.forEach((btn) => btn.addEventListener("click", closeSheet));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet();
    }
  });

  updateSelectedState();
}

function initBrewTimePicker(form) {
  const brewTimeInput = form.elements.namedItem("brew_time");
  const openCell = form.querySelector("[data-brew-time-open-cell]");
  const openBtn = form.querySelector("[data-brew-time-open]");
  const label = form.querySelector("[data-brew-time-label]");
  const sheet = form.querySelector("[data-brew-time-sheet]");
  const sheetPanel = form.querySelector(".time-sheet-panel");
  const minuteWheel = form.querySelector('[data-time-wheel="min"]');
  const secondWheel = form.querySelector('[data-time-wheel="sec"]');
  const applyBtn = form.querySelector("[data-brew-time-apply]");
  if (!brewTimeInput || !openCell || !openBtn || !label || !sheet || !sheetPanel || !minuteWheel || !secondWheel || !applyBtn) {
    return;
  }

  const closeButtons = Array.from(form.querySelectorAll("[data-brew-time-close]"));
  const ITEM_HEIGHT = 44;
  let closeTimerId = null;
  let minutesValue = 0;
  let secondsValue = 0;

  const toTwoDigits = (n) => String(n).padStart(2, "0");

  const parseTimeValue = (value) => {
    const match = String(value || "")
      .trim()
      .match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return { minutes: 0, seconds: 0 };
    return {
      minutes: Math.min(59, Math.max(0, Number(match[1]) || 0)),
      seconds: Math.min(59, Math.max(0, Number(match[2]) || 0)),
    };
  };

  const formatLabel = (minutes, seconds) =>
    `${minutes} ${t("form.min_short", "min")} ${seconds} ${t("form.sec_short", "sec")}`;

  const updateDisplay = () => {
    brewTimeInput.value = `${toTwoDigits(minutesValue)}:${toTwoDigits(secondsValue)}`;
    label.textContent = formatLabel(minutesValue, secondsValue);
  };

  const updateLabelFromInput = () => {
    const raw = String(brewTimeInput.value || "").trim();
    if (!raw) {
      label.textContent = t("common.select_min_sec", "Select min/sec");
      return;
    }
    const parsed = parseTimeValue(raw);
    label.textContent = formatLabel(parsed.minutes, parsed.seconds);
  };

  const updateWheelActiveState = (wheel, value) => {
    wheel.querySelectorAll(".time-wheel-item").forEach((item) => {
      item.classList.toggle("active", Number(item.dataset.value) === value);
    });
  };

  const clampWheelValue = (wheel) => {
    const max = 59;
    const current = Math.round(wheel.scrollTop / ITEM_HEIGHT);
    return Math.min(max, Math.max(0, current));
  };

  const scrollWheelTo = (wheel, value, behavior = "auto") => {
    wheel.scrollTo({ top: value * ITEM_HEIGHT, behavior });
  };

  const buildWheel = (wheel) => {
    wheel.innerHTML = "";
    for (let i = 0; i <= 59; i += 1) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "time-wheel-item";
      item.dataset.value = String(i);
      item.textContent = String(i);
      item.addEventListener("click", () => {
        scrollWheelTo(wheel, i, "smooth");
      });
      wheel.appendChild(item);
    }
  };

  const bindWheel = (wheel, onValueChange) => {
    let snapTimer = null;
    wheel.addEventListener("scroll", () => {
      const value = clampWheelValue(wheel);
      onValueChange(value);
      if (snapTimer) window.clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => {
        scrollWheelTo(wheel, value, "smooth");
      }, 90);
    });
  };

  const closeSheet = () => {
    if (sheet.hidden || sheet.classList.contains("is-closing")) return;
    sheet.classList.remove("is-open");
    sheet.classList.add("is-closing");
    openBtn.setAttribute("aria-expanded", "false");

    const finalizeClose = () => {
      sheet.hidden = true;
      sheet.classList.remove("is-closing");
      closeTimerId = null;
    };

    const onTransitionEnd = () => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    };

    sheetPanel.addEventListener("transitionend", onTransitionEnd);
    closeTimerId = window.setTimeout(() => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    }, 260);
  };

  const openSheet = () => {
    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }
    const parsed = parseTimeValue(brewTimeInput.value);
    minutesValue = parsed.minutes;
    secondsValue = parsed.seconds;

    updateWheelActiveState(minuteWheel, minutesValue);
    updateWheelActiveState(secondWheel, secondsValue);
    scrollWheelTo(minuteWheel, minutesValue);
    scrollWheelTo(secondWheel, secondsValue);

    sheet.hidden = false;
    sheet.classList.remove("is-closing");
    window.requestAnimationFrame(() => {
      sheet.classList.add("is-open");
    });
    openBtn.setAttribute("aria-expanded", "true");
  };

  buildWheel(minuteWheel);
  buildWheel(secondWheel);

  bindWheel(minuteWheel, (value) => {
    minutesValue = value;
    updateWheelActiveState(minuteWheel, minutesValue);
  });
  bindWheel(secondWheel, (value) => {
    secondsValue = value;
    updateWheelActiveState(secondWheel, secondsValue);
  });

  openCell.addEventListener("click", (event) => {
    if (event.target.closest("[data-brew-time-sheet]")) return;
    openSheet();
  });
  openBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openSheet();
  });
  closeButtons.forEach((btn) => btn.addEventListener("click", closeSheet));
  applyBtn.addEventListener("click", () => {
    updateDisplay();
    closeSheet();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet();
    }
  });

  updateLabelFromInput();
}

function initMetricPicker(form) {
  const metricCells = Array.from(form.querySelectorAll("[data-metric-field]"));
  const sheet = form.querySelector("[data-metric-sheet]");
  const sheetPanel = form.querySelector(".metric-sheet-panel");
  const titleEl = form.querySelector("[data-metric-title]");
  const displayBtn = form.querySelector("[data-metric-display]");
  const displayValueEl = form.querySelector("[data-metric-display-value]");
  const displayUnitEl = form.querySelector("[data-metric-display-unit]");
  const editorEl = form.querySelector("[data-metric-editor]");
  const arcEl = form.querySelector("[data-metric-arc]");
  const viewportEl = form.querySelector("[data-metric-viewport]");
  const trackEl = form.querySelector("[data-metric-track]");
  const presetsEl = form.querySelector("[data-metric-presets]");
  const applyBtn = form.querySelector("[data-metric-apply]");
  const closeButtons = Array.from(form.querySelectorAll("[data-metric-close]"));
  if (
    metricCells.length === 0 ||
    !sheet ||
    !sheetPanel ||
    !titleEl ||
    !displayBtn ||
    !displayValueEl ||
    !displayUnitEl ||
    !editorEl ||
    !arcEl ||
    !viewportEl ||
    !trackEl ||
    !applyBtn
  ) {
    return;
  }

  const fieldConfig = new Map();
  let activeField = null;
  let draftValue = null;
  let closeTimerId = null;
  let pointerActive = false;
  let pointerId = null;
  let dragStartX = 0;
  let dragStartValue = 0;

  const VISUAL_CONFIG = {
    tickSpacing: 24,
    minorTickSize: 10,
    majorTickSize: 18,
    labelOffsetY: 76,
    viewportPadding: 20,
    centerIndicatorSize: 14,
  };

  const parseNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const decimalPlaces = (step) => {
    const text = String(step ?? "");
    const point = text.indexOf(".");
    return point === -1 ? 0 : text.length - point - 1;
  };

  const formatValue = (value, decimals) => {
    if (value == null) return "";
    if (decimals <= 0) return String(Math.round(value));
    return value.toFixed(decimals).replace(/\.?0+$/, "");
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const snapToStep = (value, config) =>
    clamp(Math.round((value - config.min) / config.step) * config.step + config.min, config.min, config.max);
  const parsePresetNumbers = (value) =>
    String(value || "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  const equalWithStepTolerance = (a, b, decimals) => {
    const precision = Math.max(1e-6, 10 ** (-(decimals + 1)));
    return Math.abs(a - b) <= precision;
  };
  const formatPresetLabel = (value, unit, decimals) => {
    const rendered = formatValue(value, decimals);
    if (!unit) return rendered;
    return unit.startsWith("°") ? `${rendered}${unit}` : `${rendered} ${unit}`;
  };

  const isMajorTick = (tickIndex, config) => tickIndex % config.majorStepInterval === 0;

  const updateScaleVisual = () => {
    if (!activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config || draftValue == null) return;

    const viewportRect = viewportEl.getBoundingClientRect();
    const arcRect = arcEl.getBoundingClientRect();
    const width = viewportRect.width || viewportEl.clientWidth || 320;
    let centerX = width / 2;
    if (viewportRect.width > 0 && arcRect.width > 0) {
      centerX = arcRect.width / 2 - (viewportRect.left - arcRect.left);
    }
    const currentIndex = (draftValue - config.min) / config.step;
    const maxIndex = Math.round((config.max - config.min) / config.step);
    const visibleRadius = Math.ceil((width + VISUAL_CONFIG.viewportPadding * 2) / VISUAL_CONFIG.tickSpacing / 2) + 3;

    const fragment = document.createDocumentFragment();
    const startIndex = Math.max(0, Math.floor(currentIndex - visibleRadius));
    const endIndex = Math.min(maxIndex, Math.ceil(currentIndex + visibleRadius));
    for (let tickIndex = startIndex; tickIndex <= endIndex; tickIndex += 1) {

      const value = Number((config.min + tickIndex * config.step).toFixed(4));
      const x = centerX + (tickIndex - currentIndex) * VISUAL_CONFIG.tickSpacing;
      const isMajor = isMajorTick(tickIndex, config);

      const tickEl = document.createElement("span");
      tickEl.className = `metric-scale-tick ${isMajor ? "major" : "minor"}`;
      tickEl.style.left = `${x}px`;
      tickEl.style.height = `${isMajor ? VISUAL_CONFIG.majorTickSize : VISUAL_CONFIG.minorTickSize}px`;
      fragment.appendChild(tickEl);

      if (isMajor) {
        const labelEl = document.createElement("span");
        labelEl.className = "metric-scale-label";
        labelEl.style.left = `${x}px`;
        labelEl.style.top = `${VISUAL_CONFIG.labelOffsetY}px`;
        labelEl.textContent = formatValue(value, config.decimals);
        fragment.appendChild(labelEl);
      }
    }

    trackEl.replaceChildren(fragment);
  };

  const updateTriggerText = (field) => {
    const config = fieldConfig.get(field);
    if (!config) return;
    const raw = String(config.input.value || "").trim();
    if (!raw) {
      config.label.textContent = t("common.select", "Select");
      return;
    }
    const numeric = parseNumber(raw);
    if (numeric == null) {
      config.label.textContent = t("common.select", "Select");
      return;
    }
    const rendered = formatValue(numeric, config.decimals);
    config.label.textContent = `${rendered} ${config.unit}`;
  };

  const closeSheet = () => {
    if (sheet.hidden || sheet.classList.contains("is-closing")) return;
    sheet.classList.remove("is-open");
    sheet.classList.add("is-closing");

    const config = activeField ? fieldConfig.get(activeField) : null;
    if (config) config.trigger.setAttribute("aria-expanded", "false");

    const finalizeClose = () => {
      sheet.hidden = true;
      sheet.classList.remove("is-closing");
      closeTimerId = null;
      activeField = null;
      draftValue = null;
      editorEl.hidden = true;
      editorEl.disabled = true;
      displayBtn.hidden = false;
    };

    const onTransitionEnd = () => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    };

    sheetPanel.addEventListener("transitionend", onTransitionEnd);
    closeTimerId = window.setTimeout(() => {
      sheetPanel.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    }, 260);
  };

  const renderDraft = () => {
    if (!activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config || draftValue == null) return;

    const rendered = formatValue(draftValue, config.decimals);
    displayValueEl.textContent = rendered || "0";
    displayUnitEl.textContent = config.unit;
    editorEl.value = rendered;
    updateScaleVisual();
    if (presetsEl) {
      presetsEl.querySelectorAll(".metric-preset-chip").forEach((chip) => {
        const chipValue = parseNumber(chip.dataset.metricPresetValue);
        const isActive = chipValue != null && equalWithStepTolerance(chipValue, draftValue, config.decimals);
        chip.classList.toggle("active", isActive);
        chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }
  };

  const renderPresetChips = (config) => {
    if (!presetsEl) return;
    presetsEl.innerHTML = "";
    const presets = Array.isArray(config?.presets) ? config.presets : [];
    if (presets.length === 0) {
      presetsEl.hidden = true;
      return;
    }
    presetsEl.hidden = false;
    presets.forEach((value) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "metric-preset-chip";
      chip.dataset.metricPresetValue = String(value);
      chip.textContent = formatPresetLabel(value, config.unit, config.decimals);
      chip.addEventListener("click", () => {
        draftValue = value;
        renderDraft();
      });
      presetsEl.appendChild(chip);
    });
  };

  const openSheet = (field) => {
    const config = fieldConfig.get(field);
    if (!config) return;

    if (closeTimerId) {
      window.clearTimeout(closeTimerId);
      closeTimerId = null;
    }

    if (activeField && activeField !== field) {
      const previous = fieldConfig.get(activeField);
      if (previous) previous.trigger.setAttribute("aria-expanded", "false");
    }

    const current = parseNumber(config.input.value);
    const nextDraft = current == null ? config.defaultValue : current;
    draftValue = snapToStep(clamp(nextDraft, config.min, config.max), config);
    activeField = field;

    titleEl.textContent = config.title;
    arcEl.style.setProperty("--metric-viewport-padding", `${VISUAL_CONFIG.viewportPadding}px`);
    arcEl.style.setProperty("--metric-center-size", `${VISUAL_CONFIG.centerIndicatorSize}px`);

    sheet.hidden = false;
    sheet.classList.remove("is-closing");
    renderPresetChips(config);
    renderDraft();
    window.requestAnimationFrame(() => {
      sheet.classList.add("is-open");
      renderDraft();
    });
    config.trigger.setAttribute("aria-expanded", "true");
    editorEl.hidden = true;
    editorEl.disabled = true;
    displayBtn.hidden = false;
  };

  metricCells.forEach((cell) => {
    const field = cell.dataset.metricField;
    if (!field) return;
    const input = form.elements.namedItem(field);
    const trigger = cell.querySelector(`[data-metric-open="${field}"]`);
    const label = cell.querySelector(`[data-metric-value-for="${field}"]`);
    if (!input || !trigger || !label) return;

    const min = parseNumber(cell.dataset.metricMin) ?? 0;
    const max = parseNumber(cell.dataset.metricMax) ?? 100;
    const step = parseNumber(cell.dataset.metricStep) ?? 1;
    const defaultValue = parseNumber(cell.dataset.metricDefault) ?? min;
    const unit = cell.dataset.metricUnit || "";
    const titleKey = cell.dataset.metricLabelKey || "";
    const titleFallback = cell.dataset.metricLabel || "Value";
    const title = titleKey ? t(titleKey, titleFallback) : titleFallback;
    const presetsRaw = parsePresetNumbers(cell.dataset.metricQuickPresets);
    const presetConfig = { min, max, step };
    const presets = Array.from(
      new Set(
        presetsRaw.map((value) => {
          const normalized = snapToStep(value, presetConfig);
          return formatValue(normalized, decimalPlaces(step));
        })
      )
    )
      .map((value) => parseNumber(value))
      .filter((value) => value != null);

    const majorTickEvery = parseNumber(cell.dataset.metricMajor) ?? step * 5;
    const majorStepIntervalRaw = majorTickEvery / step;
    const majorStepInterval = Number.isFinite(majorStepIntervalRaw)
      ? Math.max(1, Math.round(majorStepIntervalRaw))
      : 1;

    fieldConfig.set(field, {
      input,
      trigger,
      label,
      min,
      max,
      step,
      defaultValue,
      unit,
      title,
      presets,
      majorTickEvery,
      majorStepInterval,
      decimals: decimalPlaces(step),
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      openSheet(field);
    });
    cell.addEventListener("click", (event) => {
      if (event.target.closest("[data-metric-sheet]")) return;
      openSheet(field);
    });

    updateTriggerText(field);
  });

  arcEl.addEventListener("pointerdown", (event) => {
    if (!activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config) return;
    event.preventDefault();
    pointerActive = true;
    pointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartValue = draftValue ?? config.defaultValue;
    arcEl.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener("pointermove", (event) => {
    if (!pointerActive || event.pointerId !== pointerId || !activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config) return;
    event.preventDefault();
    const deltaX = event.clientX - dragStartX;
    const pxPerUnit = VISUAL_CONFIG.tickSpacing / config.step;
    const next = dragStartValue - deltaX / pxPerUnit;
    draftValue = snapToStep(clamp(next, config.min, config.max), config);
    renderDraft();
  });

  const finalizeDrag = (event) => {
    if (!pointerActive || event.pointerId !== pointerId || !activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config || draftValue == null) return;
    pointerActive = false;
    draftValue = clamp(Math.round((draftValue - config.min) / config.step) * config.step + config.min, config.min, config.max);
    renderDraft();
  };

  window.addEventListener("pointerup", finalizeDrag);
  window.addEventListener("pointercancel", finalizeDrag);

  displayBtn.addEventListener("click", () => {
    if (!activeField) return;
    displayBtn.hidden = true;
    editorEl.disabled = false;
    editorEl.hidden = false;
    editorEl.focus();
    editorEl.select();
  });

  const commitEditorValue = () => {
    if (!activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config) return;
    const parsed = parseNumber(editorEl.value);
    if (parsed == null) {
      renderDraft();
      return;
    }
    draftValue = snapToStep(parsed, config);
    renderDraft();
  };

  editorEl.addEventListener("blur", () => {
    commitEditorValue();
    editorEl.hidden = true;
    editorEl.disabled = true;
    displayBtn.hidden = false;
  });
  editorEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEditorValue();
      editorEl.hidden = true;
      editorEl.disabled = true;
      displayBtn.hidden = false;
    }
  });

  applyBtn.addEventListener("click", () => {
    if (!activeField) return;
    const config = fieldConfig.get(activeField);
    if (!config || draftValue == null) return;

    config.input.value = formatValue(draftValue, config.decimals);
    updateTriggerText(activeField);
    closeSheet();
  });

  closeButtons.forEach((btn) => btn.addEventListener("click", closeSheet));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet();
    }
  });

  window.addEventListener("resize", updateScaleVisual);
}

function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const raw = String(value);
    return raw.length >= 16 ? raw.slice(0, 16) : "";
  }
  return toLocalDateTimeInputValue(parsed);
}

function formatBrewDate(value) {
  if (!value) return "Unknown date";
  return String(value).replace("T", " ");
}

function formatBrewDateDetails(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const dd = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()] || "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const formattedDate = `${dd} ${month} ${hh}:${mm}`;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfGiven = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfGiven.getTime()) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) return `Today, ${formattedDate}`;
  if (dayDiff === 1) return `Yesterday, ${formattedDate}`;
  return formattedDate;
}

function formatEntryCardDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfGiven = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfGiven.getTime()) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateRandomCoffeeName() {
  return `${randomItem(RANDOM_COFFEE_PREFIXES)} ${randomItem(RANDOM_COFFEE_SUFFIXES)}`;
}

function setupCreateStepper(form) {
  const screens = Array.from(form.querySelectorAll("[data-step-screen]"));
  if (screens.length === 0) return;

  const prevBtn = form.querySelector("[data-step-prev]");
  const nextBtn = form.querySelector("[data-step-next]");
  const submitBtn = form.querySelector("[data-step-submit]");
  const indicator = form.querySelector("#create-step-indicator");
  const heading = document.getElementById("create-heading");
  const dotsContainer = form.querySelector("#create-step-dots");
  const dots = [];

  let currentStep = 0;
  if (dotsContainer) {
    dotsContainer.innerHTML = "";
    screens.forEach((_screen, index) => {
      const dot = document.createElement("span");
      dot.className = "create-step-dot";
      dot.setAttribute("aria-label", `Step ${index + 1}`);
      dotsContainer.appendChild(dot);
      dots.push(dot);
    });
  }

  const renderStep = () => {
    screens.forEach((screen, index) => {
      screen.hidden = index !== currentStep;
    });

    if (prevBtn) {
      const isFirst = currentStep === 0;
      prevBtn.dataset.mode = isFirst ? "close" : "back";
      prevBtn.setAttribute(
        "aria-label",
        isFirst ? t("create.close", "Close create") : t("create.prev_step", "Previous step")
      );

      const chevronIcon = prevBtn.querySelector("[data-prev-chevron]");
      const closeIcon = prevBtn.querySelector("[data-prev-close]");
      if (chevronIcon) chevronIcon.hidden = isFirst;
      if (closeIcon) closeIcon.hidden = !isFirst;
    }

    const isLast = currentStep === screens.length - 1;
    if (nextBtn) nextBtn.hidden = isLast;
    if (submitBtn) submitBtn.hidden = !isLast;

    const currentScreen = screens[currentStep];
    const titleKey = currentScreen?.dataset.stepTitleKey || "";
    const fallbackTitle = currentScreen?.dataset.stepTitle || "";
    const title = titleKey ? t(titleKey, fallbackTitle) : fallbackTitle;
    if (indicator) indicator.textContent = title;
    if (heading) heading.textContent = title;

    dots.forEach((dot, index) => {
      dot.classList.toggle("active", index === currentStep);
    });
  };

  prevBtn?.addEventListener("click", () => {
    if (currentStep === 0) {
      window.location.href = "/";
      return;
    }

    currentStep -= 1;
    renderStep();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  nextBtn?.addEventListener("click", () => {
    if (currentStep < screens.length - 1) {
      currentStep += 1;
      renderStep();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  renderStep();
}

function initRatingSliders(form) {
  const names = ["acidity", "sweetness", "bitterness", "body", "balance", "overall"];
  names.forEach((name) => {
    const slider = form.elements.namedItem(name);
    if (!slider) return;
    const valueEl = form.querySelector(`[data-rating-value-for="${name}"]`);
    const badgeEl = form.querySelector(`[data-rating-badge-for="${name}"]`);

    const update = () => {
      if (valueEl) valueEl.textContent = slider.value;
      if (badgeEl) {
        badgeEl.textContent = slider.value;

        const min = Number(slider.min || 0);
        const max = Number(slider.max || 100);
        const current = Number(slider.value || min);
        const range = Math.max(1, max - min);
        const progress = Math.min(1, Math.max(0, (current - min) / range));

        const sliderStyles = getComputedStyle(slider);
        const thumbSize = Number.parseFloat(sliderStyles.getPropertyValue("--slider-thumb-size")) || 88;
        const travel = Math.max(0, slider.clientWidth - thumbSize);
        const centerX = thumbSize / 2 + progress * travel;
        badgeEl.style.left = `${centerX}px`;
      }
    };

    slider.addEventListener("input", update);
    window.addEventListener("resize", update);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(update);
      observer.observe(slider);
    }
    update();
  });
}

function isAllowedPhoto(file) {
  if (ALLOWED_PHOTO_TYPES.has(file.type)) return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".heif") || name.endsWith(".heic");
}

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(t("create.photo_read_failed", "Could not read file")));
    reader.readAsDataURL(blob);
  });
}

function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("create.photo_format_unsupported", "Unsupported image format in this browser")));
    };
    image.src = url;
  });
}

async function getDrawableImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch (_error) {
      // fallback to Image element
    }
  }
  return loadImageElementFromFile(file);
}

async function compressToMaxSize(file, maxBytes) {
  const source = await getDrawableImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("create.canvas_not_supported", "Canvas is not supported"));

  let width = source.width || 0;
  let height = source.height || 0;
  let quality = 0.9;
  let blob = null;

  try {
    if (!width || !height) throw new Error(t("create.invalid_image_dimensions", "Invalid image dimensions"));

    for (let attempt = 0; attempt < 14; attempt += 1) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) throw new Error(t("create.image_encoding_failed", "Image encoding failed"));
      if (blob.size <= maxBytes) return blob;

      if (quality > 0.45) {
        quality -= 0.1;
      } else {
        width *= 0.85;
        height *= 0.85;
      }
    }
  } finally {
    if (typeof source.close === "function") source.close();
  }

  throw new Error(t("create.compress_failed", "Could not compress image to 2 MB"));
}

function renderPhotoPreview(dataUrls) {
  const preview = document.getElementById("photo-preview");
  if (!preview) return;
  preview.innerHTML = "";

  dataUrls.forEach((url, index) => {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Selected photo ${index + 1}`;
    image.className = "photo-item";
    preview.appendChild(image);
  });
}

async function processSelectedPhotos(files) {
  if (files.length > MAX_PHOTOS) {
    throw new Error(t("create.max_photos", `Maximum ${MAX_PHOTOS} photos allowed`, { count: MAX_PHOTOS }));
  }

  const output = [];
  for (const file of files) {
    if (!isAllowedPhoto(file)) {
      throw new Error(t("create.allowed_photo_types", "Only JPEG, PNG, and HEIF photos are allowed"));
    }

    if (file.size <= MAX_IMAGE_BYTES) {
      output.push(await readAsDataURL(file));
      continue;
    }

    const compressedBlob = await compressToMaxSize(file, MAX_IMAGE_BYTES);
    output.push(await readAsDataURL(compressedBlob));
  }

  return output;
}

async function mergeWithLocalEntry(entry) {
  const localEntry = await getEntry(entry.id);
  return {
    ...localEntry,
    ...normalizeEntry(entry),
    synced: true,
  };
}

async function syncEntries(messageEl) {
  if (!navigator.onLine) {
    showMessage(messageEl, t("sync.offline_saved", "Offline - saved locally."), "warn");
    return;
  }

  const userKey = ensureUserKey();
  const unsynced = await getUnsyncedEntries();

  try {
    if (unsynced.length > 0) {
      const pushRes = await fetch("/api/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Key": userKey,
        },
        body: JSON.stringify(unsynced.map(({ synced, photos, ...entry }) => entry)),
      });

      if (!pushRes.ok) {
        throw new Error(`Push failed (${pushRes.status})`);
      }

      const pushed = await pushRes.json();
      const pushedMerged = await Promise.all(pushed.map((entry) => mergeWithLocalEntry(entry)));
      await putEntries(pushedMerged);
    }

    const pullRes = await fetch("/api/entries", {
      headers: { "X-User-Key": userKey },
    });

    if (!pullRes.ok) {
      throw new Error(`Pull failed (${pullRes.status})`);
    }

    const remote = await pullRes.json();
    const remoteMerged = await Promise.all(remote.map((entry) => mergeWithLocalEntry(entry)));
    await putEntries(remoteMerged);

    showMessage(messageEl, t("sync.complete", "Sync complete."), "ok");

    if (location.pathname === "/") {
      await renderEntryList();
    }
  } catch (_error) {
    showMessage(messageEl, t("sync.server_unavailable", "Server unavailable. Entries remain local."), "warn");
  }
}

async function renderEntryList() {
  const listEl = document.getElementById("entry-list");
  const fullListEl = document.getElementById("entry-list-all");
  const showAllBtn = document.getElementById("entry-show-all");
  const historySheet = document.querySelector("[data-history-sheet]");
  const historySheetPanel = document.querySelector(".history-sheet-panel");
  const historyCloseButtons = Array.from(document.querySelectorAll("[data-history-sheet-close]"));
  if (!listEl) return;

  const closeHistorySheet = () => {
    if (!historySheet || historySheet.hidden || historySheet.classList.contains("is-closing")) return;
    historySheet.classList.remove("is-open");
    historySheet.classList.add("is-closing");

    const finalizeClose = () => {
      historySheet.hidden = true;
      historySheet.classList.remove("is-closing");
      if (showAllBtn) showAllBtn.setAttribute("aria-expanded", "false");
    };

    const onTransitionEnd = () => {
      historySheetPanel?.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    };

    historySheetPanel?.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(() => {
      historySheetPanel?.removeEventListener("transitionend", onTransitionEnd);
      finalizeClose();
    }, 260);
  };

  const openHistorySheet = () => {
    if (!historySheet) return;
    historySheet.hidden = false;
    historySheet.classList.remove("is-closing");
    window.requestAnimationFrame(() => {
      historySheet.classList.add("is-open");
    });
    if (showAllBtn) showAllBtn.setAttribute("aria-expanded", "true");
  };

  const buildEntryCard = (entry) => {
    const card = document.createElement("a");
    card.className = "card";
    card.href = `/view?id=${encodeURIComponent(entry.id)}`;

    const title = document.createElement("h3");
    title.textContent = entry.coffee_name;

    const meta1 = document.createElement("p");
    meta1.textContent = formatEntryCardDate(entry.brew_date);

    card.appendChild(title);
    card.appendChild(meta1);
    return card;
  };

  const entries = await getAllEntries();
  listEl.innerHTML = "";
  if (fullListEl) fullListEl.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("history.empty_start", "Start your coffee journey");
    listEl.appendChild(empty);
    if (showAllBtn) {
      showAllBtn.hidden = true;
      showAllBtn.setAttribute("aria-expanded", "false");
    }
    closeHistorySheet();
    return;
  }

  entries.slice(0, HISTORY_PREVIEW_LIMIT).forEach((entry) => {
    listEl.appendChild(buildEntryCard(entry));
  });

  if (fullListEl) {
    entries.forEach((entry) => {
      fullListEl.appendChild(buildEntryCard(entry));
    });
  }

  const shouldShowAll = entries.length > HISTORY_PREVIEW_LIMIT;
  if (showAllBtn) {
    showAllBtn.hidden = !shouldShowAll;
    if (!showAllBtn.dataset.bound) {
      showAllBtn.dataset.bound = "true";
      showAllBtn.addEventListener("click", openHistorySheet);
    }
  }

  if (!shouldShowAll) {
    closeHistorySheet();
  }

  if (historyCloseButtons.length > 0 && !document.body.dataset.historySheetBound) {
    document.body.dataset.historySheetBound = "true";
    historyCloseButtons.forEach((button) => button.addEventListener("click", closeHistorySheet));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && historySheet && !historySheet.hidden) {
        closeHistorySheet();
      }
    });
  }
}

async function handleCreateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const messageEl = document.getElementById("create-message");
  const submitBtn = form.querySelector("[data-step-submit]");

  if (submitBtn && submitBtn.hidden) {
    showMessage(messageEl, t("create.complete_steps", "Use Next to complete all steps before saving."), "warn");
    return;
  }

  const coffeeName = form.coffee_name.value.trim();
  const finalCoffeeName = coffeeName || generateRandomCoffeeName();
  form.coffee_name.value = finalCoffeeName;

  const photoFiles = Array.from(form.photos?.files || []);
  let photos = [];
  try {
    photos = await processSelectedPhotos(photoFiles);
  } catch (error) {
    showMessage(messageEl, error.message || t("create.photo_processing_failed", "Photo processing failed."), "warn");
    return;
  }

  const editId = (form.dataset.editId || "").trim();
  const existingEntry = editId ? await getEntry(editId) : null;
  const existingPhotos = existingEntry?.photos || [];
  const finalPhotos = photos.length > 0 ? photos : existingPhotos;

  const entry = {
    id: editId || (crypto.randomUUID ? crypto.randomUUID() : `entry-${Date.now()}-${Math.random()}`),
    created_at: existingEntry?.created_at || new Date().toISOString(),
    brew_date: form.brew_date.value || toLocalDateTimeInputValue(),
    coffee_name: finalCoffeeName,
    roastery: form.roastery.value.trim(),
    origin: mergeOriginValue(form.origin_country?.value, form.origin.value),
    process: form.process.value || null,
    brew_method: form.brew_method.value || null,
    water_temp: numericValue(form.water_temp.value),
    dose: numericValue(form.dose.value),
    brew_time: form.brew_time.value.trim(),
    aroma: [],
    flavor: parseListInput(form.flavor_wheel?.value),
    aftertaste: [],
    acidity: ratingValue(form.acidity.value),
    sweetness: ratingValue(form.sweetness.value),
    bitterness: ratingValue(form.bitterness.value),
    body: ratingValue(form.body.value),
    balance: ratingValue(form.balance.value),
    overall: ratingValue(form.overall.value),
    defects: [],
    notes: form.notes.value.trim(),
    photos: finalPhotos,
    synced: false,
  };

  await putEntry(entry);

  if (!navigator.onLine) {
    showMessage(messageEl, t("sync.offline_saved", "Offline - saved locally."), "warn");
  } else {
    showMessage(messageEl, t("create.saved_local", "Saved locally."), "ok");
  }

  setTimeout(() => {
    window.location.href = "/";
  }, 250);
}

async function initCreatePage() {
  const form = document.getElementById("create-form");
  if (!form) return;
  const photoPickerOpenBtn = form.querySelector("[data-photo-picker-open]");

  fillSelect(form.process, PROCESS_OPTIONS);
  const countries = await loadCountries();

  const params = new URLSearchParams(window.location.search);
  const editId = params.get("id");
  let editEntry = null;

  if (editId) {
    editEntry = await getEntry(editId);
    if (!editEntry && navigator.onLine) {
      try {
        const res = await fetch(`/api/entry/${encodeURIComponent(editId)}`, {
          headers: { "X-User-Key": ensureUserKey() },
        });
        if (res.ok) {
          editEntry = normalizeEntry(await res.json());
          const localExisting = await getEntry(editEntry.id);
          await putEntry({ ...localExisting, ...editEntry, synced: true });
        }
      } catch (_error) {
        // no-op
      }
    }
  }

  if (editEntry) {
    form.dataset.editId = String(editEntry.id);
    form.coffee_name.value = editEntry.coffee_name || "";
    form.brew_date.value = toDateTimeLocalValue(editEntry.brew_date);
    form.roastery.value = editEntry.roastery || "";
    const parsedOrigin = splitOriginValue(editEntry.origin || "", countries);
    form.origin_country.value = parsedOrigin.country || "";
    form.origin.value = parsedOrigin.details || "";
    form.process.value = editEntry.process || "";
    form.brew_method.value = editEntry.brew_method || "";
    form.water_temp.value = editEntry.water_temp != null ? String(editEntry.water_temp) : "";
    form.dose.value = editEntry.dose != null ? String(editEntry.dose) : "";
    form.brew_time.value = editEntry.brew_time || "";
    form.flavor_wheel.value = Array.isArray(editEntry.flavor) ? editEntry.flavor.join(", ") : "";
    form.notes.value = editEntry.notes || "";
    form.acidity.value = editEntry.acidity || 0;
    form.sweetness.value = editEntry.sweetness || 0;
    form.bitterness.value = editEntry.bitterness || 0;
    form.body.value = editEntry.body || 0;
    form.balance.value = editEntry.balance || 0;
    form.overall.value = editEntry.overall || 0;
  }

  initOriginCountryPicker(form, countries);
  initBrewMethodPicker(form);
  initBrewTimePicker(form);
  initMetricPicker(form);
  await initCreateFlavorWheel(form);
  initRatingSliders(form);

  if (!editEntry) {
    form.brew_date.value = toLocalDateTimeInputValue();
  } else if (Array.isArray(editEntry.photos) && editEntry.photos.length > 0) {
    renderPhotoPreview(editEntry.photos.slice(0, MAX_PHOTOS));
  }
  setupCreateStepper(form);
  if (photoPickerOpenBtn && form.photos) {
    photoPickerOpenBtn.addEventListener("click", () => {
      form.photos.click();
    });
  }
  if (form.photos) {
    form.photos.addEventListener("change", async () => {
      const messageEl = document.getElementById("create-message");
      const files = Array.from(form.photos.files || []);

      if (files.length > MAX_PHOTOS) {
        renderPhotoPreview([]);
        showMessage(messageEl, t("create.max_photos", `Maximum ${MAX_PHOTOS} photos allowed.`, { count: MAX_PHOTOS }), "warn");
        return;
      }

      if (files.some((file) => !isAllowedPhoto(file))) {
        renderPhotoPreview([]);
        showMessage(messageEl, t("create.allowed_photo_types", "Only JPEG, PNG, and HEIF photos are allowed."), "warn");
        return;
      }

      try {
        const previews = await Promise.all(files.map((file) => readAsDataURL(file)));
        renderPhotoPreview(previews);
      } catch (_error) {
        renderPhotoPreview([]);
        showMessage(messageEl, t("create.photo_preview_failed", "Could not preview selected photos."), "warn");
      }
    });
  }
  form.addEventListener("submit", handleCreateSubmit);
}

function hashStringToInt(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedValue) {
  let state = hashStringToInt(seedValue) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}

function fallbackColorFromLabel(label) {
  const hue = hashStringToInt(label) % 360;
  return `hsl(${hue} 62% 58%)`;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizeFivePoint(value, fallback = 3) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return clamp01((safe - 1) / 4);
}

function buildPolygonClipPath(corners, rand) {
  const safeCorners = Math.max(3, Math.round(corners));
  const points = [];
  const step = (Math.PI * 2) / safeCorners;
  const start = rand() * Math.PI * 2;
  for (let i = 0; i < safeCorners; i += 1) {
    const angle = start + i * step;
    const radius = 40 + rand() * 18;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }
  return `polygon(${points.join(",")})`;
}

async function resolveFlavorPalette(flavorLabels) {
  const normalized = Array.isArray(flavorLabels)
    ? flavorLabels.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (normalized.length === 0) return [];

  try {
    const { getWheelSegments } = await import("/static/js/wheel.data.js");
    const result = await getWheelSegments();
    const segments = Array.isArray(result?.segments) ? result.segments : [];
    const colorByLabel = new Map();
    segments.forEach((segment) => {
      if (!segment?.selectable) return;
      const key = String(segment.label || "").trim().toLowerCase();
      if (!key) return;
      colorByLabel.set(key, segment.color || fallbackColorFromLabel(key));
    });

    const resolved = normalized.map((label) => colorByLabel.get(label) || fallbackColorFromLabel(label));
    return Array.from(new Set(resolved));
  } catch (_error) {
    return Array.from(new Set(normalized.map((label) => fallbackColorFromLabel(label))));
  }
}

async function renderEntryFlavorArt(artEl, entry) {
  if (!artEl) return;
  artEl.innerHTML = "";

  const flavorLabels = Array.isArray(entry?.flavor) ? entry.flavor : [];
  if (flavorLabels.length === 0) {
    artEl.hidden = true;
    return;
  }

  const palette = await resolveFlavorPalette(flavorLabels);
  if (palette.length === 0) {
    artEl.hidden = true;
    return;
  }

  artEl.hidden = false;
  const rand = seededRandom(`${entry?.id || "entry"}:${palette.join("|")}`);
  const acidityNorm = normalizeFivePoint(entry?.acidity, 3);
  const bitternessNorm = normalizeFivePoint(entry?.bitterness, 3);
  const aromaNorm = normalizeFivePoint(entry?.balance ?? entry?.aroma, 3);
  const sweetnessNorm = normalizeFivePoint(entry?.sweetness, 3);
  const bodyNorm = normalizeFivePoint(entry?.body, 3);

  const minDistancePx = 12 + acidityNorm * 62;
  const cornersCount = Math.round(3 + bitternessNorm * 7);
  const cornerRoundness = 4 + aromaNorm * 44;
  const rotationBias = -70 + sweetnessNorm * 140;
  const scaleFactor = 0.72 + bodyNorm * 0.78;

  const width = Math.max(220, artEl.clientWidth || 0);
  const height = Math.max(120, artEl.clientHeight || 0);
  const placed = [];

  for (let i = 0; i < palette.length; i += 1) {
    const shape = document.createElement("span");
    shape.className = "entry-flavor-shape";

    const size = (30 + rand() * 74) * scaleFactor;
    const margin = size * 0.55 + 4;
    let xPx = margin + rand() * Math.max(1, width - margin * 2);
    let yPx = margin + rand() * Math.max(1, height - margin * 2);

    for (let attempts = 0; attempts < 64; attempts += 1) {
      const candidateX = margin + rand() * Math.max(1, width - margin * 2);
      const candidateY = margin + rand() * Math.max(1, height - margin * 2);
      const ok = placed.every((point) => {
        const dx = candidateX - point.x;
        const dy = candidateY - point.y;
        return Math.hypot(dx, dy) >= minDistancePx;
      });
      if (ok) {
        xPx = candidateX;
        yPx = candidateY;
        break;
      }
    }

    placed.push({ x: xPx, y: yPx });

    const x = (xPx / width) * 100;
    const y = (yPx / height) * 100;
    const rotate = rotationBias + (-26 + rand() * 52);
    const color = palette[i];
    const opacity = 0.24 + rand() * 0.52;
    const polygon = buildPolygonClipPath(cornersCount, rand);

    shape.style.setProperty("--shape-size", `${size.toFixed(1)}px`);
    shape.style.setProperty("--shape-x", `${x.toFixed(1)}%`);
    shape.style.setProperty("--shape-y", `${y.toFixed(1)}%`);
    shape.style.setProperty("--shape-rotate", `${rotate.toFixed(1)}deg`);
    shape.style.setProperty("--shape-radius", `${cornerRoundness.toFixed(1)}%`);
    shape.style.setProperty("--shape-color", color);
    shape.style.setProperty("--shape-opacity", opacity.toFixed(2));
    shape.style.clipPath = polygon;

    artEl.appendChild(shape);
  }
}

async function initViewPage() {
  const details = document.getElementById("entry-details");
  if (!details) return;
  const detailsList = details.querySelector("[data-entry-details-list]");
  const flavorArtEl = details.querySelector("[data-entry-flavor-art]");
  const photoBlock = details.querySelector("[data-entry-photos]");
  const photoSlider = details.querySelector("[data-entry-photo-slider]");
  const editBtn = document.querySelector("[data-entry-edit]");
  const deleteBtn = details.querySelector("[data-entry-delete]");

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    details.innerHTML = `<div class="empty">${t("entry.missing_id", "Missing entry id.")}</div>`;
    return;
  }

  let entry = await getEntry(id);

  if (!entry && navigator.onLine) {
    try {
      const res = await fetch(`/api/entry/${encodeURIComponent(id)}`, {
        headers: { "X-User-Key": ensureUserKey() },
      });

      if (res.ok) {
        entry = normalizeEntry(await res.json());
        const localExisting = await getEntry(entry.id);
        await putEntry({ ...localExisting, ...entry, synced: true });
      }
    } catch (_error) {
      // no-op
    }
  }

  if (!entry) {
    details.innerHTML = `<div class="empty">${t("entry.not_found_local", "Entry not found locally.")}</div>`;
    return;
  }

  await renderEntryFlavorArt(flavorArtEl, entry);

  if (editBtn && entry.id) {
    editBtn.addEventListener("click", () => {
      window.location.href = `/create?id=${encodeURIComponent(entry.id)}`;
    });
  }

  if (deleteBtn && entry.id) {
    deleteBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(t("view.confirm_delete", "Delete this entry?"));
      if (!confirmed) return;

      deleteBtn.disabled = true;
      try {
        if (navigator.onLine) {
          const res = await fetch(`/api/entry/${encodeURIComponent(entry.id)}`, {
            method: "DELETE",
            headers: { "X-User-Key": ensureUserKey() },
          });
          if (!res.ok && res.status !== 404) {
            throw new Error(`Delete failed (${res.status})`);
          }
        }

        await deleteEntry(entry.id);
        window.location.href = "/";
      } catch (_error) {
        deleteBtn.disabled = false;
      }
    });
  }

  const currentHeading = document.getElementById("create-heading");
  if (currentHeading) {
    const titleText = (entry.coffee_name || "").trim() || t("view.entry_details", "Entry Details");
    if (currentHeading.tagName === "H3") {
      currentHeading.textContent = titleText;
    } else {
      const heading = document.createElement("h3");
      heading.id = "create-heading";
      heading.textContent = titleText;
      currentHeading.replaceWith(heading);
    }
  }

  if (detailsList) {
    const values = {
      brew_date: formatBrewDateDetails(entry.brew_date),
      coffee_name: entry.coffee_name || "-",
      roastery: entry.roastery || "-",
      origin: entry.origin || "-",
      process: entry.process || "-",
      brew_method: entry.brew_method || "-",
      water_temp: entry.water_temp != null ? `${entry.water_temp} °C` : "-",
      dose: entry.dose != null ? `${entry.dose} g` : "-",
      brew_time: entry.brew_time || "-",
      aroma: stringifyList(entry.aroma),
      flavor: stringifyList(entry.flavor),
      aftertaste: stringifyList(entry.aftertaste),
      acidity: entry.acidity || "-",
      sweetness: entry.sweetness || "-",
      bitterness: entry.bitterness || "-",
      body: entry.body || "-",
      balance: entry.balance || "-",
      overall: entry.overall || "-",
      defects: stringifyList(entry.defects),
      notes: entry.notes || "-",
    };

    Object.entries(values).forEach(([key, value]) => {
      const row = detailsList.querySelector(`[data-detail-row="${key}"]`);
      const valueEl = detailsList.querySelector(`[data-detail-value="${key}"]`);
      if (!row || !valueEl) return;
      const rendered = String(value ?? "").trim();
      const shouldHide = !rendered || rendered === "-";
      row.hidden = shouldHide;
      if (!shouldHide) valueEl.textContent = rendered;
    });
  }

  if (photoBlock && photoSlider) {
    photoSlider.innerHTML = "";
    const photos = Array.isArray(entry.photos) ? entry.photos.slice(0, MAX_PHOTOS) : [];
    if (photos.length === 0) {
      photoBlock.hidden = true;
    } else {
      photoBlock.hidden = false;
      photos.forEach((url, index) => {
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${t("form.photo", "Coffee photo")} ${index + 1}`;
        image.className = "photo-slide";
        photoSlider.appendChild(image);
      });
    }
  }

}

function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const installButtons = document.querySelectorAll("[data-install]");
    installButtons.forEach((btn) => {
      btn.hidden = false;
      btn.disabled = false;
    });
  });

  document.querySelectorAll("[data-install]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      btn.hidden = true;
    });
  });
}

function initSyncButtons() {
  const syncButtons = document.querySelectorAll("[data-sync]");
  const messageEl = document.getElementById("sync-message");

  syncButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await syncEntries(messageEl);
      button.disabled = false;
    });
  });
}

function initOnlineStatus() {
  const statusEl = document.getElementById("status-text");
  if (!statusEl) return;

  const update = () => {
    statusEl.textContent = navigator.onLine ? t("status.online", "Online") : t("status.offline", "Offline");
  };

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

async function applyAppVersion() {
  const appliedVersion = localStorage.getItem(APP_VERSION_KEY);
  if (appliedVersion === APP_VERSION) return;

  localStorage.setItem(APP_VERSION_KEY, APP_VERSION);

  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("coffeelog-shell-v"))
          .map((key) => caches.delete(key))
      );
    } catch (_error) {
      // ignore cache cleanup failures
    }
  }

  if (appliedVersion && appliedVersion !== APP_VERSION) {
    window.location.reload();
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`)
    .then((registration) => {
      const activateWaitingWorker = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      };

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            activateWaitingWorker();
          }
        });
      });

      if (registration.waiting) {
        activateWaitingWorker();
      }

      registration.update().catch(() => {
        // ignore update checks if browser blocks it
      });
    })
    .catch(() => {
      // ignore registration failures in unsupported setups
    });
}

async function initSettingsPage() {
  const userKeyEl = document.getElementById("user-key");
  if (userKeyEl) userKeyEl.textContent = ensureUserKey();

  const languageSelect = document.querySelector("[data-language-select]");
  if (!languageSelect) return;
  languageSelect.value = getLanguage();
  languageSelect.addEventListener("change", () => {
    setLanguage(languageSelect.value);
    applyTranslations(document);
  });
}

async function initListPage() {
  await renderEntryList();
}

document.addEventListener("DOMContentLoaded", async () => {
  setLanguage(getLanguage());
  applyTranslations(document);
  await applyAppVersion();
  ensureUserKey();
  registerServiceWorker();
  initInstallPrompt();
  initOnlineStatus();
  initSyncButtons();

  if (location.pathname === "/") {
    await initListPage();
  } else if (location.pathname === "/create") {
    await initCreatePage();
  } else if (location.pathname === "/view") {
    await initViewPage();
  } else if (location.pathname === "/settings") {
    await initSettingsPage();
  }
});
