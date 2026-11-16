const REVIEW_DECK_URL = "test-raven/Corvus_corax/species.json";
const REVIEW_FOLDER = "test-raven/Corvus_corax/";
const REVIEW_APP = document.querySelector("#review-app");
let globalViewerControlsBound = false;

const reviewState = {
  species: null,
  recordings: [],
  images: [],
  index: 0,
  timeZoom: 1,
  frequencyZoom: 1,
  timePan: 0.5,
  frequencyPan: 0.5,
  dragging: null,
  palette: "original",
  playbackFrame: 0,
  dictionaryMode: false,
  dictionaryArchive: null,
  dictionaryEntries: [],
  speciesIndex: 0,
  assetLoadVersion: 0
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function localFile(fileName) {
  return new URL(`${REVIEW_FOLDER}${encodeURIComponent(fileName)}`, window.location.href).href;
}

function secondsFromLength(length) {
  const parts = String(length || "").split(":").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatTime(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }
  return `${seconds.toFixed(1)}s`;
}

function renderShell() {
  const taxon = reviewState.species.taxonomy || {};
  const displayName = reviewState.species.commonName || taxon.vernacularName || (reviewState.dictionaryMode ? "Species name unavailable" : "Common Raven");
  const scientificName = reviewState.species.scientificName || "";
  const categoryNavigation = reviewState.dictionaryMode
    ? `<div class="species-navigation">
        <button id="previous-species" class="nav-button" type="button" aria-label="Previous species">← Species</button>
        <span id="species-position"></span>
        <button id="next-species" class="nav-button" type="button" aria-label="Next species">Species →</button>
      </div>`
    : "";
  REVIEW_APP.innerHTML = `
    <section class="deck-heading">
      <div>
        <div class="deck-kicker">${reviewState.dictionaryMode ? "DOWNLOADED WILDLIFE DICTIONARY" : "SPECIES REFERENCE · FIELDNOTES PROTOTYPE"}</div>
        <h1>${escapeHtml(displayName)} ${scientificName ? `<em>(${escapeHtml(scientificName)})</em>` : ""}</h1>
        <p>${escapeHtml([taxon.class, taxon.order, taxon.family].filter(Boolean).join(" · ")) || "Species reference"} · Listen to each clip and compare its spectrogram.</p>
      </div>
      <div class="species-heading-actions">
        ${categoryNavigation}
        <div class="sample-count"><strong id="sample-total"></strong><br>${reviewState.dictionaryMode ? "recordings" : "reference recordings"}</div>
      </div>
    </section>
    ${reviewState.dictionaryMode ? "" : `<p class="test-warning"><strong>Workflow test only:</strong> these are randomly selected worldwide Raven recordings, not a Sierra Nevada-specific dictionary or local recordings.</p>`}
    <section class="viewer-card" aria-label="Audio and spectrogram viewer">
      <div class="viewer-toolbar">
        <div class="clip-title"><strong id="clip-heading"></strong><span id="clip-subheading"></span></div>
        <div class="transport">
          <button id="previous-sample" class="nav-button" type="button" aria-label="Previous recording">←</button>
          <audio id="clip-audio" controls preload="metadata"></audio>
          <button id="next-sample" class="nav-button" type="button" aria-label="Next recording">Next →</button>
        </div>
        <div id="clip-meta" class="clip-meta"></div>
      </div>
      <div class="overview-wrap">
        <div class="overview-label"><span>FULL CLIP · CLICK TO JUMP IN TIME</span><span id="overview-range"></span></div>
        <canvas id="overview-canvas" aria-label="Full recording spectrogram overview"></canvas>
      </div>
      <div class="detail-wrap">
        <div class="spectrogram-toolbar">
          <label for="spectrogram-palette">Colour palette</label>
          <select id="spectrogram-palette">
            <option value="original">Original</option>
            <option value="grayscale">Grayscale</option>
            <option value="inferno">Inferno</option>
            <option value="viridis">Viridis</option>
            <option value="blue">Blue</option>
          </select>
        </div>
        <div class="axis-label" id="time-axis-labels"></div>
        <div class="plot-row">
          <div class="frequency-axis" aria-label="Relative frequency">
            <span>Frequency</span><span>High</span><span>Low</span>
          </div>
          <canvas id="spectrogram-canvas" aria-label="Zoomable spectrogram"></canvas>
        </div>
        <div class="time-axis" id="time-axis"></div>
      </div>
      <div class="zoom-controls">
        <div class="zoom-axis">
          <strong>TIME</strong>
          <button class="icon-button" id="time-out" type="button" aria-label="Zoom out in time">−</button>
          <input id="time-zoom" type="range" min="1" max="12" step="0.1" value="1" aria-label="Time zoom">
          <button class="icon-button" id="time-in" type="button" aria-label="Zoom in in time">+</button>
        </div>
        <div class="zoom-axis">
          <strong>FREQUENCY</strong>
          <button class="icon-button" id="frequency-out" type="button" aria-label="Zoom out in frequency">−</button>
          <input id="frequency-zoom" type="range" min="1" max="8" step="0.1" value="1" aria-label="Frequency zoom">
          <button class="icon-button" id="frequency-in" type="button" aria-label="Zoom in in frequency">+</button>
        </div>
        <button id="reset-zoom" class="reset-button" type="button">Reset zoom</button>
      </div>
      <p class="viewer-hint">The playhead follows audio playback and seeking. Spectrogram colours can be changed above; the source PNG has no calibrated Hz scale, so frequency is relative. Pan with the overview or by dragging.</p>
    </section>
    <section class="sample-browser" aria-labelledby="sample-browser-title">
      <div class="sample-browser-heading"><h2 id="sample-browser-title">Recording samples</h2><span>Swipe up/down on the spectrogram or scroll sideways</span></div>
      <div id="sample-strip" class="sample-strip" role="list"></div>
    </section>
    <p class="keyboard-hint">${reviewState.dictionaryMode ? "Use the species buttons above to move between species." : "Keyboard: ↓ next · ↑ previous · ← / → move between samples · Space play / pause · +/- zoom time"}</p>`;

  document.querySelector("#sample-total").textContent = String(reviewState.recordings.length);
  if (reviewState.dictionaryMode) {
    document.querySelector("#species-position").textContent =
      `Species ${reviewState.speciesIndex + 1} of ${reviewState.dictionaryEntries.length}`;
    document.querySelector("#previous-species").disabled = reviewState.speciesIndex === 0;
    document.querySelector("#next-species").disabled = reviewState.speciesIndex === reviewState.dictionaryEntries.length - 1;
    document.querySelector("#sample-browser-title").textContent = `${displayName} recordings`;
  } else {
    document.querySelector("#sample-browser-title").textContent = "Raven recording samples";
  }
  if (!reviewState.recordings.length) {
    document.querySelector(".viewer-hint").textContent = "No recordings were included for this species in the ZIP archive.";
  }
  renderSampleStrip();
  bindViewerControls();
  if (reviewState.recordings.length) showRecording(reviewState.index);
}

function renderSampleStrip() {
  const strip = document.querySelector("#sample-strip");
  strip.innerHTML = reviewState.recordings.map((recording, index) => {
    const duration = recording.length || "length unavailable";
    const location = [recording.locality, recording.country].filter(Boolean).join(", ");
    const thumbnail = reviewState.images[index];
    const thumbnailMarkup = reviewState.dictionaryMode
      ? `<span class="sample-card-placeholder">XC${escapeHtml(recording.id)}</span>`
      : `<img src="${escapeHtml(thumbnail.src)}" alt="" loading="lazy">`;
    return `<button class="sample-card" type="button" role="listitem" data-index="${index}" aria-current="false">
      ${thumbnailMarkup}
      <strong>XC${escapeHtml(recording.id)} · ${escapeHtml(duration)}</strong>
      <span>${escapeHtml(location || recording.recordist || "Location unavailable")}</span>
    </button>`;
  }).join("");
  strip.querySelectorAll(".sample-card").forEach((button) => {
    button.addEventListener("click", () => showRecording(Number(button.dataset.index)));
  });
}

function bindViewerControls() {
  const timeZoom = document.querySelector("#time-zoom");
  const frequencyZoom = document.querySelector("#frequency-zoom");
  document.querySelector("#spectrogram-palette").addEventListener("change", (event) => {
    reviewState.palette = event.target.value;
    renderSpectrogram();
  });
  timeZoom.addEventListener("input", () => {
    reviewState.timeZoom = Number(timeZoom.value);
    renderSpectrogram();
  });
  frequencyZoom.addEventListener("input", () => {
    reviewState.frequencyZoom = Number(frequencyZoom.value);
    renderSpectrogram();
  });
  document.querySelector("#time-in").addEventListener("click", () => stepZoom("time", 1));
  document.querySelector("#time-out").addEventListener("click", () => stepZoom("time", -1));
  document.querySelector("#frequency-in").addEventListener("click", () => stepZoom("frequency", 1));
  document.querySelector("#frequency-out").addEventListener("click", () => stepZoom("frequency", -1));
  document.querySelector("#reset-zoom").addEventListener("click", resetZoom);
  document.querySelector("#previous-sample").addEventListener("click", () => showRecording(reviewState.index - 1));
  document.querySelector("#next-sample").addEventListener("click", () => showRecording(reviewState.index + 1));
  if (reviewState.dictionaryMode) {
    document.querySelector("#previous-species").addEventListener("click", () => showDictionarySpecies(reviewState.speciesIndex - 1));
    document.querySelector("#next-species").addEventListener("click", () => showDictionarySpecies(reviewState.speciesIndex + 1));
  }
  document.querySelector("#overview-canvas").addEventListener("pointerdown", (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setTimePan(fraction);
  });
  const canvas = document.querySelector("#spectrogram-canvas");
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    reviewState.dragging = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timePan: reviewState.timePan,
      frequencyPan: reviewState.frequencyPan
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const drag = reviewState.dragging;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = canvas.getBoundingClientRect();
    const timeSpan = visibleTimeSpan();
    const frequencySpan = visibleFrequencySpan();
    if (timeSpan < 1) {
      reviewState.timePan = clampPan(drag.timePan - (event.clientX - drag.x) / (bounds.width * (1 - timeSpan)));
    }
    if (frequencySpan < 1) {
      reviewState.frequencyPan = clampPan(drag.frequencyPan - (event.clientY - drag.y) / (bounds.height * (1 - frequencySpan)));
    }
    renderSpectrogram();
  });
  const endDrag = () => { reviewState.dragging = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  const audio = document.querySelector("#clip-audio");
  audio.addEventListener("error", () => {
    const status = document.querySelector("#clip-subheading");
    status.textContent = "Audio could not be played from this dictionary.";
    status.classList.add("audio-error");
  });
  audio.addEventListener("timeupdate", renderSpectrogram);
  audio.addEventListener("seeking", renderSpectrogram);
  audio.addEventListener("seeked", renderSpectrogram);
  audio.addEventListener("play", startPlaybackRefresh);
  audio.addEventListener("pause", stopPlaybackRefresh);
  audio.addEventListener("loadedmetadata", renderSpectrogram);
  audio.addEventListener("ended", () => {
    stopPlaybackRefresh();
    renderSpectrogram();
  });
  if (!globalViewerControlsBound) {
    window.addEventListener("resize", renderSpectrogram);
    document.addEventListener("keydown", handleKeyboard);
    globalViewerControlsBound = true;
  }
  let touchStart = null;
  canvas.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const deltaY = touch.clientY - touchStart.y;
    const deltaX = touch.clientX - touchStart.x;
    if (Math.abs(deltaY) > 55 && Math.abs(deltaY) > Math.abs(deltaX)) {
      showRecording(reviewState.index + (deltaY < 0 ? 1 : -1));
    }
    touchStart = null;
  }, { passive: true });
}

