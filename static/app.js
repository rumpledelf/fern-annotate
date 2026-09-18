(() => {
  "use strict";

  const canvas = document.getElementById("annotation-canvas");
  const ctx = canvas.getContext("2d");
  const stage = document.querySelector(".annotate-canvas-frame");
  const emptyState = document.querySelector(".empty-state");
  const canvasWrap = document.querySelector(".canvas-wrap");
  const photoInput = document.getElementById("photo-input");
  const textInput = document.getElementById("annotation-text");
  const textFont = document.getElementById("text-font");
  const textAlign = document.getElementById("text-align");
  const textBold = document.getElementById("text-bold");
  const textItalic = document.getElementById("text-italic");
  const textOutline = document.getElementById("text-outline");
  const textSizeInput = document.getElementById("text-size");
  const arrowControls = {
    pointLength: document.getElementById("arrow-point-length"),
    lineLength: document.getElementById("arrow-line-length"),
    headWidth: document.getElementById("arrow-head-width"),
    wingAngle: document.getElementById("arrow-wing-angle"),
    lineWeight: document.getElementById("arrow-line-weight"),
  };
  const strokeWidthInput = document.getElementById("stroke-width");
  const strokeWidthOutput = document.getElementById("stroke-width-output");
  const colorButtons = {
    arrowFill: document.getElementById("arrow-fill"),
    arrowBorder: document.getElementById("arrow-border"),
    textFill: document.getElementById("text-fill"),
    textBorder: document.getElementById("text-border"),
  };
  const colorTriggers = document.querySelectorAll("[data-color-trigger]");
  const statusNode = document.querySelector(".status-msg");
  const metaNode = document.querySelector(".canvas-meta");
  const deleteButton = document.querySelector('[data-action="delete"]');
  const exportButton = document.querySelector('[data-action="export"]');
  const undoButtons = document.querySelectorAll('[data-action="undo"]');
  const redoButtons = document.querySelectorAll('[data-action="redo"]');
  const STORAGE_KEY = "phrond.annotate.state.v1";
  const DB_NAME = "phrond-annotate";
  const IMAGE_KEY = "active-photo";

  const state = {
    tool: "select",
    arrowFill: "#ef342d",
    arrowBorder: "#ffffff",
    textFill: "#000000",
    textBorder: "#ffffff",
    strokeWidth: 3,
    textSize: 8,
    circleStyle: "natural",
    arrowPointLength: 11,
    arrowLineLength: 24,
    arrowHeadWidth: 18,
    arrowWingAngle: 90,
    arrowLineWeight: 5,
    annotations: [],
    selected: null,
    photoName: "",
  };
  let photo = null;
  let pointer = null;
  let undoStack = [];
  let redoStack = [];
  let statusTimer;

  function announce(message) {
    statusNode.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { if (statusNode.textContent === message) statusNode.textContent = ""; }, 3500);
  }

  function cloneAnnotations() {
    return JSON.parse(JSON.stringify(state.annotations));
  }

  function pushHistory(before) {
    undoStack.push(before || cloneAnnotations());
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    updateActions();
  }

  function saveState() {
    const saved = {
      colorDefaultsVersion: 2,
      tool: state.tool, arrowFill: state.arrowFill, arrowBorder: state.arrowBorder,
      textFill: state.textFill, textBorder: state.textBorder, strokeWidth: state.strokeWidth,
      textSize: state.textSize,
      circleStyle: state.circleStyle,
      arrowPointLength: state.arrowPointLength, arrowLineLength: state.arrowLineLength,
      arrowHeadWidth: state.arrowHeadWidth, arrowWingAngle: state.arrowWingAngle,
      arrowLineWeight: state.arrowLineWeight,
      annotations: state.annotations, selected: state.selected, photoName: state.photoName,
      text: textInput.value, font: textFont.value, align: textAlign.value,
      bold: textBold.checked, italic: textItalic.checked, outline: textOutline.checked,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (_error) { /* controls still work */ }
  }

  function restoreState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      for (const key of ["tool", "arrowFill", "arrowBorder", "textFill", "textBorder", "strokeWidth", "textSize", "circleStyle", "arrowPointLength", "arrowLineLength", "arrowHeadWidth", "arrowWingAngle", "arrowLineWeight", "photoName"]) {
        if (saved[key] !== undefined) state[key] = saved[key];
      }
      if (saved.size !== undefined && saved.textSize === undefined) state.textSize = saved.size;
      const oldFill = saved.fillColor || saved.color;
      if (oldFill && saved.arrowFill === undefined) state.arrowFill = oldFill;
      if (saved.colorDefaultsVersion !== 2) {
        const colors = [saved.arrowFill, saved.arrowBorder, saved.textFill, saved.textBorder].filter(Boolean);
        const inheritedSingleColor = colors.length === 4 && colors.every((color) => color === colors[0]);
        const oldFourDefaults = [saved.arrowFill, saved.arrowBorder, saved.textFill, saved.textBorder]
          .map((color) => String(color || "").toLowerCase()).join(",") === "#ef342d,#ffffff,#ef342d,#000000";
        if (inheritedSingleColor || oldFourDefaults || saved.arrowFill === undefined) {
          state.arrowFill = oldFill || "#ef342d";
          state.arrowBorder = "#ffffff";
          state.textFill = "#000000";
          state.textBorder = "#ffffff";
        }
      }
      state.annotations = Array.isArray(saved.annotations) ? saved.annotations : [];
      state.selected = Number.isInteger(saved.selected) ? saved.selected : null;
      if (saved.text && saved.text !== "THIS IS GREG I HATE GREG") textInput.value = saved.text;
      if (saved.font) textFont.value = saved.font;
      if (saved.align) textAlign.value = saved.align;
      textBold.checked = saved.bold !== false;
      textItalic.checked = Boolean(saved.italic);
      textOutline.checked = saved.outline !== false;
    } catch (_error) { /* begin with defaults */ }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("images");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storePhoto(blob) {
    try {
      const db = await openDb();
      const transaction = db.transaction("images", "readwrite");
      transaction.objectStore("images").put(blob, IMAGE_KEY);
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      db.close();
    } catch (_error) { announce("The photo works now, but could not be kept for refresh."); }
  }

  async function readStoredPhoto() {
    try {
      const db = await openDb();
      const transaction = db.transaction("images", "readonly");
      const request = transaction.objectStore("images").get(IMAGE_KEY);
      const blob = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close();
      return blob;
    } catch (_error) { return null; }
  }

  async function deleteStoredPhoto() {
    try {
      const db = await openDb();
      const transaction = db.transaction("images", "readwrite");
      transaction.objectStore("images").delete(IMAGE_KEY);
      db.close();
    } catch (_error) { /* no stored image to clear */ }
  }

  function loadBlob(blob, name, persist = true) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = async () => {
      URL.revokeObjectURL(url);
      const maxDimension = 2400;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      photo = image;
      state.photoName = name || state.photoName || "photo";
      emptyState.hidden = true;
      canvasWrap.hidden = false;
      exportButton.disabled = false;
      metaNode.textContent = `${state.photoName} · ${canvas.width} × ${canvas.height}px`;
      if (persist) await storePhoto(blob);
      saveState();
      render();
      announce("Photo ready.");
    };
    image.onerror = () => { URL.revokeObjectURL(url); announce("That image could not be opened in this browser."); };
    image.src = url;
  }

  function setTool(tool) {
    state.tool = tool;
    canvas.dataset.tool = tool;
    canvas.style.cursor = "";
    document.querySelectorAll("[data-tool]").forEach((button) => {
      const selected = button.dataset.tool === tool;
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-controls]").forEach((section) => { section.classList.toggle("is-hidden", section.dataset.controls !== tool); });
    saveState();
  }

  function selectStyle(selector, value, dataKey) {
    document.querySelectorAll(selector).forEach((button) => {
      const selected = button.dataset[dataKey] === value;
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function updateActions() {
    undoButtons.forEach((button) => { button.disabled = undoStack.length === 0; });
    redoButtons.forEach((button) => { button.disabled = redoStack.length === 0; });
    deleteButton.disabled = state.selected === null || !state.annotations[state.selected];
  }

  function syncControls() {
    strokeWidthInput.value = state.strokeWidth;
    strokeWidthOutput.value = state.strokeWidth;
    textSizeInput.value = state.textSize;
    Object.entries(colorButtons).forEach(([key, button]) => { button.value = state[key]; });
    Object.entries(arrowControls).forEach(([key, input]) => {
      const stateKey = `arrow${key[0].toUpperCase()}${key.slice(1)}`;
      input.value = state[stateKey];
      input.nextElementSibling.value = state[stateKey];
    });
    setTool(state.tool);
    selectStyle("[data-circle-style]", state.circleStyle, "circleStyle");
    updateActions();
  }

  function selectAnnotation(index) {
    state.selected = index;
    const item = index === null ? null : state.annotations[index];
    if (!item) {
      setTool("select");
      updateActions();
      return;
    }
    state.tool = item.type;
    if (item.type === "text") {
      textInput.value = item.text || "";
      if (item.font) textFont.value = item.font;
      if (item.align) textAlign.value = item.align;
      textBold.checked = Boolean(item.bold);
      textItalic.checked = Boolean(item.italic);
      textOutline.checked = Boolean(item.outline);
      state.textSize = item.size ?? state.textSize;
      state.strokeWidth = item.borderWidth ?? state.strokeWidth;
      state.textFill = item.textFill || item.fillColor || state.textFill;
      state.textBorder = item.textBorder || item.strokeColor || state.textBorder;
    } else if (item.type === "arrow") {
      state.strokeWidth = item.borderWidth ?? state.strokeWidth;
      state.arrowFill = item.arrowFill || item.fillColor || state.arrowFill;
      state.arrowBorder = item.arrowBorder || item.strokeColor || state.arrowBorder;
      for (const key of Object.keys(arrowControls)) {
        const stateKey = `arrow${key[0].toUpperCase()}${key.slice(1)}`;
        state[stateKey] = item[key] ?? state[stateKey];
      }
    } else if (item.type === "circle") {
      state.circleStyle = item.style || state.circleStyle;
      state.strokeWidth = item.strokeWidth ?? item.size ?? state.strokeWidth;
      state.arrowFill = item.color || item.arrowFill || item.fillColor || state.arrowFill;
    }
    syncControls();
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }

  function scaledSize(value) {
    return Math.max(2, Math.min(canvas.width, canvas.height) * value / 100);
  }

  function textConfig() {
    return {
      text: textInput.value,
      font: textFont.value, align: textAlign.value, bold: textBold.checked,
      italic: textItalic.checked, outline: textOutline.checked,
      textFill: state.textFill, textBorder: state.textBorder, size: state.textSize, borderWidth: state.strokeWidth,
    };
  }

  function addText(x = canvas.width / 2, y = canvas.height * .16) {
    if (!photo) { announce("Import a photo first."); return; }
    const before = cloneAnnotations();
    state.annotations.push({ type: "text", x, y, rotation: 0, ...textConfig() });
    pushHistory(before);
    state.selected = state.annotations.length - 1;
    saveState();
    render();
    announce("Text added.");
  }

  function arrowTotalLength(item) {
    return scaledSize((item.pointLength ?? state.arrowPointLength) + (item.lineLength ?? state.arrowLineLength));
  }

  function arrowPoints(item) {
    const pointLength = scaledSize(item.pointLength ?? state.arrowPointLength);
    const lineLength = scaledSize(item.lineLength ?? state.arrowLineLength);
    const headHalf = scaledSize(item.headWidth ?? state.arrowHeadWidth) / 2;
    const lineHalf = Math.min(headHalf * .8, scaledSize(item.lineWeight ?? state.arrowLineWeight) / 2);
    const wingAngle = (item.wingAngle ?? state.arrowWingAngle) * Math.PI / 180;
    const wingRun = Math.min(pointLength * .8, Math.max(0, (headHalf - lineHalf) / Math.max(.01, Math.tan(wingAngle))));
    const shoulder = -pointLength;
    const join = shoulder + wingRun;
    const tail = -(pointLength + lineLength);
    return [
      [0, 0],
      [shoulder, -headHalf],
      [join, -lineHalf],
      [tail, -lineHalf],
      [tail, lineHalf],
      [join, lineHalf],
      [shoulder, headHalf],
    ];
  }

  function arrowWorldPoints(item) {
    const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return arrowPoints(item).map(([x, y]) => ({ x: item.x2 + x * cos - y * sin, y: item.y2 + x * sin + y * cos }));
  }

  function normalizeArrowEndpoints(item) {
    const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
    const length = arrowTotalLength(item);
    item.x1 = item.x2 - Math.cos(angle) * length;
    item.y1 = item.y2 - Math.sin(angle) * length;
  }

  function addArrow() {
    const before = cloneAnnotations();
    const item = {
      type: "arrow",
      x1: canvas.width * .3, y1: canvas.height * .68,
      x2: canvas.width * .62, y2: canvas.height * .36,
      arrowFill: state.arrowFill, arrowBorder: state.arrowBorder, borderWidth: state.strokeWidth,
      pointLength: state.arrowPointLength, lineLength: state.arrowLineLength,
      headWidth: state.arrowHeadWidth, wingAngle: state.arrowWingAngle,
      lineWeight: state.arrowLineWeight,
    };
    normalizeArrowEndpoints(item);
    state.annotations.push(item);
    pushHistory(before);
    state.selected = state.annotations.length - 1;
    saveState(); render(); announce("Arrow added.");
  }

  function addCircle() {
    const before = cloneAnnotations();
    state.annotations.push({
      type: "circle", style: state.circleStyle,
      rotation: state.circleStyle === "natural" ? -.2 : 0,
      x1: canvas.width * .3, y1: canvas.height * .28,
      x2: canvas.width * .7, y2: canvas.height * .72,
      color: state.arrowFill, strokeWidth: state.strokeWidth,
    });
    pushHistory(before);
    state.selected = state.annotations.length - 1;
    saveState(); render(); announce("Circle added.");
  }

  function createAnnotation(tool) {
    if (!photo) {
      announce("Import a photo first.");
      return;
    }
    if (tool === "text") addText();
    else if (tool === "arrow") addArrow();
    else if (tool === "circle") addCircle();
  }

  function fontFor(item) {
    const px = scaledSize(item.size);
    return `${item.italic ? "italic " : ""}${item.bold ? "800 " : "400 "}${px}px "${item.font}", sans-serif`;
  }

  function textLines(item) {
    return String(item.text || "").split(/\n/);
  }

  function textBounds(item) {
    ctx.save();
    ctx.font = fontFor(item);
    const lines = textLines(item);
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
    const lineHeight = scaledSize(item.size) * 1.02;
    ctx.restore();
    let left = item.x;
    if (item.align === "center") left -= width / 2;
    if (item.align === "right") left -= width;
    return { x: left - 10, y: item.y - lineHeight, w: width + 20, h: lineHeight * lines.length + 12 };
  }

  function setAnnotationShadow() {
    const scale = Math.min(canvas.width, canvas.height) / 1000;
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = Math.max(1, scale * 5);
    ctx.shadowOffsetX = scale * 2;
    ctx.shadowOffsetY = scale * 3;
  }

  function clearAnnotationShadow() {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawText(item) {
    const px = scaledSize(item.size);
    const lines = textLines(item);
    const lineHeight = px * 1.02;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation || 0);
    ctx.font = fontFor(item);
    ctx.textAlign = item.align || "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    lines.forEach((line, index) => {
      const y = index * lineHeight;
      setAnnotationShadow();
      if (item.outline && (item.borderWidth ?? state.strokeWidth) > 0) {
        ctx.strokeStyle = item.textBorder || item.strokeColor || item.color || state.textBorder;
        ctx.lineWidth = Math.max(1, scaledSize(item.borderWidth ?? state.strokeWidth) * .2);
        ctx.strokeText(line, 0, y);
        clearAnnotationShadow();
      }
      ctx.fillStyle = item.textFill || item.fillColor || item.color || state.textFill;
      ctx.fillText(line, 0, y);
      clearAnnotationShadow();
    });
    ctx.restore();
  }

  function drawArrow(item) {
    const dx = item.x2 - item.x1;
    const dy = item.y2 - item.y1;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;
    const angle = Math.atan2(dy, dx);
    const points = arrowPoints(item);
    ctx.save();
    ctx.translate(item.x2, item.y2);
    ctx.rotate(angle);
    ctx.strokeStyle = item.arrowBorder || item.strokeColor || item.color || state.arrowBorder;
    ctx.fillStyle = item.arrowFill || item.fillColor || item.color || state.arrowFill;
    ctx.lineJoin = "round";
    const borderWidth = item.borderWidth ?? item.size ?? state.strokeWidth;
    ctx.lineWidth = Math.max(1, scaledSize(borderWidth) * .2);
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    setAnnotationShadow();
    ctx.fill();
    clearAnnotationShadow();
    if (borderWidth > 0) ctx.stroke();
    ctx.restore();
  }

  function drawMarkerLoop(item, strokeWidth) {
    const cx = (item.x1 + item.x2) / 2;
    const cy = (item.y1 + item.y2) / 2;
    const rx = Math.abs(item.x2 - item.x1) / 2;
    const ry = Math.abs(item.y2 - item.y1) / 2;
    const points = [];
    const start = -.65;
    const fullTurn = Math.PI * 2;
    const sweep = fullTurn + .65;
    const baseWidth = Math.min(Math.min(rx, ry) * .16, scaledSize(strokeWidth) * .35);
    const smooth = (value) => {
      const t = Math.max(0, Math.min(1, value));
      return t * t * (3 - 2 * t);
    };
    for (let index = 0; index <= 192; index += 1) {
      const progress = index / 192;
      const travel = progress * sweep;
      // Canvas y increases downward, so decreasing angles draw anticlockwise.
      const angle = start - travel;
      const entry = smooth(travel / .5);
      const finish = smooth((travel - (fullTurn - 1.1)) / 1.75);
      // Continue beyond a full turn on an inner track, leaving an open,
      // overlapping arc beside the beginning without crossing the stroke.
      const wobble = .012 * Math.sin(3 * travel) + .008 * Math.sin(5 * travel);
      const radius = 1 + wobble + .02 * (1 - entry) - .17 * finish;
      const pressure = .12 + 1.32 * Math.pow(1 - progress, .85);
      points.push({
        x: cx + Math.cos(angle) * rx * radius,
        y: cy + Math.sin(angle) * ry * radius,
        width: baseWidth * pressure,
      });
    }
    const sides = points.map((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.hypot(dx, dy) || 1;
      const offsetX = -dy / length * point.width / 2;
      const offsetY = dx / length * point.width / 2;
      return { left: { x: point.x + offsetX, y: point.y + offsetY }, right: { x: point.x - offsetX, y: point.y - offsetY } };
    });
    ctx.beginPath();
    ctx.moveTo(sides[0].left.x, sides[0].left.y);
    for (const side of sides) ctx.lineTo(side.left.x, side.left.y);
    for (let index = sides.length - 1; index >= 0; index -= 1) ctx.lineTo(sides[index].right.x, sides[index].right.y);
    ctx.closePath();
    ctx.fill();
    for (const tip of [points[0], points[points.length - 1]]) {
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, tip.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCircle(item) {
    const cx = (item.x1 + item.x2) / 2;
    const cy = (item.y1 + item.y2) / 2;
    const rx = Math.abs(item.x2 - item.x1) / 2;
    const ry = Math.abs(item.y2 - item.y1) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(item.rotation || 0);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = item.color || item.arrowFill || item.fillColor || state.arrowFill;
    ctx.fillStyle = ctx.strokeStyle;
    const strokeWidth = item.strokeWidth ?? item.size ?? state.strokeWidth;
    ctx.lineWidth = Math.max(1, scaledSize(strokeWidth) * .2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setAnnotationShadow();
    if (item.style === "natural") {
      if (strokeWidth > 0) drawMarkerLoop(item, strokeWidth);
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (strokeWidth > 0) ctx.stroke();
    }
    clearAnnotationShadow();
    ctx.restore();
  }

  function boundsFor(item) {
    if (item.type === "text") return textBounds(item);
    if (item.type === "arrow") {
      const points = arrowWorldPoints(item);
      const borderWidth = item.borderWidth ?? item.size ?? state.strokeWidth;
      const padding = screenSize(5) + (borderWidth > 0 ? Math.max(1, scaledSize(borderWidth) * .2) / 2 : 0);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs) - padding;
      const top = Math.min(...ys) - padding;
      return { x: left, y: top, w: Math.max(...xs) + padding - left, h: Math.max(...ys) + padding - top };
    }
    const padding = 0;
    return { x: Math.min(item.x1, item.x2) - padding, y: Math.min(item.y1, item.y2) - padding, w: Math.abs(item.x2 - item.x1) + padding * 2, h: Math.abs(item.y2 - item.y1) + padding * 2 };
  }

  function screenSize(pixels) {
    return pixels * canvas.width / canvas.getBoundingClientRect().width;
  }

  function rotatePoint(point, cx, cy, angle) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
  }

  function circleHandles(item) {
    const box = boundsFor(item);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return [
      { dir: "nw", x: box.x, y: box.y }, { dir: "n", x: cx, y: box.y },
      { dir: "ne", x: box.x + box.w, y: box.y }, { dir: "e", x: box.x + box.w, y: cy },
      { dir: "se", x: box.x + box.w, y: box.y + box.h }, { dir: "s", x: cx, y: box.y + box.h },
      { dir: "sw", x: box.x, y: box.y + box.h }, { dir: "w", x: box.x, y: cy },
    ].map((handle) => ({ ...handle, ...rotatePoint(handle, cx, cy, item.rotation || 0) }));
  }

  function circleHandleAt(item, point) {
    if (!item || item.type !== "circle") return null;
    const radius = screenSize(10);
    return circleHandles(item).find((handle) => Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius)?.dir || null;
  }

  function resizeCircle(item, drag, point) {
    const { x, y, w, h } = drag.box;
    const angle = drag.rotation;
    const worldDx = point.x - drag.start.x;
    const worldDy = point.y - drag.start.y;
    const dx = worldDx * Math.cos(angle) + worldDy * Math.sin(angle);
    const dy = -worldDx * Math.sin(angle) + worldDy * Math.cos(angle);
    const minSize = screenSize(16);
    let left = -w / 2, right = w / 2, top = -h / 2, bottom = h / 2;
    if (drag.handle.includes("w")) left = Math.min(right - minSize, -w / 2 + dx);
    if (drag.handle.includes("e")) right = Math.max(left + minSize, w / 2 + dx);
    if (drag.handle.includes("n")) top = Math.min(bottom - minSize, -h / 2 + dy);
    if (drag.handle.includes("s")) bottom = Math.max(top + minSize, h / 2 + dy);
    const center = rotatePoint({ x: x + w / 2 + (left + right) / 2, y: y + h / 2 + (top + bottom) / 2 }, x + w / 2, y + h / 2, angle);
    item.x1 = center.x - (right - left) / 2;
    item.y1 = center.y - (bottom - top) / 2;
    item.x2 = center.x + (right - left) / 2;
    item.y2 = center.y + (bottom - top) / 2;
  }

  function arrowHandleAt(item, point) {
    if (!item || item.type !== "arrow") return null;
    const radius = Math.max(16, canvas.width / 70);
    if (Math.hypot(point.x - item.x2, point.y - item.y2) <= radius) return "head";
    if (Math.hypot(point.x - item.x1, point.y - item.y1) <= radius) return "tail";
    return null;
  }

  function arrowResizeHandles(item) {
    const box = boundsFor(item);
    return [
      { dir: "nw", x: box.x, y: box.y },
      { dir: "ne", x: box.x + box.w, y: box.y },
      { dir: "se", x: box.x + box.w, y: box.y + box.h },
      { dir: "sw", x: box.x, y: box.y + box.h },
    ];
  }

  function arrowResizeHandleAt(item, point, pointerType) {
    if (!item || item.type !== "arrow") return null;
    const radius = screenSize(pointerType === "mouse" ? 10 : 18);
    return arrowResizeHandles(item).find((handle) => Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius)?.dir || null;
  }

  function resizeArrow(item, drag, point) {
    const fromX = drag.start.x - drag.center.x;
    const fromY = drag.start.y - drag.center.y;
    const rawScale = ((point.x - drag.center.x) * fromX + (point.y - drag.center.y) * fromY) / (fromX * fromX + fromY * fromY);
    const keys = ["pointLength", "lineLength", "headWidth", "lineWeight"];
    const minScale = Math.max(...keys.map((key) => Number(arrowControls[key].min) / drag.values[key]));
    const maxScale = Math.min(...keys.map((key) => Number(arrowControls[key].max) / drag.values[key]));
    const scale = Math.max(minScale, Math.min(maxScale, rawScale));
    for (const key of keys) {
      const value = Math.max(Number(arrowControls[key].min), Math.min(Number(arrowControls[key].max), Math.round(drag.values[key] * scale)));
      item[key] = value;
      const stateKey = `arrow${key[0].toUpperCase()}${key.slice(1)}`;
      state[stateKey] = value;
      arrowControls[key].value = value;
      arrowControls[key].nextElementSibling.value = String(value);
    }
    const borderWidth = Math.min(Number(strokeWidthInput.max), Math.round(drag.values.borderWidth * scale));
    item.borderWidth = borderWidth;
    state.strokeWidth = borderWidth;
    strokeWidthInput.value = borderWidth;
    strokeWidthOutput.value = borderWidth;
    const halfLength = arrowTotalLength(item) / 2;
    item.x1 = drag.center.x - Math.cos(drag.angle) * halfLength;
    item.y1 = drag.center.y - Math.sin(drag.angle) * halfLength;
    item.x2 = drag.center.x + Math.cos(drag.angle) * halfLength;
    item.y2 = drag.center.y + Math.sin(drag.angle) * halfLength;
  }

  function rotationHandle(item) {
    if (!item || (item.type !== "circle" && item.type !== "arrow" && item.type !== "text")) return null;
    const cx = item.type === "text" ? item.x : (item.x1 + item.x2) / 2;
    const cy = item.type === "text" ? item.y : (item.y1 + item.y2) / 2;
    let knob;
    if (item.type === "circle" || item.type === "text") {
      const box = boundsFor(item);
      knob = { x: cx, y: box.y - screenSize(30) };
    } else {
      knob = { x: cx, y: cy - screenSize(36) };
    }
    const margin = Math.min(screenSize(12), canvas.width / 2, canvas.height / 2);
    return {
      anchor: { x: cx, y: cy },
      knob: {
        x: Math.max(margin, Math.min(canvas.width - margin, knob.x)),
        y: Math.max(margin, Math.min(canvas.height - margin, knob.y)),
      },
    };
  }

  function rotationHandleAt(item, point, pointerType) {
    const handle = rotationHandle(item);
    if (!handle) return false;
    const radius = screenSize(pointerType === "mouse" ? 12 : 20);
    return Math.hypot(point.x - handle.knob.x, point.y - handle.knob.y) <= radius;
  }

  function render(includeSelection = true) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!photo) return;
    ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    state.annotations.forEach((item) => {
      if (item.type === "text") drawText(item);
      else if (item.type === "arrow") drawArrow(item);
      else if (item.type === "circle") drawCircle(item);
    });
    if (includeSelection && state.selected !== null && state.annotations[state.selected]) {
      const selectedItem = state.annotations[state.selected];
      const bounds = boundsFor(selectedItem);
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, canvas.width / 900);
      ctx.setLineDash([8, 6]);
      if (selectedItem.type === "circle" || selectedItem.type === "text") {
        const cx = selectedItem.type === "text" ? selectedItem.x : bounds.x + bounds.w / 2;
        const cy = selectedItem.type === "text" ? selectedItem.y : bounds.y + bounds.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(selectedItem.rotation || 0);
        ctx.translate(-cx, -cy);
      }
      ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      if (selectedItem.type === "circle" || selectedItem.type === "text") {
        ctx.restore();
      }
      if (selectedItem.type === "circle") {
        const handleSize = screenSize(8);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#151715";
        ctx.lineWidth = screenSize(1);
        for (const handle of circleHandles(selectedItem)) {
          ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        }
      }
      if (selectedItem.type === "arrow") {
        const cx = (selectedItem.x1 + selectedItem.x2) / 2;
        const cy = (selectedItem.y1 + selectedItem.y2) / 2;
        const handleRadius = Math.max(7, canvas.width / 180);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#151715";
        ctx.lineWidth = Math.max(2, canvas.width / 1100);
        const resizeSize = screenSize(8);
        for (const handle of arrowResizeHandles(selectedItem)) {
          ctx.fillRect(handle.x - resizeSize / 2, handle.y - resizeSize / 2, resizeSize, resizeSize);
          ctx.strokeRect(handle.x - resizeSize / 2, handle.y - resizeSize / 2, resizeSize, resizeSize);
        }
        for (const [x, y] of [[selectedItem.x1, selectedItem.y1], [selectedItem.x2, selectedItem.y2]]) {
          ctx.beginPath(); ctx.arc(x, y, handleRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = "#d65a4a";
        ctx.beginPath(); ctx.arc(cx, cy, handleRadius * .65, 0, Math.PI * 2); ctx.fill();
      }
      const rotate = rotationHandle(selectedItem);
      if (rotate) {
        const radius = screenSize(8);
        const handleGrey = getComputedStyle(canvas).getPropertyValue("--phrond-text-subtle").trim() || "#87978a";
        ctx.setLineDash([screenSize(2), screenSize(3)]);
        ctx.lineWidth = screenSize(1.2);
        ctx.strokeStyle = handleGrey;
        ctx.beginPath();
        ctx.moveTo(rotate.anchor.x, rotate.anchor.y);
        ctx.lineTo(rotate.knob.x, rotate.knob.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = handleGrey;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(rotate.knob.x, rotate.knob.y, radius, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = screenSize(1.5);
        const iconRadius = radius * .48;
        const endAngle = Math.PI * 1.15;
        ctx.beginPath();
        ctx.arc(rotate.knob.x, rotate.knob.y, iconRadius, -.8, endAngle);
        const tipX = rotate.knob.x + Math.cos(endAngle) * iconRadius;
        const tipY = rotate.knob.y + Math.sin(endAngle) * iconRadius;
        const wing = radius * .32;
        const tangentX = -Math.sin(endAngle);
        const tangentY = Math.cos(endAngle);
        const normalX = Math.cos(endAngle);
        const normalY = Math.sin(endAngle);
        ctx.moveTo(tipX - tangentX * wing + normalX * wing * .55, tipY - tangentY * wing + normalY * wing * .55);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - tangentX * wing - normalX * wing * .55, tipY - tangentY * wing - normalY * wing * .55);
        ctx.stroke();
      }
      ctx.restore();
    }
    updateActions();
  }

  function hitTest(point) {
    let circleInterior = null;
    for (let index = state.annotations.length - 1; index >= 0; index -= 1) {
      const item = state.annotations[index];
      const bounds = boundsFor(item);
      const local = item.type === "circle" ? rotatePoint(point, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, -(item.rotation || 0))
        : item.type === "text" ? rotatePoint(point, item.x, item.y, -(item.rotation || 0)) : point;
      if (local.x < bounds.x || local.x > bounds.x + bounds.w || local.y < bounds.y || local.y > bounds.y + bounds.h) continue;
      if (item.type === "circle") {
        const rx = bounds.w / 2;
        const ry = bounds.h / 2;
        const nx = (local.x - bounds.x - rx) / rx;
        const ny = (local.y - bounds.y - ry) / ry;
        const radius = Math.hypot(nx, ny);
        if (Math.abs(radius - 1) * Math.min(rx, ry) <= screenSize(12)) return index;
        if (radius < 1 && circleInterior === null) circleInterior = index;
      } else if (item.type === "arrow") {
        const points = arrowWorldPoints(item);
        let inside = false;
        for (let edge = 0, previous = points.length - 1; edge < points.length; previous = edge, edge += 1) {
          const a = points[edge];
          const b = points[previous];
          if ((a.y > point.y) !== (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        if (inside) return index;
        const vx = item.x2 - item.x1;
        const vy = item.y2 - item.y1;
        const fraction = Math.max(0, Math.min(1, ((point.x - item.x1) * vx + (point.y - item.y1) * vy) / (vx * vx + vy * vy || 1)));
        const distance = Math.hypot(point.x - item.x1 - vx * fraction, point.y - item.y1 - vy * fraction);
        if (distance <= Math.max(screenSize(12), scaledSize(item.lineWeight ?? state.arrowLineWeight) / 2)) return index;
      } else {
        return index;
      }
    }
    return circleInterior;
  }

  function moveItem(item, dx, dy) {
    if (item.type === "text") { item.x += dx; item.y += dy; }
    else { item.x1 += dx; item.x2 += dx; item.y1 += dy; item.y2 += dy; }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!photo || pointer) return;
    const point = pointFromEvent(event);
    canvas.setPointerCapture(event.pointerId);
    const current = state.selected === null ? null : state.annotations[state.selected];
    const rotateHandle = rotationHandleAt(current, point, event.pointerType);
    const circleHandle = circleHandleAt(current, point);
    const arrowResizeHandle = arrowResizeHandleAt(current, point, event.pointerType);
    const arrowHandle = arrowHandleAt(current, point);
    const targetIndex = rotateHandle || circleHandle || arrowResizeHandle || arrowHandle ? state.selected : hitTest(point);
    const target = targetIndex === null ? null : state.annotations[targetIndex];
    if ((rotateHandle || arrowHandle || event.shiftKey) && (target?.type === "circle" || target?.type === "arrow" || target?.type === "text")) {
      selectAnnotation(targetIndex);
      const cx = target.type === "text" ? target.x : (target.x1 + target.x2) / 2;
      const cy = target.type === "text" ? target.y : (target.y1 + target.y2) / 2;
      const distance = Math.hypot(point.x - cx, point.y - cy);
      pointer = { id: event.pointerId, kind: "edit", mode: "rotate-item", start: point, last: point,
        lastAngle: distance >= screenSize(20) ? Math.atan2(point.y - cy, point.x - cx) : null,
        deadZone: screenSize(20), turn: 0, rotation: target.rotation || 0,
        center: { x: cx, y: cy }, endpoints: { x1: target.x1, y1: target.y1, x2: target.x2, y2: target.y2 },
        before: cloneAnnotations(), moved: false };
      canvas.style.cursor = "grabbing";
      render(); saveState();
      return;
    }
    if (circleHandle) {
      selectAnnotation(state.selected);
      pointer = { id: event.pointerId, kind: "edit", mode: "resize-circle", handle: circleHandle, box: boundsFor(current), rotation: current.rotation || 0, start: point, before: cloneAnnotations(), moved: false };
      return;
    }
    if (arrowResizeHandle) {
      selectAnnotation(state.selected);
      pointer = { id: event.pointerId, kind: "edit", mode: "resize-arrow", start: point,
        center: { x: (current.x1 + current.x2) / 2, y: (current.y1 + current.y2) / 2 },
        angle: Math.atan2(current.y2 - current.y1, current.x2 - current.x1),
        values: { pointLength: current.pointLength ?? state.arrowPointLength, lineLength: current.lineLength ?? state.arrowLineLength,
          headWidth: current.headWidth ?? state.arrowHeadWidth, lineWeight: current.lineWeight ?? state.arrowLineWeight,
          borderWidth: current.borderWidth ?? state.strokeWidth },
        before: cloneAnnotations(), moved: false };
      return;
    }
    const index = hitTest(point);
    selectAnnotation(index);
    pointer = index === null ? null : { id: event.pointerId, kind: "edit", last: point, before: cloneAnnotations(), moved: false, mode: "move" };
    render(); saveState();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = pointFromEvent(event);
    if (pointer && event.pointerId !== pointer.id) return;
    if (pointer?.mode === "rotate-item") {
      const rect = canvas.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        pointer.outside = true;
        return;
      }
      if (pointer.outside) {
        pointer.last = point;
        const distance = Math.hypot(point.x - pointer.center.x, point.y - pointer.center.y);
        pointer.lastAngle = distance >= pointer.deadZone
          ? Math.atan2(point.y - pointer.center.y, point.x - pointer.center.x) : null;
        pointer.outside = false;
        return;
      }
    }
    if (!pointer) {
      const current = state.selected === null ? null : state.annotations[state.selected];
      const rotateHandle = rotationHandleAt(current, point, event.pointerType);
      const handle = circleHandleAt(current, point) || arrowResizeHandleAt(current, point, event.pointerType);
      const cursors = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
      const arrowHandle = arrowHandleAt(current, point);
      const index = rotateHandle || handle || arrowHandle ? state.selected : hitTest(point);
      const target = state.annotations[index];
      canvas.style.cursor = (rotateHandle || arrowHandle || event.shiftKey) && (target?.type === "circle" || target?.type === "arrow" || target?.type === "text") ? "grab" : handle ? cursors[handle] : index !== null ? "move" : "";
      return;
    }
    if (pointer.kind === "edit" && state.selected !== null) {
      const item = state.annotations[state.selected];
      const dx = point.x - (pointer.last?.x ?? pointer.start.x);
      const dy = point.y - (pointer.last?.y ?? pointer.start.y);
      if (pointer.mode !== "rotate-item" && Math.abs(dx) + Math.abs(dy) > .2) pointer.moved = true;
      if (pointer.mode === "rotate-item") {
        const cx = pointer.center.x;
        const cy = pointer.center.y;
        const radius = Math.hypot(point.x - cx, point.y - cy);
        const segmentLengthSquared = dx * dx + dy * dy;
        const fraction = segmentLengthSquared
          ? Math.max(0, Math.min(1, ((cx - pointer.last.x) * dx + (cy - pointer.last.y) * dy) / segmentLengthSquared)) : 0;
        const nearestX = pointer.last.x + fraction * dx;
        const nearestY = pointer.last.y + fraction * dy;
        if (radius < pointer.deadZone || Math.hypot(nearestX - cx, nearestY - cy) < pointer.deadZone) {
          pointer.lastAngle = null;
        } else {
          const angle = Math.atan2(point.y - cy, point.x - cx);
          if (pointer.lastAngle !== null) {
            let delta = angle - pointer.lastAngle;
            if (delta > Math.PI) delta -= Math.PI * 2;
            if (delta < -Math.PI) delta += Math.PI * 2;
            pointer.turn += delta;
            if (Math.abs(delta) > .0001) pointer.moved = true;
          }
          pointer.lastAngle = angle;
        }
        if (item.type === "circle" || item.type === "text") {
          item.rotation = pointer.rotation + pointer.turn;
        } else if (item.type === "arrow") {
          const tail = rotatePoint({ x: pointer.endpoints.x1, y: pointer.endpoints.y1 }, pointer.center.x, pointer.center.y, pointer.turn);
          const head = rotatePoint({ x: pointer.endpoints.x2, y: pointer.endpoints.y2 }, pointer.center.x, pointer.center.y, pointer.turn);
          item.x1 = tail.x; item.y1 = tail.y;
          item.x2 = head.x; item.y2 = head.y;
        }
      } else if (pointer.mode === "resize-circle") {
        resizeCircle(item, pointer, point);
      } else if (pointer.mode === "resize-arrow") {
        resizeArrow(item, pointer, point);
      } else {
        moveItem(item, dx, dy);
      }
      pointer.last = point;
    }
    render();
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.moved) pushHistory(pointer.before);
    pointer = null; canvas.style.cursor = ""; saveState(); render();
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    state.annotations = pointer.before;
    if (state.selected !== null && state.annotations[state.selected]) selectAnnotation(state.selected);
    pointer = null; canvas.style.cursor = ""; saveState(); render();
  });

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneAnnotations());
    state.annotations = undoStack.pop();
    state.selected = null;
    saveState(); render(); updateActions();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneAnnotations());
    state.annotations = redoStack.pop();
    state.selected = null;
    saveState(); render(); updateActions();
  }

  function applySelected(mutator, type = null) {
    const item = state.selected === null ? null : state.annotations[state.selected];
    if (!item || (type && item.type !== type)) return false;
    const before = cloneAnnotations();
    mutator(item);
    pushHistory(before); saveState(); render();
    return true;
  }

  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => {
    const tool = button.dataset.tool;
    setTool(tool);
    if (tool !== "select") createAnnotation(tool);
    if (tool === "text") textInput.focus();
  }));
  document.querySelectorAll("[data-circle-style]").forEach((button) => button.addEventListener("click", () => { state.circleStyle = button.dataset.circleStyle; selectStyle("[data-circle-style]", state.circleStyle, "circleStyle"); applySelected((item) => { item.style = state.circleStyle; }, "circle"); saveState(); }));

  for (const input of [textInput, textFont, textAlign, textBold, textItalic, textOutline]) {
    input.addEventListener("change", () => {
      applySelected((item) => Object.assign(item, textConfig()), "text");
      saveState();
    });
  }
  textInput.addEventListener("input", () => { const item = state.selected === null ? null : state.annotations[state.selected]; if (item?.type === "text") { item.text = textInput.value; saveState(); render(); } });
  textSizeInput.addEventListener("input", () => {
    state.textSize = Math.max(2, Math.min(18, Number(textSizeInput.value) || 2));
    const item = state.selected === null ? null : state.annotations[state.selected];
    if (item?.type === "text") { item.size = state.textSize; render(); }
    saveState();
  });
  strokeWidthInput.addEventListener("input", () => {
    state.strokeWidth = Number(strokeWidthInput.value);
    strokeWidthOutput.value = state.strokeWidth;
    const item = state.selected === null ? null : state.annotations[state.selected];
    if (item?.type === "text") item.borderWidth = state.strokeWidth;
    if (item?.type === "arrow") item.borderWidth = state.strokeWidth;
    if (item?.type === "circle") item.strokeWidth = state.strokeWidth;
    if (item) render();
    saveState();
  });
  strokeWidthOutput.addEventListener("change", () => {
    const value = strokeWidthOutput.valueAsNumber;
    strokeWidthInput.value = Number.isFinite(value)
      ? Math.max(Number(strokeWidthInput.min), Math.min(Number(strokeWidthInput.max), Math.round(value)))
      : state.strokeWidth;
    strokeWidthInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  Object.entries(arrowControls).forEach(([key, input]) => input.addEventListener("input", () => {
    const stateKey = `arrow${key[0].toUpperCase()}${key.slice(1)}`;
    const value = Number(input.value);
    state[stateKey] = value;
    input.nextElementSibling.value = value;
    const item = state.selected === null ? null : state.annotations[state.selected];
    if (item?.type === "arrow") {
      item[key] = value;
      if (key === "pointLength" || key === "lineLength") normalizeArrowEndpoints(item);
      render();
    }
    saveState();
  }));
  Object.values(arrowControls).forEach((input) => input.nextElementSibling.addEventListener("change", (event) => {
    const value = event.target.valueAsNumber;
    input.value = Number.isFinite(value)
      ? Math.max(Number(input.min), Math.min(Number(input.max), Math.round(value)))
      : input.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }));

  photoInput.addEventListener("change", () => { const file = photoInput.files?.[0]; if (file) loadBlob(file, file.name); photoInput.value = ""; });
  for (const eventName of ["dragenter", "dragover"]) stage.addEventListener(eventName, (event) => { event.preventDefault(); stage.classList.add("is-dragging"); });
  for (const eventName of ["dragleave", "drop"]) stage.addEventListener(eventName, (event) => { event.preventDefault(); stage.classList.remove("is-dragging"); });
  stage.addEventListener("drop", (event) => { const file = [...event.dataTransfer.files].find((entry) => entry.type.startsWith("image/")); if (file) loadBlob(file, file.name); else announce("Drop an image file here."); });

  deleteButton.addEventListener("click", () => {
    if (state.selected === null) return;
    const before = cloneAnnotations(); state.annotations.splice(state.selected, 1); state.selected = null;
    pushHistory(before); saveState(); render(); announce("Annotation deleted.");
  });
  document.querySelector('[data-action="clear"]').addEventListener("click", () => {
    if (!state.annotations.length) return;
    const before = cloneAnnotations(); state.annotations = []; state.selected = null;
    pushHistory(before); saveState(); render(); announce("All annotations cleared. Undo is available.");
  });
  document.querySelectorAll('[data-action="undo"]').forEach((button) => button.addEventListener("click", undo));
  document.querySelectorAll('[data-action="redo"]').forEach((button) => button.addEventListener("click", redo));
  document.querySelector('[data-action="new"]').addEventListener("click", async () => {
    photo = null; state.annotations = []; state.selected = null; state.photoName = ""; undoStack = []; redoStack = [];
    emptyState.hidden = false; canvasWrap.hidden = true; exportButton.disabled = true; metaNode.textContent = "No photo loaded";
    await deleteStoredPhoto(); saveState(); updateActions(); photoInput.click();
  });
  exportButton.addEventListener("click", () => {
    if (!photo) return;
    render(false);
    canvas.toBlob((blob) => {
      if (!blob) { announce("The image could not be saved."); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const base = (state.photoName || "annotated-photo").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-");
      link.href = url; link.download = `${base}-annotated.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce("Annotated PNG saved to your computer."); render();
    }, "image/png");
  });

  const colorDialog = document.getElementById("color-dialog");
  const colorDialogTitle = document.getElementById("color-dialog-title");
  const hueInput = colorDialog.querySelector("[data-color-hue]");
  const surface = colorDialog.querySelector("[data-color-surface]");
  const thumb = colorDialog.querySelector("[data-color-thumb]");
  const hexInput = colorDialog.querySelector("[data-color-hex]");
  let picker = { h: 3, s: 81, v: 94 };
  let activeColorKey = "arrowFill";

  function hexToHsv(hex) {
    const number = parseInt(hex.slice(1), 16);
    const r = ((number >> 16) & 255) / 255, g = ((number >> 8) & 255) / 255, b = (number & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) { if (max === r) h = 60 * (((g - b) / delta) % 6); else if (max === g) h = 60 * ((b - r) / delta + 2); else h = 60 * ((r - g) / delta + 4); }
    return { h: (h + 360) % 360, s: max ? delta / max * 100 : 0, v: max * 100 };
  }

  function hsvToHex({ h, s, v }) {
    s /= 100; v /= 100;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let rgb = [c, x, 0];
    if (h >= 60 && h < 120) rgb = [x, c, 0]; else if (h < 180 && h >= 120) rgb = [0, c, x]; else if (h < 240 && h >= 180) rgb = [0, x, c]; else if (h < 300 && h >= 240) rgb = [x, 0, c]; else if (h >= 300) rgb = [c, 0, x];
    return `#${rgb.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function updatePicker(updateHex = true) {
    surface.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${picker.h} 100% 50%))`;
    thumb.style.left = `${picker.s}%`; thumb.style.top = `${100 - picker.v}%`; hueInput.value = picker.h;
    if (updateHex) hexInput.value = hsvToHex(picker).toUpperCase();
  }

  function setColor(hex, updateSelected = true) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    state[activeColorKey] = hex.toLowerCase();
    colorButtons[activeColorKey].value = state[activeColorKey];
    const item = state.selected === null ? null : state.annotations[state.selected];
    if (updateSelected && item) {
      if (item.type === "circle" && activeColorKey === "arrowFill") item.color = state.arrowFill;
      if (item.type === "arrow" && (activeColorKey === "arrowFill" || activeColorKey === "arrowBorder")) item[activeColorKey] = state[activeColorKey];
      if (item.type === "text" && (activeColorKey === "textFill" || activeColorKey === "textBorder")) item[activeColorKey] = state[activeColorKey];
    }
    saveState(); render();
  }

  colorTriggers.forEach((trigger) => trigger.addEventListener("click", () => {
    activeColorKey = trigger.dataset.colorKey;
    colorDialogTitle.textContent = `Edit ${trigger.dataset.colorLabel.toLowerCase()} color`;
    picker = hexToHsv(state[activeColorKey]);
    updatePicker();
    colorDialog.showModal();
  }));
  hueInput.addEventListener("input", () => { picker.h = Number(hueInput.value); updatePicker(); setColor(hsvToHex(picker)); });
  function pickSurface(event) {
    const rect = surface.getBoundingClientRect();
    picker.s = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    picker.v = Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100));
    updatePicker(); setColor(hsvToHex(picker));
  }
  surface.addEventListener("pointerdown", (event) => { surface.setPointerCapture(event.pointerId); pickSurface(event); });
  surface.addEventListener("pointermove", (event) => { if (surface.hasPointerCapture(event.pointerId)) pickSurface(event); });
  hexInput.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(hexInput.value)) { picker = hexToHsv(hexInput.value); updatePicker(false); setColor(hexInput.value); } });
  colorDialog.querySelectorAll("[data-color-close]").forEach((button) => button.addEventListener("click", () => colorDialog.close()));

  document.addEventListener("keydown", (event) => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (editing) return;
    const keyTools = { v: "select", t: "text", a: "arrow", c: "circle" };
    if (keyTools[event.key.toLowerCase()]) {
      const tool = keyTools[event.key.toLowerCase()];
      setTool(tool);
      if (tool !== "select") createAnnotation(tool);
    }
    if ((event.key === "Backspace" || event.key === "Delete") && state.selected !== null) { event.preventDefault(); deleteButton.click(); }
  });

  restoreState();
  if (state.selected !== null && state.annotations[state.selected]) selectAnnotation(state.selected);
  syncControls();
  readStoredPhoto().then((blob) => { if (blob) loadBlob(blob, state.photoName, false); });
})();
