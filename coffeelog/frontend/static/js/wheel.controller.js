import { t } from "/static/js/i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function polarToCartesian(radius, angleRad) {
  return {
    x: Math.cos(angleRad) * radius,
    y: Math.sin(angleRad) * radius,
  };
}

function normalizeTextRotation(angleDeg) {
  const normalized = ((angleDeg % 360) + 360) % 360;
  // Keep labels readable in one direction by flipping the opposite half.
  if (normalized > 90 && normalized < 270) return angleDeg + 180;
  return angleDeg;
}

// Generates donut slice path from start/end angles in radians.
function describeArcSlice(innerRadius, outerRadius, startAngle, endAngle) {
  const startOuter = polarToCartesian(outerRadius, startAngle);
  const endOuter = polarToCartesian(outerRadius, endAngle);
  const startInner = polarToCartesian(innerRadius, startAngle);
  const endInner = polarToCartesian(innerRadius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

export class WheelController {
  constructor({
    viewportEl,
    svgEl,
    rootEl,
    selectedLabelEl,
    centerFocusEl,
    centerFocusTextEl,
    onSelectionChange = null,
    data,
    centerX = 90,
    centerY = 350,
    innerRadius = 80,
    outerRadius = 300,
    radiusScale = 1,
    scrollSpeed = 0.09,
    dragSpeed = 0.32,
  }) {
    this.viewportEl = viewportEl;
    this.svgEl = svgEl;
    this.rootEl = rootEl;
    this.selectedLabelEl = selectedLabelEl;
    this.centerFocusEl = centerFocusEl;
    this.centerFocusTextEl = centerFocusTextEl;
    this.onSelectionChange = typeof onSelectionChange === "function" ? onSelectionChange : null;
    this.data = Array.isArray(data) ? data : [];

    this.centerX = centerX;
    this.centerY = centerY;
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.radiusScale = Number(radiusScale) || 1;
    this.scrollSpeed = scrollSpeed;
    this.dragSpeed = dragSpeed;

    this.rotation = 0;
    this.targetRotation = 0;
    this.selectedFlavorIds = new Set();
    this.sliceEntries = [];
    this.sliceEntryById = new Map();
    this.labelEntries = [];
    this.focusCandidates = [];
    this.currentFocusedFlavorId = null;
    this.rafId = null;

    this.isDragging = false;
    this.lastPointerY = 0;
  }

  init() {
    if (!this.viewportEl || !this.svgEl || !this.rootEl || this.data.length === 0) return;
    this.renderSlices();
    this.applyTransform();
    this.bindEvents();
    this.startAnimationLoop();
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  renderSlices() {
    this.rootEl.innerHTML = "";
    this.sliceEntries = [];
    this.sliceEntryById.clear();
    this.labelEntries = [];
    this.focusCandidates = [];

    this.data.forEach((item) => {
      const start = ((Number(item.startAngle) || 0) * Math.PI) / 180;
      const end = ((Number(item.endAngle) || 0) * Math.PI) / 180;
      // Per-segment ring radii from data, scaled by global radiusScale from page config.
      const innerRadius = (Number(item.innerR) || this.innerRadius) * this.radiusScale;
      const outerRadius = (Number(item.outerR) || this.outerRadius) * this.radiusScale;

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", describeArcSlice(innerRadius, outerRadius, start, end));
      path.setAttribute("fill", item.color || "#ccc");
      path.setAttribute("data-flavor-id", item.id);
      path.setAttribute("data-flavor-label", item.label);
      path.setAttribute("data-ring", item.ring || "");
      if (item.ring === "flavor") path.setAttribute("data-leaf", "1");
      if (item.selectable) path.setAttribute("data-selectable", "1");
      path.classList.add("wheel-slice");
      this.rootEl.appendChild(path);

      const spanDeg = (Number(item.endAngle) || 0) - (Number(item.startAngle) || 0);
      const shouldRenderLabel =
        (item.ring === "category" && spanDeg >= 10) || (item.ring === "subcategory" && spanDeg >= 8);
      if (shouldRenderLabel) {
        const midAngle = (start + end) / 2;
        const textRadius = (innerRadius + outerRadius) / 2;
        const point = polarToCartesian(textRadius, midAngle);
        const angleDeg = (midAngle * 180) / Math.PI;

        const text = document.createElementNS(SVG_NS, "text");
        text.textContent = item.label || "";
        text.setAttribute("x", String(point.x));
        text.setAttribute("y", String(point.y));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("transform", `rotate(${normalizeTextRotation(angleDeg)} ${point.x} ${point.y})`);
        text.classList.add("wheel-segment-label", `ring-${item.ring || "unknown"}`);
        this.rootEl.appendChild(text);
        this.labelEntries.push({ textEl: text, baseAngleDeg: angleDeg, x: point.x, y: point.y });
      }

      this.sliceEntries.push({
        id: item.id,
        label: item.label || "",
        color: item.color || "#111",
        selectable: Boolean(item.selectable),
        path,
        midAngle: (start + end) / 2,
        focusRadius: (innerRadius + outerRadius) / 2,
      });
      this.sliceEntryById.set(item.id, this.sliceEntries[this.sliceEntries.length - 1]);

      if (item.selectable) {
        this.focusCandidates.push(this.sliceEntries[this.sliceEntries.length - 1]);
      }
    });
  }

  bindEvents() {
    this.viewportEl.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.targetRotation += event.deltaY * this.scrollSpeed;
      },
      { passive: false }
    );

    this.rootEl.addEventListener("click", (event) => {
      const slice = event.target.closest("[data-flavor-id]");
      if (!slice) return;
      if (slice.dataset.selectable !== "1") return;
      this.toggleFlavor(slice.dataset.flavorId);
    });

    this.viewportEl.addEventListener("pointerdown", (event) => {
      this.isDragging = true;
      this.lastPointerY = event.clientY;
      this.viewportEl.setPointerCapture?.(event.pointerId);
    });

    this.viewportEl.addEventListener("pointermove", (event) => {
      if (!this.isDragging) return;
      const deltaY = event.clientY - this.lastPointerY;
      this.lastPointerY = event.clientY;
      this.targetRotation += deltaY * this.dragSpeed;
    });

    const stopDrag = () => {
      this.isDragging = false;
    };
    this.viewportEl.addEventListener("pointerup", stopDrag);
    this.viewportEl.addEventListener("pointercancel", stopDrag);

    this.centerFocusEl?.addEventListener("click", () => {
      if (!this.currentFocusedFlavorId) return;
      this.toggleFlavor(this.currentFocusedFlavorId);
    });
  }

  toggleFlavor(flavorId) {
    if (!flavorId) return;
    if (this.selectedFlavorIds.has(flavorId)) {
      this.selectedFlavorIds.delete(flavorId);
    } else {
      this.selectedFlavorIds.add(flavorId);
    }
    this.updateSelectionUI();
  }

  setSelectedByLabels(labels) {
    const targets = Array.isArray(labels) ? labels : [];
    const normalizedTargets = new Set(targets.map((label) => String(label || "").trim().toLowerCase()).filter(Boolean));
    this.selectedFlavorIds.clear();
    this.sliceEntries.forEach((entry) => {
      if (!entry.selectable) return;
      const normalizedLabel = String(entry.label || "").trim().toLowerCase();
      if (normalizedTargets.has(normalizedLabel)) {
        this.selectedFlavorIds.add(entry.id);
      }
    });
    this.updateSelectionUI();
  }

  updateSelectionUI() {
    const hasSelection = this.selectedFlavorIds.size > 0;
    const selectedEntries = Array.from(this.selectedFlavorIds)
      .map((id) => this.sliceEntryById.get(id))
      .filter(Boolean);

    this.sliceEntries.forEach((entry) => {
      if (!entry.selectable) return;
      const isSelected = this.selectedFlavorIds.has(entry.id);
      entry.path.classList.toggle("active", isSelected);
      entry.path.classList.toggle("dim", hasSelection && !isSelected);
    });

    if (this.onSelectionChange) {
      this.onSelectionChange(selectedEntries);
    }

    if (!this.selectedLabelEl) return;

    if (!hasSelection) {
      this.selectedLabelEl.textContent = t("wheel.placeholder", "Tap + to add flavors");
      this.selectedLabelEl.style.color = "";
      return;
    }

    this.selectedLabelEl.textContent = "";
    selectedEntries.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "wheel-selected-item";
      chip.style.setProperty("--selected-color", entry.color);

      const text = document.createElement("span");
      text.className = "wheel-selected-item-label";
      text.textContent = entry.label;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wheel-selected-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", t("wheel.remove", `Remove ${entry.label}`, { label: entry.label }));
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFlavor(entry.id);
      });

      chip.appendChild(text);
      chip.appendChild(removeBtn);
      this.selectedLabelEl.appendChild(chip);
    });

    const lastChip = this.selectedLabelEl.lastElementChild;
    if (lastChip instanceof HTMLElement) {
      lastChip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  startAnimationLoop() {
    const tick = () => {
      this.rotation += (this.targetRotation - this.rotation) * 0.16;
      this.applyTransform();
      this.updateCenterFocusLabel();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  svgToClient(x, y) {
    const ctm = this.svgEl.getScreenCTM?.();
    if (!ctm) return null;
    const point = this.svgEl.createSVGPoint();
    point.x = x;
    point.y = y;
    return point.matrixTransform(ctm);
  }

  updateCenterFocusLabel() {
    if (!this.centerFocusEl || !this.centerFocusTextEl || this.focusCandidates.length === 0) return;
    const viewportRect = this.viewportEl.getBoundingClientRect();
    const centerX = viewportRect.left + viewportRect.width / 2;
    const centerY = viewportRect.top + viewportRect.height / 2;

    const rotationRad = (this.rotation * Math.PI) / 180;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.focusCandidates.forEach((entry) => {
      const angle = entry.midAngle + rotationRad;
      const localX = this.centerX + Math.cos(angle) * entry.focusRadius;
      const localY = this.centerY + Math.sin(angle) * entry.focusRadius;
      const clientPoint = this.svgToClient(localX, localY);
      if (!clientPoint) return;
      const dx = clientPoint.x - centerX;
      const dy = clientPoint.y - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    });

    // Show center label only when a flavor is reasonably close to viewport center.
    if (!best || bestDistance > 170) {
      if (this.currentFocusedFlavorId !== null) {
        const prev = this.sliceEntryById.get(this.currentFocusedFlavorId);
        prev?.path.classList.remove("focused");
        this.currentFocusedFlavorId = null;
        this.centerFocusTextEl.textContent = "—";
        this.centerFocusTextEl.style.color = "";
      }
      return;
    }

    if (best.id === this.currentFocusedFlavorId) return;
    const prev = this.currentFocusedFlavorId ? this.sliceEntryById.get(this.currentFocusedFlavorId) : null;
    prev?.path.classList.remove("focused");
    this.currentFocusedFlavorId = best.id;
    best.path.classList.add("focused");
    this.centerFocusTextEl.textContent = best.label;
    this.centerFocusTextEl.style.color = best.color || "";
    this.centerFocusEl.classList.remove("rolling");
    // force reflow to restart keyframe
    void this.centerFocusEl.offsetWidth;
    this.centerFocusEl.classList.add("rolling");
  }

  applyTransform() {
    // Core positioning: translate sets wheel center, rotate applies scroll/drag rotation.
    this.rootEl.setAttribute("transform", `translate(${this.centerX} ${this.centerY}) rotate(${this.rotation})`);
    this.updateLabelRotation();
  }

  updateLabelRotation() {
    if (this.labelEntries.length === 0) return;
    this.labelEntries.forEach(({ textEl, baseAngleDeg, x, y }) => {
      // Parent <g> is rotated by this.rotation.
      // Counter-rotate text so global direction stays readable while wheel spins.
      const globalAngle = normalizeTextRotation(baseAngleDeg + this.rotation);
      const localAngle = globalAngle - this.rotation;
      textEl.setAttribute("transform", `rotate(${localAngle} ${x} ${y})`);
    });
  }
}