function handleKeyboard(event) {
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "BUTTON", "AUDIO"].includes(target.tagName))) return;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    event.preventDefault();
    showRecording(reviewState.index + 1);
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    event.preventDefault();
    showRecording(reviewState.index - 1);
  } else if (event.code === "Space") {
    event.preventDefault();
    const audio = document.querySelector("#clip-audio");
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  } else if (event.key === "+" || event.key === "=") {
    stepZoom("time", 1);
  } else if (event.key === "-") {
    stepZoom("time", -1);
  }
}

function stepZoom(axis, direction) {
  if (axis === "time") {
    reviewState.timeZoom = clamp(reviewState.timeZoom * (direction > 0 ? 1.5 : 1 / 1.5), 1, 12);
    document.querySelector("#time-zoom").value = String(reviewState.timeZoom);
  } else {
    reviewState.frequencyZoom = clamp(reviewState.frequencyZoom * (direction > 0 ? 1.5 : 1 / 1.5), 1, 8);
    document.querySelector("#frequency-zoom").value = String(reviewState.frequencyZoom);
  }
  renderSpectrogram();
}

function resetZoom() {
  reviewState.timeZoom = 1;
  reviewState.frequencyZoom = 1;
  reviewState.timePan = 0.5;
  reviewState.frequencyPan = 0.5;
  document.querySelector("#time-zoom").value = "1";
  document.querySelector("#frequency-zoom").value = "1";
  renderSpectrogram();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampPan(pan) {
  return clamp(pan, 0, 1);
}

function visibleTimeSpan() {
  return 1 / reviewState.timeZoom;
}

function visibleFrequencySpan() {
  return 1 / reviewState.frequencyZoom;
}

function setTimePan(center) {
  const span = visibleTimeSpan();
  reviewState.timePan = span >= 1 ? 0 : clamp((center - span / 2) / (1 - span), 0, 1);
  renderSpectrogram();
}

function revokeImageAssets(image) {
  if (!image) return;
  if (image.audioUrl) URL.revokeObjectURL(image.audioUrl);
  if (image.spectrogramUrl) URL.revokeObjectURL(image.spectrogramUrl);
  image.audioUrl = "";
  image.spectrogramUrl = "";
  image.spectrogram = null;
  image.displayCanvas = null;
}

async function loadArchiveAsset(path) {
  const file = path && reviewState.dictionaryArchive?.file(path);
  if (!file) return "";
  return URL.createObjectURL(await file.async("blob"));
}

function drawSpectrogramMessage(message) {
  for (const canvas of [document.querySelector("#spectrogram-canvas"), document.querySelector("#overview-canvas")]) {
    const size = resizeCanvas(canvas);
    if (!size) continue;
    size.context.clearRect(0, 0, size.width, size.height);
    size.context.fillStyle = "#ffb2a7";
    size.context.font = "13px Segoe UI, sans-serif";
    size.context.fillText(message, 12, 24);
  }
}

async function showRecording(index) {
  if (index < 0 || index >= reviewState.recordings.length) return;
  const loadVersion = ++reviewState.assetLoadVersion;
  const audio = document.querySelector("#clip-audio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  revokeImageAssets(reviewState.images[reviewState.index]);
  reviewState.index = index;
  if (reviewState.dictionaryMode && embeddedViewer) {
    window.parent.postMessage({
      type: "fieldnotes-viewer-position",
      speciesIndex: reviewState.speciesIndex,
      recordingIndex: index
    }, window.location.origin);
  }
  reviewState.frequencyZoom = 1;
  reviewState.timePan = 0;
  reviewState.frequencyPan = 0.5;
  const recording = reviewState.recordings[index];
  const subheading = document.querySelector("#clip-subheading");
  document.querySelector("#clip-heading").textContent = `XC${recording.id} · ${recording.length || "duration unavailable"}`;
  subheading.classList.remove("audio-error");
  subheading.textContent = `${recording.recordist || "Recordist unknown"} · ${recording.quality ? `quality ${recording.quality}` : "quality unavailable"}`;
  const source = recording.sourcePage || `https://xeno-canto.org/${recording.id}`;
  const license = recording.license ? ` · <a href="${escapeHtml(recording.license)}" target="_blank" rel="noreferrer">License</a>` : "";
  document.querySelector("#clip-meta").innerHTML = `${escapeHtml([recording.locality, recording.country, recording.date].filter(Boolean).join(" · "))}<br><a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Xeno-canto source ↗</a>${license}`;
  document.querySelector("#previous-sample").disabled = index === 0;
  document.querySelector("#next-sample").disabled = index === reviewState.recordings.length - 1;
  document.querySelectorAll(".sample-card").forEach((button) => {
    button.setAttribute("aria-current", String(Number(button.dataset.index) === index));
  });
  document.querySelector(".sample-card[aria-current='true']")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  const image = reviewState.images[index];
  const spectrogram = new Image();
  image.spectrogram = spectrogram;
  spectrogram.onload = () => {
    if (reviewState.index === index && loadVersion === reviewState.assetLoadVersion) {
      const canvas = document.querySelector("#spectrogram-canvas");
      const canvasWidth = canvas.clientWidth || 900;
      const canvasHeight = canvas.clientHeight || 360;
      const frequencyHeight = Math.max(1, spectrogram.naturalHeight - Math.max(22, Math.round(spectrogram.naturalHeight * 0.06)));
      reviewState.timeZoom = clamp(
        spectrogram.naturalWidth / (canvasWidth * frequencyHeight / canvasHeight),
        1,
        12
      );
      reviewState.timePan = 0;
      document.querySelector("#time-zoom").value = String(reviewState.timeZoom);
      renderSpectrogram();
    }
  };
  spectrogram.onerror = () => {
    if (loadVersion === reviewState.assetLoadVersion) drawSpectrogramMessage("Spectrogram image could not be loaded.");
  };
  document.querySelector("#time-zoom").value = String(reviewState.timeZoom);
  document.querySelector("#frequency-zoom").value = String(reviewState.frequencyZoom);
  renderSpectrogram();
  if (reviewState.dictionaryMode) {
    try {
      const [audioUrl, spectrogramUrl] = await Promise.all([
        loadArchiveAsset(recording.audioArchivePath),
        loadArchiveAsset(recording.spectrogramArchivePath)
      ]);
      if (loadVersion !== reviewState.assetLoadVersion) {
        URL.revokeObjectURL(audioUrl);
        URL.revokeObjectURL(spectrogramUrl);
        return;
      }
      image.audioUrl = audioUrl;
      image.spectrogramUrl = spectrogramUrl;
      if (audioUrl) {
        audio.src = audioUrl;
        audio.load();
      }
      if (spectrogramUrl) spectrogram.src = spectrogramUrl;
      else drawSpectrogramMessage("No spectrogram was included for this recording.");
    } catch (error) {
      if (loadVersion !== reviewState.assetLoadVersion) return;
      subheading.textContent = error instanceof Error ? error.message : "Could not read recording files from the ZIP.";
      subheading.classList.add("audio-error");
      drawSpectrogramMessage("Could not read spectrogram from the ZIP.");
    }
  } else {
    audio.src = localFile(recording.audioFile);
    audio.load();
    spectrogram.src = localFile(recording.spectrogramFile);
  }
}

function renderSpectrogram() {
  const recording = reviewState.recordings[reviewState.index];
  const imageData = reviewState.images[reviewState.index];
  const sourceImage = imageData?.spectrogram;
  if (!recording) return;
  if (!sourceImage?.complete || !sourceImage.naturalWidth) {
    if (reviewState.dictionaryMode && !sourceImage) drawSpectrogramMessage("Loading spectrogram…");
    return;
  }
  const image = getDisplayImage(imageData);
  if (!image) return;
  renderCanvas(document.querySelector("#spectrogram-canvas"), image, true);
  renderCanvas(document.querySelector("#overview-canvas"), image, false);
  renderAxes(recording);
}

const PALETTE_STOPS = {
  grayscale: [[0, 0, 0], [255, 255, 255]],
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [252, 193, 38], [252, 255, 164]],
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]],
  blue: [[3, 8, 24], [8, 32, 83], [13, 75, 145], [34, 128, 190], [105, 190, 220], [224, 248, 255]]
};

function makePaletteLut(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let value = 0; value < 256; value += 1) {
    const position = value / 255 * (stops.length - 1);
    const start = Math.floor(position);
    const end = Math.min(stops.length - 1, start + 1);
    const fraction = position - start;
    for (let channel = 0; channel < 3; channel += 1) {
      lut[value * 3 + channel] = Math.round(
        stops[start][channel] + (stops[end][channel] - stops[start][channel]) * fraction
      );
    }
  }
  return lut;
}

function getDisplayImage(imageData) {
  const source = imageData.spectrogram;
  if (reviewState.palette === "original") return source;
  if (imageData.displayCanvas && imageData.displayPalette === reviewState.palette) {
    return imageData.displayCanvas;
  }
  const scale = Math.min(1, 4000 / source.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const lut = makePaletteLut(PALETTE_STOPS[reviewState.palette]);
  const { data } = pixels;
  for (let offset = 0; offset < data.length; offset += 4) {
    const intensity = Math.round(data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722);
    data[offset] = lut[intensity * 3];
    data[offset + 1] = lut[intensity * 3 + 1];
    data[offset + 2] = lut[intensity * 3 + 2];
  }
  context.putImageData(pixels, 0, 0);
  imageData.displayCanvas = canvas;
  imageData.displayPalette = reviewState.palette;
  return canvas;
}

function startPlaybackRefresh() {
  if (reviewState.playbackFrame) return;
  const refresh = () => {
    const audio = document.querySelector("#clip-audio");
    renderSpectrogram();
    if (audio && !audio.paused && !audio.ended) {
      reviewState.playbackFrame = window.requestAnimationFrame(refresh);
    } else {
      reviewState.playbackFrame = 0;
    }
  };
  reviewState.playbackFrame = window.requestAnimationFrame(refresh);
}

function stopPlaybackRefresh() {
  if (!reviewState.playbackFrame) return;
  window.cancelAnimationFrame(reviewState.playbackFrame);
  reviewState.playbackFrame = 0;
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function renderCanvas(canvas, image, detail) {
  const size = resizeCanvas(canvas);
  if (!size) return;
  const { context, width, height } = size;
  context.clearRect(0, 0, width, height);
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const frequencyHeight = Math.max(1, imageHeight - Math.max(22, Math.round(imageHeight * 0.06)));
  if (!detail) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    context.drawImage(image, 0, 0, imageWidth, frequencyHeight, 0, 0, width, height);
    const visibleWidth = width * visibleTimeSpan();
    const startX = width * (1 - visibleTimeSpan()) * reviewState.timePan;
    context.fillStyle = "rgba(131, 185, 154, .14)";
    context.fillRect(startX, 0, visibleWidth, height);
    context.strokeStyle = "#83b99a";
    context.lineWidth = 1;
    context.strokeRect(startX + 0.5, 0.5, Math.max(1, visibleWidth - 1), height - 1);
    drawPlaybackCursor(context, width, height, false);
    return;
  }
  const sourceWidth = imageWidth / reviewState.timeZoom;
  const sourceHeight = frequencyHeight / reviewState.frequencyZoom;
  const sourceX = (imageWidth - sourceWidth) * reviewState.timePan;
  const sourceY = (frequencyHeight - sourceHeight) * reviewState.frequencyPan;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  drawPlaybackCursor(context, width, height, true);
}

function drawPlaybackCursor(context, width, height, detail) {
  const audio = document.querySelector("#clip-audio");
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const fraction = clamp(audio.currentTime / audio.duration, 0, 1);
  let x = fraction * width;
  if (detail) {
    const visibleSpan = visibleTimeSpan();
    const visibleStart = (1 - visibleSpan) * reviewState.timePan;
    if (fraction < visibleStart || fraction > visibleStart + visibleSpan) return;
    x = (fraction - visibleStart) / visibleSpan * width;
  }
  context.save();
  context.strokeStyle = "#fff";
  context.lineWidth = 2;
  context.shadowColor = "#00d5ff";
  context.shadowBlur = 7;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
  context.restore();
}

function renderAxes(recording) {
  const duration = secondsFromLength(recording.length);
  const start = duration * (1 - visibleTimeSpan()) * reviewState.timePan;
  const end = start + duration * visibleTimeSpan();
  const ticks = Array.from({ length: 6 }, (_, index) => {
    const time = start + (end - start) * index / 5;
    return `<span>${duration ? formatTime(time) : `${Math.round(index * 20)}%`}</span>`;
  }).join("");
  document.querySelector("#time-axis-labels").innerHTML = ticks;
  document.querySelector("#time-axis").innerHTML = `<span>${duration ? formatTime(start) : "0%"}</span><span>${duration ? formatTime(end) : "100%"}</span>`;
  document.querySelector("#overview-range").textContent = `${Math.round(visibleTimeSpan() * 100)}% time · ${reviewState.frequencyZoom.toFixed(1)}× frequency`;
}

async function loadDeck() {
  try {
    const response = await fetch(REVIEW_DECK_URL);
    if (!response.ok) throw new Error(`Could not load Raven sample metadata (HTTP ${response.status}).`);
    reviewState.species = await response.json();
    const availableRecordings = reviewState.species.recordings || [];
    reviewState.recordings = availableRecordings.filter((recording) =>
      recording.audioFile && recording.spectrogramFile
    );
    if (!reviewState.recordings.length) {
      throw new Error("No recordings with both an audio file and spectrogram were found in the Raven sample folder.");
    }
    reviewState.images = reviewState.recordings.map(() => ({ spectrogram: null, src: "" }));
    renderShell();
    reviewState.recordings.forEach((recording, index) => {
      const thumbnail = new Image();
      thumbnail.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(320 / thumbnail.naturalWidth, 56 / thumbnail.naturalHeight);
        canvas.width = Math.max(1, Math.round(thumbnail.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(thumbnail.naturalHeight * ratio));
        canvas.getContext("2d").drawImage(thumbnail, 0, 0, canvas.width, canvas.height);
        reviewState.images[index].src = canvas.toDataURL("image/png");
        const cardImage = document.querySelector(`.sample-card[data-index="${index}"] img`);
        if (cardImage) cardImage.src = reviewState.images[index].src;
      };
      thumbnail.src = localFile(recording.spectrogramFile);
    });
  } catch (error) {
    REVIEW_APP.innerHTML = `<div class="error-state">${escapeHtml(error instanceof Error ? error.message : "Could not load the sample deck.")}<br><br>Open this page through the local server from the project folder.</div>`;
  }
}

async function loadDictionaryArchive(archiveBlob, position = null) {
  try {
    if (!window.JSZip) throw new Error("The ZIP library did not load. Refresh the app and try again.");
    const archive = await window.JSZip.loadAsync(archiveBlob);
    const speciesPaths = Object.keys(archive.files).filter((path) =>
      /^species\/[^/]+\/species\.json$/i.test(path) && !archive.files[path].dir
    );
    if (!speciesPaths.length) throw new Error("This ZIP contains no species metadata. Choose a Fieldnotes dictionary ZIP.");

    const entries = await Promise.all(speciesPaths.map(async (path) => {
      const file = archive.file(path);
      const species = JSON.parse(await file.async("string"));
      const speciesFolder = path.slice(0, path.lastIndexOf("/"));
      const resolveArchivePath = (assetPath) => {
        if (!assetPath) return "";
        const normalizedPath = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
        const candidates = [normalizedPath, `${speciesFolder}/${normalizedPath}`];
        return candidates.find((candidate) => Boolean(archive.file(candidate))) || "";
      };
      return {
        ...species,
        recordings: Array.isArray(species.recordings)
          ? species.recordings.map((recording) => ({
            ...recording,
            audioArchivePath: resolveArchivePath(recording.audioArchivePath),
            spectrogramArchivePath: resolveArchivePath(recording.spectrogramArchivePath)
          })).filter((recording) => recording.audioArchivePath || recording.spectrogramArchivePath)
          : []
      };
    }));
    entries.sort((left, right) => {
      const bandOrder = { common: 0, rare: 1 };
      const bandDifference = (bandOrder[left.occurrenceBand] ?? 2) - (bandOrder[right.occurrenceBand] ?? 2);
      if (bandDifference) return bandDifference;
      const observationDifference = (right.gbifObservations || 0) - (left.gbifObservations || 0);
      return observationDifference || String(left.commonName || left.scientificName).localeCompare(String(right.commonName || right.scientificName));
    });

    for (const image of reviewState.images) revokeImageAssets(image);
    reviewState.dictionaryArchive = archive;
    reviewState.dictionaryMode = true;
    reviewState.dictionaryEntries = entries;
    const speciesIndex = Number.isInteger(position?.speciesIndex)
      ? clamp(position.speciesIndex, 0, entries.length - 1)
      : 0;
    const speciesRecordingCount = entries[speciesIndex].recordings.length;
    const recordingIndex = speciesRecordingCount && Number.isInteger(position?.recordingIndex)
      ? clamp(position.recordingIndex, 0, speciesRecordingCount - 1)
      : 0;
    showDictionarySpecies(speciesIndex, recordingIndex);
    const recordingCount = entries.reduce((total, entry) =>
      total + entry.recordings.filter((recording) => recording.audioArchivePath && recording.spectrogramArchivePath).length, 0);
    window.parent.postMessage({
      type: "fieldnotes-viewer-loaded",
      speciesCount: entries.length,
      recordingCount
    }, window.location.origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the dictionary ZIP.";
    REVIEW_APP.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
    window.parent.postMessage({ type: "fieldnotes-viewer-error", message }, window.location.origin);
  }
}

function showDictionarySpecies(index, recordingIndex = 0) {
  if (index < 0 || index >= reviewState.dictionaryEntries.length) return;
  reviewState.assetLoadVersion += 1;
  const audio = document.querySelector("#clip-audio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  for (const image of reviewState.images) revokeImageAssets(image);
  const species = reviewState.dictionaryEntries[index];
  reviewState.speciesIndex = index;
  reviewState.species = species;
  reviewState.recordings = species.recordings;
  reviewState.images = reviewState.recordings.map(() => ({ spectrogram: null, src: "" }));
  reviewState.index = species.recordings.length
    ? clamp(recordingIndex, 0, species.recordings.length - 1)
    : 0;
  renderShell();
}

const embeddedViewer = new URLSearchParams(window.location.search).has("embedded");
if (embeddedViewer) {
  document.body.classList.add("embedded");
  REVIEW_APP.innerHTML = '<div class="loading-state">Waiting for the dictionary ZIP from Fieldnotes…</div>';
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === "fieldnotes-load-dictionary" && event.data.archive instanceof Blob) {
      loadDictionaryArchive(event.data.archive, event.data.position);
    }
  });
  window.parent.postMessage({ type: "fieldnotes-viewer-ready" }, window.location.origin);
} else {
  loadDeck();
}
