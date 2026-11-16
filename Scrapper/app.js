const groups = [
  { id: "birds", title: "Birds", icon: "♧", taxa: [212], xenoGroups: ["birds"], audio: true },
  { id: "mammals", title: "Mammals", icon: "⌁", taxa: [359], xenoGroups: ["land mammals", "bats"] },
  { id: "amphibians", title: "Amphibians", icon: "≈", taxa: [131], xenoGroups: ["frogs"] },
  { id: "reptiles", title: "Reptiles", icon: "⌇", taxa: [358] },
  { id: "insects", title: "Insects", icon: "✳", taxa: [216], xenoGroups: ["grasshoppers"] },
  { id: "fish", title: "Fish", icon: "⌁", taxa: [204] },
  { id: "other-invertebrates", title: "Other invertebrates", icon: "✧", taxa: [367, 52, 42] }
];

const elements = {
  placeTab: document.querySelector("#place-tab"),
  coordinatesTab: document.querySelector("#coordinates-tab"),
  placeForm: document.querySelector("#place-form"),
  coordinatesForm: document.querySelector("#coordinates-form"),
  placeInput: document.querySelector("#place-input"),
  placeResults: document.querySelector("#place-results"),
  projectSelect: document.querySelector("#saved-projects"),
  loadProject: document.querySelector("#load-project"),
  deleteProject: document.querySelector("#delete-project"),
  saveProjectForm: document.querySelector("#save-project-form"),
  projectName: document.querySelector("#project-name"),
  saveProject: document.querySelector("#save-project"),
  projectStatus: document.querySelector("#project-status"),
  latitudeInput: document.querySelector("#latitude-input"),
  longitudeInput: document.querySelector("#longitude-input"),
  locationError: document.querySelector("#location-error"),
  locationConfirmation: document.querySelector("#location-confirmation"),
  confirmedPlace: document.querySelector("#confirmed-place"),
  confirmedCoordinates: document.querySelector("#confirmed-coordinates"),
  radius: document.querySelector("#radius-select"),
  searchSpecies: document.querySelector("#search-species"),
  results: document.querySelector("#results-section"),
  resultsPlace: document.querySelector("#results-place"),
  resultsStatus: document.querySelector("#results-status"),
  overviewRadius: document.querySelector("#overview-radius"),
  overviewStats: document.querySelector("#overview-stats"),
  overviewRows: document.querySelector("#overview-rows"),
  speciesGroups: document.querySelector("#species-groups"),
  dictionary: document.querySelector("#dictionary-workflow"),
  dictionaryDescription: document.querySelector("#dictionary-description"),
  dictionaryStatus: document.querySelector("#dictionary-status"),
  dictionarySpecies: document.querySelector("#dictionary-species"),
  dictionaryPreview: document.querySelector("#dictionary-preview"),
  openDownloadedDictionary: document.querySelector("#open-downloaded-dictionary"),
  openDownloadedDictionaryHome: document.querySelector("#open-downloaded-dictionary-home"),
  dictionaryZipFile: document.querySelector("#dictionary-zip-file"),
  dictionaryRecoveryStatus: document.querySelector("#dictionary-recovery-status"),
  resumeLastDictionary: document.querySelector("#resume-last-dictionary"),
  forgetLastDictionary: document.querySelector("#forget-last-dictionary"),
  viewGeneratedDictionary: document.querySelector("#view-generated-dictionary"),
  dictionaryViewer: document.querySelector("#dictionary-viewer"),
  dictionaryViewerStatus: document.querySelector("#dictionary-viewer-status"),
  dictionaryViewerFrame: document.querySelector("#dictionary-viewer-frame"),
  previewSummary: document.querySelector("#preview-summary"),
  previewRecordings: document.querySelector("#preview-recordings"),
  downloadProgress: document.querySelector("#download-progress"),
  selectionCount: document.querySelector("#selection-count"),
  samplesPerSpecies: document.querySelector("#samples-per-species"),
  buildDictionary: document.querySelector("#build-dictionary"),
  mapLink: document.querySelector("#open-map-link"),
  xenoKey: document.querySelector("#xeno-key"),
  apiKeyStatus: document.querySelector("#api-key-status"),
  forgetApiKey: document.querySelector("#forget-api-key"),
  mapReset: document.querySelector("#center-india")
};

let selectedLocation = null;
let currentSearch = null;
let savedProjects = [];
let searchVersion = 0;
let map;
let locationMarker;
let studyAreaCircle;
let reverseLookupTimer;
let reverseLookupController;
let activeDictionaryGroup = null;
let dictionarySpecies = [];
let dictionaryVersion = 0;
let dictionarySelectionTouched = false;
let generatedDictionaryArchive = null;
let pendingDictionaryArchive = null;
let dictionaryViewerReady = false;
let pendingDictionaryRecoveryArchive = null;
let dictionaryRecoveryDatabasePromise = null;
let lastDictionaryArchiveRecord = null;
let activeDictionaryArchive = null;
let pendingDictionaryPosition = null;

const INDIA_CENTER = [22.9734, 78.6569];
const PROJECTS_STORAGE_KEY = "fieldnotes.saved-projects.v1";
const XENO_KEY_STORAGE_KEY = "fieldnotes.xeno-canto-api-key.v1";
const DICTIONARY_RECOVERY_DATABASE = "fieldnotes.dictionary-recovery.v1";
const DICTIONARY_POSITION_STORAGE_KEY = "fieldnotes.dictionary-position.v1";

function setProjectStatus(message, isError = false) {
  elements.projectStatus.textContent = message;
  elements.projectStatus.classList.toggle("is-error", isError);
}

function setDictionaryRecoveryStatus(message, isError = false) {
  elements.dictionaryRecoveryStatus.textContent = message;
  elements.dictionaryRecoveryStatus.classList.toggle("is-error", isError);
}

function openDictionaryRecoveryDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("This browser does not support local dictionary recovery."));
  if (!dictionaryRecoveryDatabasePromise) {
    dictionaryRecoveryDatabasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DICTIONARY_RECOVERY_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("archives", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
      request.onblocked = () => reject(new Error("Browser storage is busy in another tab. Close other Fieldnotes tabs and try again."));
      request.onsuccess = () => resolve(request.result);
    }).catch((error) => {
      dictionaryRecoveryDatabasePromise = null;
      throw error;
    });
  }
  return dictionaryRecoveryDatabasePromise;
}

async function readLastDictionaryArchive() {
  const database = await openDictionaryRecoveryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("archives", "readonly");
    const request = transaction.objectStore("archives").get("latest");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read the saved dictionary."));
  });
}

async function saveLastDictionaryArchive(archive) {
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    const available = estimate.quota - estimate.usage;
    if (Number.isFinite(available) && archive.size > available) {
      throw new Error(`Not enough browser storage for this ${formatBytes(archive.size)} ZIP.`);
    }
  }
  const database = await openDictionaryRecoveryDatabase();
  const record = {
    id: "latest",
    name: archive.name || "dictionary.zip",
    size: archive.size,
    lastModified: archive.lastModified || Date.now(),
    blob: archive
  };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("archives", "readwrite");
    transaction.objectStore("archives").put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save the dictionary in this browser."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage could not save the dictionary."));
  });
  lastDictionaryArchiveRecord = record;
  renderDictionaryRecovery(record);
}

async function deleteLastDictionaryArchive() {
  const database = await openDictionaryRecoveryDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("archives", "readwrite");
    transaction.objectStore("archives").delete("latest");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not remove the saved dictionary."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage could not remove the dictionary."));
  });
  lastDictionaryArchiveRecord = null;
  renderDictionaryRecovery(null);
}

function renderDictionaryRecovery(record) {
  lastDictionaryArchiveRecord = record;
  elements.resumeLastDictionary.disabled = !record;
  elements.forgetLastDictionary.classList.toggle("is-hidden", !record);
  if (record) {
    setDictionaryRecoveryStatus(`${record.name} · ${formatBytes(record.size)} saved in this browser.`);
  } else {
    setDictionaryRecoveryStatus("Open a downloaded ZIP once to make it available here next time.");
  }
}

function getDictionaryArchiveIdentity(archive) {
  return {
    name: archive.name || "dictionary.zip",
    size: Number(archive.size) || 0,
    lastModified: Number(archive.lastModified) || 0
  };
}

function readDictionaryPosition(archive) {
  try {
    const stored = localStorage.getItem(DICTIONARY_POSITION_STORAGE_KEY);
    if (!stored) return null;
    const position = JSON.parse(stored);
    const identity = getDictionaryArchiveIdentity(archive);
    if (position.name !== identity.name || position.size !== identity.size || position.lastModified !== identity.lastModified) return null;
    if (!Number.isInteger(position.speciesIndex) || !Number.isInteger(position.recordingIndex)) return null;
    return { speciesIndex: position.speciesIndex, recordingIndex: position.recordingIndex };
  } catch (error) {
    setDictionaryRecoveryStatus(
      error instanceof Error ? `Could not restore the last viewing position: ${error.message}` : "Could not restore the last viewing position.",
      true
    );
    return null;
  }
}

async function initializeDictionaryRecovery() {
  try {
    const record = await readLastDictionaryArchive();
    renderDictionaryRecovery(record);
  } catch (error) {
    setDictionaryRecoveryStatus(
      error instanceof Error ? `Saved dictionary recovery is unavailable: ${error.message}` : "Saved dictionary recovery is unavailable.",
      true
    );
  }
}

function renderProjectOptions(selectedId = "") {
  elements.projectSelect.replaceChildren();
  if (!savedProjects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved projects yet";
    elements.projectSelect.append(option);
  } else {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a saved project…";
    elements.projectSelect.append(placeholder);
    for (const project of savedProjects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      elements.projectSelect.append(option);
    }
    elements.projectSelect.value = selectedId;
  }
  const hasSelection = Boolean(elements.projectSelect.value);
  elements.loadProject.disabled = !hasSelection;
  elements.deleteProject.disabled = !hasSelection;
}

function loadSavedProjects() {
  try {
    const stored = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!stored) {
      savedProjects = [];
    } else {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) throw new Error("Saved project data is invalid.");
      savedProjects = parsed.filter(isSavedProject);
      if (savedProjects.length !== parsed.length) {
        setProjectStatus("Some saved project data was invalid and could not be loaded.", true);
      }
    }
    renderProjectOptions();
    if (savedProjects.length) {
      setProjectStatus(`${savedProjects.length} saved project${savedProjects.length === 1 ? "" : "s"} available in this browser.`);
    }
  } catch (error) {
    savedProjects = [];
    renderProjectOptions();
    setProjectStatus(error instanceof Error ? error.message : "Could not load saved projects.", true);
  }
}

function isSavedProject(project) {
  return Boolean(
    project &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    project.location &&
    typeof project.location.name === "string" &&
    Number.isFinite(project.location.latitude) &&
    Number.isFinite(project.location.longitude) &&
    Number.isFinite(project.radiusKm) &&
    (project.states === null || (
      project.states &&
      groups.every((group) => project.states[group.id] && Array.isArray(project.states[group.id].species))
    ))
  );
}

function persistSavedProjects() {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(savedProjects));
    return true;
  } catch (error) {
    setProjectStatus(error instanceof Error ? `Could not save this project: ${error.message}` : "Could not save this project.", true);
    return false;
  }
}

function loadApiKey() {
  try {
    const key = localStorage.getItem(XENO_KEY_STORAGE_KEY);
    if (key) {
      elements.xenoKey.value = key;
      elements.apiKeyStatus.textContent = "Saved in this browser only.";
      elements.apiKeyStatus.classList.remove("is-error");
    } else {
      elements.apiKeyStatus.textContent = "No saved key.";
    }
  } catch (error) {
    elements.apiKeyStatus.textContent = "Browser storage is unavailable; key won’t persist.";
    elements.apiKeyStatus.classList.add("is-error");
  }
}

loadSavedProjects();
loadApiKey();
initializeDictionaryRecovery();

function formatPhotonPlace(properties) {
  const locality = properties.city || properties.town || properties.village ||
    properties.county || properties.district || properties.state_district;
  const parts = [...new Set([
    properties.name,
    locality,
    properties.state,
    properties.country
  ].filter(Boolean))];
  return {
    name: properties.name || locality || properties.state || properties.country || "Selected place",
    display_name: parts.join(", ") || "Selected place"
  };
}

function initializeMap() {
  if (!window.L) {
    showLocationError("The map couldn't load. Check your internet connection, then refresh the page.");
    return;
  }
  map = L.map("location-map").setView(INDIA_CENTER, 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);
  map.on("click", (event) => {
    chooseMapLocation(event.latlng.lat, event.latlng.lng);
  });
  elements.mapReset.addEventListener("click", () => map.setView(INDIA_CENTER, 4));
  elements.radius.addEventListener("change", () => {
    updateStudyAreaCircle();
    if (studyAreaCircle) {
      map.fitBounds(studyAreaCircle.getBounds(), { padding: [22, 22], maxZoom: 12 });
    }
    if (currentSearch && currentSearch.radiusKm !== Number(elements.radius.value)) {
      currentSearch = null;
      updateSaveProjectAvailability();
      setProjectStatus("Search area changed. You can save the new radius now, or rerun wildlife search to refresh results.");
    }
  });
  window.setTimeout(() => map.invalidateSize(), 0);
}

function updateStudyAreaCircle() {
  if (!map || !selectedLocation) return;
  const center = [selectedLocation.latitude, selectedLocation.longitude];
  const radiusMeters = Number(elements.radius.value) * 1000;
  if (studyAreaCircle) {
    studyAreaCircle.setLatLng(center);
    studyAreaCircle.setRadius(radiusMeters);
  } else {
    studyAreaCircle = L.circle(center, {
      radius: radiusMeters,
      className: "study-area-circle",
      interactive: false
    }).addTo(map);
  }
}

function showLocationError(message) {
  elements.locationError.textContent = message;
  elements.locationError.classList.remove("is-hidden");
}

function clearLocationError() {
  elements.locationError.textContent = "";
  elements.locationError.classList.add("is-hidden");
}

function setLocation(location) {
  searchVersion += 1;
  selectedLocation = location;
  currentSearch = null;
  updateSaveProjectAvailability();
  elements.searchSpecies.disabled = false;
  elements.results.classList.add("is-hidden");
  clearLocationError();
  elements.confirmedPlace.textContent = location.name;
  elements.confirmedCoordinates.textContent =
    `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  elements.locationConfirmation.classList.remove("is-hidden");
  elements.placeResults.classList.add("is-hidden");
  setProjectStatus(elements.projectName.value.trim()
    ? "Location selected. Ready to save this search."
    : "Location selected. Enter a project name to enable saving.");
  if (map) {
    const position = [location.latitude, location.longitude];
    if (locationMarker) locationMarker.setLatLng(position);
    else {
      locationMarker = L.marker(position, { draggable: true }).addTo(map);
      locationMarker.on("dragend", () => {
        const markerPosition = locationMarker.getLatLng();
        chooseMapLocation(markerPosition.lat, markerPosition.lng, false);
      });
    }
    updateStudyAreaCircle();
    if (location.moveMap !== false) {
      map.setView(position, Math.max(map.getZoom(), 10));
      if (location.fitArea) {
        map.fitBounds(studyAreaCircle.getBounds(), { padding: [22, 22], maxZoom: 12 });
      }
    }
  }
  elements.latitudeInput.value = location.latitude;
  elements.longitudeInput.value = location.longitude;
}

function updateSaveProjectAvailability() {
  elements.saveProject.disabled = false;
}

function chooseMapLocation(latitude, longitude, moveMap = true) {
  setLocation({
    name: "Finding place name…",
    latitude,
    longitude,
    moveMap
  });
  scheduleReverseLookup(latitude, longitude);
}

function scheduleReverseLookup(latitude, longitude) {
  window.clearTimeout(reverseLookupTimer);
  if (reverseLookupController) reverseLookupController.abort();
  reverseLookupTimer = window.setTimeout(async () => {
    reverseLookupController = new AbortController();
    try {
      const url = new URL("https://photon.komoot.io/reverse");
      url.search = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        lang: "en"
      });
      const response = await fetch(url, { signal: reverseLookupController.signal });
      if (!response.ok) throw new Error(`Place lookup failed (${response.status}).`);
      const result = await response.json();
      if (selectedLocation?.latitude !== latitude || selectedLocation?.longitude !== longitude) return;
      const feature = result.features?.[0];
      if (feature) {
        const place = formatPhotonPlace(feature.properties);
        elements.confirmedPlace.textContent = place.display_name;
        selectedLocation.name = place.display_name;
      } else {
        elements.confirmedPlace.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        elements.confirmedPlace.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      }
    }
  }, 700);
}

function renderPlaceResults(places) {
  elements.placeResults.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "place-results-heading";
  heading.textContent = places.length === 1 ? "Select this place" : "Choose the matching place";
  elements.placeResults.append(heading);
  for (const place of places) {
    const button = document.createElement("button");
    button.className = "place-result";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = place.name || place.display_name;
    const details = document.createElement("span");
    details.textContent = place.display_name;
    button.append(title, details);
    button.addEventListener("click", () => {
      setLocation({
        name: place.display_name,
        latitude: Number(place.lat),
        longitude: Number(place.lon)
      });
    });
    elements.placeResults.append(button);
  }
  elements.placeResults.classList.remove("is-hidden");
}

function setInputMode(mode) {
  const placeMode = mode === "place";
  searchVersion += 1;
  selectedLocation = null;
  currentSearch = null;
  updateSaveProjectAvailability();
  elements.searchSpecies.disabled = false;
  elements.placeTab.classList.toggle("is-active", placeMode);
  elements.coordinatesTab.classList.toggle("is-active", !placeMode);
  elements.placeTab.setAttribute("aria-selected", String(placeMode));
  elements.coordinatesTab.setAttribute("aria-selected", String(!placeMode));
  elements.placeForm.classList.toggle("is-hidden", !placeMode);
  elements.coordinatesForm.classList.toggle("is-hidden", placeMode);
  elements.locationConfirmation.classList.add("is-hidden");
  elements.placeResults.classList.add("is-hidden");
  elements.results.classList.add("is-hidden");
  clearLocationError();
}

elements.placeTab.addEventListener("click", () => setInputMode("place"));
elements.coordinatesTab.addEventListener("click", () => setInputMode("coordinates"));
initializeMap();

elements.projectSelect.addEventListener("change", () => {
  const hasSelection = Boolean(elements.projectSelect.value);
  elements.loadProject.disabled = !hasSelection;
  elements.deleteProject.disabled = !hasSelection;
});

elements.loadProject.addEventListener("click", () => {
  const project = savedProjects.find((item) => item.id === elements.projectSelect.value);
  if (!project) return;
  elements.projectName.value = project.name;
  elements.radius.value = String(project.radiusKm);
  setLocation({ ...project.location, fitArea: true });
  currentSearch = project.states ? {
    location: { ...project.location },
    radiusKm: project.radiusKm,
    states: project.states
  } : null;
  if (project.states) {
    elements.results.classList.remove("is-hidden");
    elements.resultsPlace.textContent = project.location.name.split(",")[0];
    elements.resultsStatus.textContent = `Loaded saved project · last saved ${new Date(project.savedAt).toLocaleString("en-IN")}.`;
    elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${project.location.latitude}&mlon=${project.location.longitude}#map=10/${project.location.latitude}/${project.location.longitude}`;
    renderOverview(project.states, project.radiusKm);
    renderGroups(project.states);
  } else {
    elements.results.classList.add("is-hidden");
    setProjectStatus(`Loaded “${project.name}”. Click “Find nearby wildlife” to fetch its species list.`);
  }
  updateSaveProjectAvailability();
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.deleteProject.addEventListener("click", () => {
  const project = savedProjects.find((item) => item.id === elements.projectSelect.value);
  if (!project || !window.confirm(`Delete saved project “${project.name}”?`)) return;
  savedProjects = savedProjects.filter((item) => item.id !== project.id);
  if (!persistSavedProjects()) return;
  renderProjectOptions();
  setProjectStatus(`Deleted “${project.name}”.`);
});

elements.saveProjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedLocation) {
    setProjectStatus("First choose a place, or enter coordinates and click “Use coordinates”.");
    document.querySelector(".location-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const name = elements.projectName.value.trim();
  if (!name) {
    setProjectStatus("Enter a project name before saving.", true);
    elements.projectName.focus();
    return;
  }
  const existing = savedProjects.find((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing && !window.confirm(`A project named “${existing.name}” exists. Replace its saved search?`)) return;

  const searchHasFreshResults = currentSearch?.location.latitude === selectedLocation.latitude &&
    currentSearch?.location.longitude === selectedLocation.longitude &&
    currentSearch?.radiusKm === Number(elements.radius.value);
  const project = {
    id: existing?.id || crypto.randomUUID(),
    name,
    savedAt: new Date().toISOString(),
    location: { ...selectedLocation },
    radiusKm: Number(elements.radius.value),
    states: searchHasFreshResults ? currentSearch.states : null
  };
  savedProjects = [project, ...savedProjects.filter((item) => item.id !== project.id)];
  if (!persistSavedProjects()) return;
  renderProjectOptions(project.id);
  setProjectStatus(`Saved “${name}” in this browser. You can load it again from My projects.`);
});

elements.projectName.addEventListener("input", () => {
  updateSaveProjectAvailability();
  if (!selectedLocation) {
    setProjectStatus("Choose a place or click “Use coordinates” before saving.");
  } else if (!elements.projectName.value.trim()) {
    setProjectStatus("Enter a project name to enable saving.");
  } else {
    setProjectStatus("Ready to save this location and search radius.");
  }
});

elements.xenoKey.addEventListener("input", () => {
  const key = elements.xenoKey.value.trim();
  try {
    if (key) {
      localStorage.setItem(XENO_KEY_STORAGE_KEY, key);
      elements.apiKeyStatus.textContent = "Saved in this browser only.";
    } else {
      localStorage.removeItem(XENO_KEY_STORAGE_KEY);
      elements.apiKeyStatus.textContent = "No saved key.";
    }
    elements.apiKeyStatus.classList.remove("is-error");
  } catch (error) {
    elements.apiKeyStatus.textContent = "Could not save key in browser storage.";
    elements.apiKeyStatus.classList.add("is-error");
  }
});

elements.forgetApiKey.addEventListener("click", () => {
  try {
    localStorage.removeItem(XENO_KEY_STORAGE_KEY);
    elements.xenoKey.value = "";
    elements.apiKeyStatus.textContent = "Key forgotten.";
    elements.apiKeyStatus.classList.remove("is-error");
  } catch (error) {
    elements.apiKeyStatus.textContent = "Could not remove the saved key.";
    elements.apiKeyStatus.classList.add("is-error");
  }
});

document.querySelectorAll(".place-suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    setLocation({
      name: button.dataset.name,
      latitude: Number(button.dataset.latitude),
      longitude: Number(button.dataset.longitude)
    });
  });
});

elements.placeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  selectedLocation = null;
  const requestVersion = ++searchVersion;
  clearLocationError();
  elements.locationConfirmation.classList.add("is-hidden");
  elements.placeResults.classList.add("is-hidden");
  elements.results.classList.add("is-hidden");
  elements.searchSpecies.disabled = false;
  const query = elements.placeInput.value.trim();
  if (!query) return;

  const submitButton = elements.placeForm.querySelector("button");
  submitButton.disabled = true;
  submitButton.innerHTML = "Finding place…";
  try {
    const variants = [query];
    const simplified = query.replace(/\b(mountains?|mountain ranges?|ranges?|reserve|sanctuary)\b/gi, "").replace(/\s+/g, " ").trim();
    if (simplified && simplified.toLowerCase() !== query.toLowerCase()) variants.push(simplified);
    let places = [];
    for (const variant of variants) {
      const url = new URL("https://photon.komoot.io/api/");
      const mapCenter = map ? map.getCenter() : { lat: INDIA_CENTER[0], lng: INDIA_CENTER[1] };
      url.search = new URLSearchParams({
        q: variant,
        limit: "5",
        lat: String(mapCenter.lat),
        lon: String(mapCenter.lng),
        lang: "en"
      });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Place search failed (${response.status}). Please try again.`);
      const data = await response.json();
      places = (data.features || []).map((feature) => {
        const place = formatPhotonPlace(feature.properties);
        const [longitude, latitude] = feature.geometry.coordinates;
        return {
          ...place,
          lat: latitude,
          lon: longitude
        };
      });
      if (requestVersion !== searchVersion) return;
      if (places.length) break;
    }
    if (!places.length) {
      throw new Error("We couldn't find that place. Try a shorter name, add its state or country, or choose the location directly on the map.");
    }
    renderPlaceResults(places);
  } catch (error) {
    if (requestVersion === searchVersion) {
      const message = error instanceof TypeError
        ? "Place search is temporarily unavailable. You can still choose a point directly on the map or try again."
        : error instanceof Error ? error.message : "Place search failed. Please try again.";
      showLocationError(message);
    }
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Find this place <span aria-hidden="true">→</span>';
  }
});

elements.coordinatesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  selectedLocation = null;
  searchVersion += 1;
  clearLocationError();
  elements.locationConfirmation.classList.add("is-hidden");
  elements.placeResults.classList.add("is-hidden");
  elements.results.classList.add("is-hidden");
  elements.searchSpecies.disabled = false;
  const latitude = Number(elements.latitudeInput.value);
  const longitude = Number(elements.longitudeInput.value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    showLocationError("Enter a valid latitude (−90 to 90) and longitude (−180 to 180).");
    return;
  }
  setLocation({ name: "Selected coordinates", latitude, longitude });
  scheduleReverseLookup(latitude, longitude);
});

async function fetchSpeciesOccurrences(group, location, radiusKm) {
  const params = new URLSearchParams({
    geometry: makeSearchGeometry(location.latitude, location.longitude, radiusKm),
    facet: "speciesKey",
    facetLimit: "1000",
    facetMincount: "1",
    limit: "0"
  });
  const responses = await Promise.all(group.taxa.map(async (taxonKey) => {
    const url = `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxonKey}&${params}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GBIF request failed (${response.status}).`);
    const data = await response.json();
    return {
      totalRecords: data.count || 0,
      species: (data.facets?.[0]?.counts || []).map((item) => ({
        key: item.name,
        observations: item.count
      }))
    };
  }));
  const byKey = new Map();
  let totalRecords = 0;
  for (const response of responses) {
    totalRecords += response.totalRecords;
    for (const species of response.species) {
      const current = byKey.get(species.key);
      if (current) current.observations += species.observations;
      else byKey.set(species.key, species);
    }
  }
  const rankedSpecies = [...byKey.values()].sort((left, right) => right.observations - left.observations);
  const speciesRecords = rankedSpecies.reduce((sum, species) => sum + species.observations, 0);
  const occurrenceBands = getOccurrenceSpeciesBands(rankedSpecies);
  const summarizeBand = (species) => ({
    speciesCount: species.length,
    records: species.reduce((sum, item) => sum + item.observations, 0),
    averageRecords: species.length
      ? species.reduce((sum, item) => sum + item.observations, 0) / species.length
      : 0
  });
  const top20 = summarizeBand(occurrenceBands.common);
  const next50 = summarizeBand(occurrenceBands.rare);
  const topSpecies = [...byKey.values()]
    .sort((left, right) => right.observations - left.observations)
    .slice(0, 8);
  const details = await mapWithConcurrency(topSpecies, 4, async (species) => {
    const response = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(species.key)}`);
    if (!response.ok) throw new Error(`Species details request failed (${response.status}).`);
    const detail = await response.json();
    return {
      ...species,
      scientificName: detail.canonicalName || detail.scientificName || "Unknown species",
      commonName: detail.vernacularName || ""
    };
  });
  return {
    totalRecords,
    speciesCount: byKey.size,
    speciesRecords,
    top20,
    next50,
    species: details,
    speciesKeys: rankedSpecies
  };
}

function getOccurrenceSpeciesBands(species) {
  const ranked = [...species].sort((left, right) => right.observations - left.observations);
  const commonEnd = Math.ceil(ranked.length * 0.2);
  const rareEnd = Math.ceil(ranked.length * 0.7);
  return {
    common: ranked.slice(0, commonEnd),
    rare: ranked.slice(commonEnd, rareEnd),
    excluded: ranked.slice(rareEnd)
  };
}

function makeSearchGeometry(latitude, longitude, radiusKm) {
  const coordinates = [];
  const angularRadius = radiusKm / 6371.0088;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  for (let index = 0; index <= 64; index += 1) {
    const bearing = 2 * Math.PI * index / 64;
    const pointLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularRadius) +
      Math.cos(latitudeRadians) * Math.sin(angularRadius) * Math.cos(bearing)
    );
    const pointLongitude = longitudeRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latitudeRadians),
      Math.cos(angularRadius) - Math.sin(latitudeRadians) * Math.sin(pointLatitude)
    );
    coordinates.push(`${(pointLongitude * 180 / Math.PI).toFixed(5)} ${(pointLatitude * 180 / Math.PI).toFixed(5)}`);
  }
  return `POLYGON((${coordinates.join(",")}))`;
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function formatNumber(number) {
  return new Intl.NumberFormat("en-IN").format(number);
}

function speciesDisplayName(species) {
  return species.commonName || species.scientificName || (species.key ? `Species ${species.key}` : "Species name pending");
}

function makeXenoCantoQuery(scientificName, location, recordingGroup = "birds") {
  const [genus, species] = scientificName.trim().split(/\s+/, 2);
  if (!genus || !species) {
    throw new Error(`Cannot search Xeno-canto for an incomplete scientific name: ${scientificName}`);
  }
  const groupTag = recordingGroup.includes(" ")
    ? `grp:"${recordingGroup}"`
    : `grp:${recordingGroup}`;
  return `gen:"=${genus}" sp:"=${species}" ${groupTag} lat:${location.latitude} lon:${location.longitude}`;
}

function groupCard(group, state) {
  const header = `<div class="group-header">
    <span class="group-icon" aria-hidden="true">${group.icon}</span>
    <span class="group-title">${group.title}</span>
    <span class="group-count">${state.loading ? "Searching…" : state.error ? "Unavailable" : `${formatNumber(state.totalRecords)} records`}</span>
    <button class="group-open" type="button" data-group-id="${group.id}" ${state.loading || state.error || !state.species?.length ? "disabled" : ""}>Build dictionary <span aria-hidden="true">→</span></button>
  </div>`;
  if (state.loading) {
    return `<article id="species-group-${group.id}" class="species-group" aria-label="${group.title}">${header}<p class="empty-group">Checking nearby occurrence records…</p></article>`;
  }
  if (state.error) {
    return `<article id="species-group-${group.id}" class="species-group" aria-label="${group.title}">${header}<p class="empty-group group-error">${state.error}</p></article>`;
  }
  if (!state.species.length) {
    return `<article id="species-group-${group.id}" class="species-group" aria-label="${group.title}">${header}<p class="empty-group">No records found for this group in the selected area. Try a wider search area.</p></article>`;
  }
  const rows = state.species.map((species) => {
    const name = escapeHtml(speciesDisplayName(species));
    const scientificName = escapeHtml(species.scientificName);
    const commonName = species.commonName && species.commonName !== species.scientificName
      ? `<span class="scientific-name">${scientificName}</span>`
      : "";
    const soundControl = group.audio
      ? `<button class="audio-check" type="button" data-scientific-name="${escapeHtml(species.scientificName)}">Check audio</button>`
      : "";
    return `<li class="species-row">
      <span class="species-name"><span class="common-name">${name}</span>${commonName}</span>
      <span class="observation-count">${formatNumber(species.observations)}<small>observations</small></span>
      ${soundControl}
    </li>`;
  }).join("");
  return `<article id="species-group-${group.id}" class="species-group" aria-label="${group.title}">
    ${header}
    <ul class="species-list">${rows}</ul>
  </article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderGroups(states) {
  elements.speciesGroups.innerHTML = groups.map((group) => groupCard(group, states[group.id])).join("");
  elements.speciesGroups.querySelectorAll(".group-open").forEach((button) => {
    button.addEventListener("click", () => openDictionary(button.dataset.groupId));
  });
  elements.speciesGroups.querySelectorAll(".audio-check").forEach((button) => {
    button.addEventListener("click", () => checkBirdAudio(button));
  });
}

elements.dictionary.addEventListener("click", (event) => {
  if (event.target.closest("#close-dictionary")) {
    elements.dictionary.classList.add("is-hidden");
    elements.dictionaryPreview.classList.add("is-hidden");
  }
});
document.querySelector("#select-all-species").addEventListener("click", () => {
  dictionarySelectionTouched = true;
  dictionarySpecies.forEach((item) => {
    if (!item.loading && !item.error && item.recordingCount > 0) item.selected = true;
  });
  elements.dictionaryPreview.classList.add("is-hidden");
  renderDictionarySpecies();
});
document.querySelector("#select-common-species").addEventListener("click", () => {
  dictionarySelectionTouched = true;
  selectCommonSpecies();
  elements.dictionaryPreview.classList.add("is-hidden");
  renderDictionarySpecies();
});
document.querySelector("#select-no-species").addEventListener("click", () => {
  dictionarySelectionTouched = true;
  dictionarySpecies.forEach((item) => { item.selected = false; });
  elements.dictionaryPreview.classList.add("is-hidden");
  renderDictionarySpecies();
});
elements.samplesPerSpecies.addEventListener("input", updateDictionarySelectionCount);
elements.buildDictionary.addEventListener("click", buildDictionary);
elements.openDownloadedDictionary.addEventListener("click", () => elements.dictionaryZipFile.click());
elements.openDownloadedDictionaryHome.addEventListener("click", () => elements.dictionaryZipFile.click());
elements.dictionaryZipFile.addEventListener("change", () => {
  const archive = elements.dictionaryZipFile.files[0];
  elements.dictionaryZipFile.value = "";
  if (archive) {
    pendingDictionaryRecoveryArchive = archive;
    openDictionaryViewer(archive);
  }
});
elements.resumeLastDictionary.addEventListener("click", async () => {
  try {
    const record = lastDictionaryArchiveRecord || await readLastDictionaryArchive();
    if (!record?.blob) throw new Error("No saved dictionary ZIP was found in this browser.");
    lastDictionaryArchiveRecord = record;
    const archive = new File([record.blob], record.name, {
      type: "application/zip",
      lastModified: record.lastModified
    });
    openDictionaryViewer(archive, readDictionaryPosition(archive));
  } catch (error) {
    setDictionaryRecoveryStatus(
      error instanceof Error ? `Could not resume the saved dictionary: ${error.message}` : "Could not resume the saved dictionary.",
      true
    );
  }
});
elements.forgetLastDictionary.addEventListener("click", async () => {
  if (!window.confirm("Remove the saved dictionary ZIP from this browser? You can choose the file again later.")) return;
  try {
    await deleteLastDictionaryArchive();
  } catch (error) {
    setDictionaryRecoveryStatus(
      error instanceof Error ? `Could not remove the saved dictionary: ${error.message}` : "Could not remove the saved dictionary.",
      true
    );
  }
});
elements.viewGeneratedDictionary.addEventListener("click", () => {
  if (generatedDictionaryArchive) {
    pendingDictionaryRecoveryArchive = generatedDictionaryArchive;
    openDictionaryViewer(generatedDictionaryArchive);
  }
});
document.querySelector("#close-dictionary-viewer").addEventListener("click", () => {
  elements.dictionaryViewer.classList.add("is-hidden");
  elements.dictionaryViewerFrame.src = "about:blank";
  dictionaryViewerReady = false;
  pendingDictionaryArchive = null;
  pendingDictionaryPosition = null;
  pendingDictionaryRecoveryArchive = null;
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== elements.dictionaryViewerFrame.contentWindow) return;
  if (event.data?.type === "fieldnotes-viewer-ready") {
    dictionaryViewerReady = true;
    if (pendingDictionaryArchive) {
      elements.dictionaryViewerFrame.contentWindow.postMessage(
        { type: "fieldnotes-load-dictionary", archive: pendingDictionaryArchive, position: pendingDictionaryPosition },
        window.location.origin
      );
      pendingDictionaryArchive = null;
      pendingDictionaryPosition = null;
    }
  } else if (event.data?.type === "fieldnotes-viewer-loaded") {
    elements.dictionaryViewerStatus.textContent =
      `Loaded ${formatNumber(event.data.speciesCount)} species with ${formatNumber(event.data.recordingCount)} audio/spectrogram pairs.`;
    if (pendingDictionaryRecoveryArchive) {
      const archive = pendingDictionaryRecoveryArchive;
      pendingDictionaryRecoveryArchive = null;
      setDictionaryRecoveryStatus(`Saving ${archive.name || "dictionary ZIP"} for next time…`);
      saveLastDictionaryArchive(archive).catch((error) => {
        setDictionaryRecoveryStatus(
          error instanceof Error
            ? `Dictionary opened, but could not be saved for next time: ${error.message}`
            : "Dictionary opened, but could not be saved for next time.",
          true
        );
      });
    }
  } else if (event.data?.type === "fieldnotes-viewer-position") {
    if (activeDictionaryArchive && Number.isInteger(event.data.speciesIndex) && Number.isInteger(event.data.recordingIndex)) {
      try {
        localStorage.setItem(DICTIONARY_POSITION_STORAGE_KEY, JSON.stringify({
          ...getDictionaryArchiveIdentity(activeDictionaryArchive),
          speciesIndex: event.data.speciesIndex,
          recordingIndex: event.data.recordingIndex
        }));
      } catch (error) {
        setDictionaryRecoveryStatus(
          error instanceof Error ? `Dictionary is open, but its position could not be saved: ${error.message}` : "Dictionary is open, but its position could not be saved.",
          true
        );
      }
    }
  } else if (event.data?.type === "fieldnotes-viewer-error") {
    elements.dictionaryViewerStatus.textContent = event.data.message || "Could not open this dictionary ZIP.";
    if (pendingDictionaryRecoveryArchive) {
      pendingDictionaryRecoveryArchive = null;
      setDictionaryRecoveryStatus("This ZIP could not be opened and was not saved for recovery.", true);
    }
  }
});

function openDictionaryViewer(archive, position = readDictionaryPosition(archive)) {
  if (!window.JSZip) {
    elements.dictionaryViewerStatus.textContent = "The ZIP library did not load. Refresh the app and try again.";
    return;
  }
  activeDictionaryArchive = archive;
  pendingDictionaryPosition = position;
  pendingDictionaryArchive = archive;
  elements.dictionaryViewerStatus.textContent = `Opening ${archive.name || "dictionary ZIP"}…`;
  elements.dictionaryViewer.classList.remove("is-hidden");
  if (dictionaryViewerReady) {
    elements.dictionaryViewerFrame.contentWindow.postMessage(
      { type: "fieldnotes-load-dictionary", archive, position: pendingDictionaryPosition },
      window.location.origin
    );
    pendingDictionaryArchive = null;
    pendingDictionaryPosition = null;
  } else {
    elements.dictionaryViewerFrame.src = "reviewer.html?embedded=1&v=2";
  }
  elements.dictionaryViewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateDictionarySelectionCount() {
  const selected = dictionarySpecies.filter((item) => item.selected);
  const sampleCount = Math.max(1, Math.min(20, Number(elements.samplesPerSpecies.value) || 5));
  const totalAvailable = selected.reduce((total, item) => total + Math.min(item.recordingCount || 0, sampleCount), 0);
  const lengths = selected.flatMap((item) => item.recordings.map(recordingSeconds));
  const averageSeconds = lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 30;
  const estimatedBytes = Math.round(totalAvailable * averageSeconds * 16000);
  const estimatedSeconds = totalAvailable * 3 + selected.length * 2;
  elements.selectionCount.textContent = `${selected.length} selected · ${formatNumber(totalAvailable)} clips · ~${formatBytes(estimatedBytes)} · ${formatDuration(estimatedSeconds)}`;
  elements.buildDictionary.disabled = !selected.length || selected.some((item) => item.loading);
}

function renderDictionarySpecies() {
  const rows = dictionarySpecies.map((item, index) => {
    const disabled = item.loading || item.error || item.recordingCount === 0;
    const checked = item.selected && !disabled ? "checked" : "";
    const selectedName = escapeHtml(speciesDisplayName(item));
    const scientificName = escapeHtml(item.scientificName || "Scientific name unavailable");
    const audio = item.loading
      ? metric("…", "Checking recording availability")
      : item.error
        ? metric("!", item.error, true)
        : item.recordingCount > 0
          ? metric(`✓ ${formatNumber(item.recordingCount)}`, `${formatNumber(item.recordingCount)} audio recordings available`, false, true)
          : metric("—", "No matching audio recordings");
    const spectrograms = item.loading
      ? metric("…", "Checking spectrogram availability")
      : metric(item.hasSpectrogram ? "✓" : "—", item.hasSpectrogram ? "Spectrogram available" : "No spectrogram in sampled recordings", false, true);
    const image = item.infoLoading
      ? metric("…", "Checking image availability")
      : item.imageError
        ? metric("!", item.imageError, true)
        : metric(item.image ? "✓" : "—", item.image ? "Species image available" : "No species image found", false, true);
    const info = item.infoLoading
      ? metric("…", "Checking species information")
      : metric(item.taxonomy ? "✓" : "—", item.taxonomy ? "GBIF species information available" : "Species information unavailable", false, true);
    return `<label class="dictionary-species-row ${disabled ? "is-unavailable" : ""}">
      <input class="dictionary-species-checkbox" type="checkbox" data-index="${index}" ${checked} ${disabled ? "disabled" : ""}>
      <span class="species-name"><span class="common-name">${selectedName}</span><span class="scientific-name">${scientificName} · ${formatNumber(item.observations || 0)} GBIF records</span></span>
      <span class="dictionary-availability">${audio}</span>
      <span class="dictionary-availability">${spectrograms}</span>
      <span class="dictionary-availability">${image}</span>
      <span class="dictionary-availability">${info}</span>
    </label>`;
  });
  const { common, rare } = getDictionarySpeciesBands();
  const availabilityPending = dictionarySpecies.some((item) => item.loading || item.infoLoading);
  const availableCount = dictionarySpecies.filter((item) => !item.loading && !item.error && item.recordingCount > 0).length;
  const commonAvailableCount = common.filter(({ item }) => !item.loading && !item.error && item.recordingCount > 0).length;
  document.querySelector("#select-common-species").disabled = availabilityPending || !commonAvailableCount;
  document.querySelector("#select-all-species").disabled = availabilityPending || !availableCount;
  document.querySelector("#select-no-species").disabled = availabilityPending;
  const renderSection = (title, items) => items.length
    ? `<section class="dictionary-species-section"><h4>${title}<span>${formatNumber(items.length)}</span></h4>${items.map(({ index }) => rows[index]).join("")}</section>`
    : "";
  elements.dictionarySpecies.innerHTML = [
    renderSection("Common · top 20% by GBIF observations", common),
    renderSection("Rare · next 50% by GBIF observations", rare)
  ].join("");
  elements.dictionarySpecies.querySelectorAll(".dictionary-species-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      dictionarySelectionTouched = true;
      dictionarySpecies[Number(checkbox.dataset.index)].selected = checkbox.checked;
      elements.dictionaryPreview.classList.add("is-hidden");
      updateDictionarySelectionCount();
    });
  });
  updateDictionarySelectionCount();
}

function selectCommonSpecies() {
  dictionarySpecies.forEach((item) => { item.selected = false; });
  getDictionarySpeciesBands().common.forEach(({ item }) => {
    if (!item.loading && !item.error && item.recordingCount > 0) item.selected = true;
  });
}

function getDictionarySpeciesBands() {
  const species = dictionarySpecies
    .map((item, index) => ({ item, index }));
  return {
    common: species.filter(({ item }) => item.occurrenceBand === "common"),
    rare: species.filter(({ item }) => item.occurrenceBand === "rare")
  };
}

function metric(value, label, isError = false, iconOnly = false) {
  const className = isError ? "availability-mark is-error" : value.startsWith("✓") ? "availability-mark is-available" : "availability-mark";
  return `<span class="${className}" title="${escapeHtml(label)}">${escapeHtml(value)}${iconOnly ? `<span class="sr-only">${escapeHtml(label)}</span>` : ""}</span>`;
}

async function fetchXenoCantoPage(species, location, recordingGroup, page = 1, perPage = 50) {
  const key = elements.xenoKey.value.trim();
  if (!key) throw new Error("Enter your Xeno-canto API key in the audio panel below the species lists.");
  const query = makeXenoCantoQuery(species.scientificName, location, recordingGroup);
  const params = new URLSearchParams({ query, key, per_page: String(perPage), page: String(page) });
  const response = await fetch(`https://xeno-canto.org/api/3/recordings?${params}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || `Xeno-canto request failed (${response.status}).`;
    throw new Error(message);
  }
  return {
    query,
    queryGroup: recordingGroup,
    total: Number(data.numRecordings) || 0,
    recordings: (data.recordings || []).map((recording) => ({
      ...recording,
      file: recording.file,
      lic: recording.lic,
      sono: recording.sono || {},
      queryGroup: recordingGroup
    }))
  };
}

async function fetchXenoCantoRecords(species, group, location, limit) {
  const recordingGroups = group.xenoGroups || [];
  if (!recordingGroups.length) return { total: 0, recordings: [], queries: [] };
  const requests = await Promise.all(recordingGroups.map((recordingGroup) =>
    fetchXenoCantoPage(species, location, recordingGroup, 1, 50)
  ));
  const uniqueRecordings = new Map();
  for (const request of requests) {
    for (const recording of request.recordings) uniqueRecordings.set(recording.id, recording);
  }
  return {
    total: requests.reduce((sum, request) => sum + request.total, 0),
    recordings: [...uniqueRecordings.values()].slice(0, limit),
    queries: requests.map(({ query, queryGroup, total }) => ({ query, queryGroup, total }))
  };
}

async function loadSpeciesInfo(item) {
  try {
    const response = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(item.key)}`);
    if (!response.ok) throw new Error(`Species details request failed (${response.status}).`);
    const detail = await response.json();
    item.taxonomy = detail;
    item.scientificName = detail.canonicalName || detail.scientificName || item.scientificName || "";
    item.commonName = detail.vernacularName || item.commonName || "";
    if (!item.scientificName) item.error = "Species name unavailable from GBIF.";
  } catch (error) {
    item.error = error instanceof Error ? error.message : "Species details could not be loaded.";
  }
  if (item.taxonomy) {
    try {
      const response = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(item.key)}/media?limit=10`);
      if (!response.ok) throw new Error(`Species media request failed (${response.status}).`);
      const media = await response.json();
      item.image = (media.results || []).find((entry) =>
        entry.identifier && /image|photo|still/i.test(`${entry.type || ""} ${entry.format || ""}`)
      ) || (media.results || []).find((entry) => entry.identifier) || null;
    } catch (error) {
      item.imageError = error instanceof Error ? error.message : "Could not check species images.";
    }
  }
  item.infoLoading = false;
  item.loading = false;
}

async function openDictionary(groupId) {
  const group = groups.find((item) => item.id === groupId);
  const state = currentSearch?.states?.[groupId];
  if (!group || !state?.species?.length) return;

  activeDictionaryGroup = group;
  const version = ++dictionaryVersion;
  dictionarySelectionTouched = false;
  dictionarySpecies = [];
  elements.dictionaryDescription.textContent = `${group.title}: Common is the top 20% of nearby species by GBIF observations; Rare is the next 50%. The least-observed 30% remain in the area overview and are not included in this dictionary shortlist.${group.xenoGroups?.length ? " Audio availability is checked separately." : " Xeno-canto audio matching is not configured for this group yet."}`;
  elements.dictionaryStatus.textContent = `Loading the nearby ${group.title.toLowerCase()} species list…`;
  elements.dictionaryPreview.classList.add("is-hidden");
  elements.dictionary.classList.remove("is-hidden");
  renderDictionarySpecies();
  elements.dictionary.scrollIntoView({ behavior: "smooth", block: "start" });

  const speciesCount = state.speciesCount || state.speciesKeys?.length || state.species.length;
  let speciesKeys = state.speciesKeys?.length ? state.speciesKeys : state.species;
  if (!speciesKeys?.length || speciesKeys.length < speciesCount) {
    elements.dictionaryStatus.textContent = `Loading the full nearby ${group.title.toLowerCase()} species list…`;
    try {
      const fullResult = await fetchSpeciesOccurrences(group, currentSearch.location, currentSearch.radiusKm);
      if (version !== dictionaryVersion) return;
      speciesKeys = fullResult.speciesKeys;
    } catch (error) {
      if (version === dictionaryVersion) {
        elements.dictionaryStatus.textContent = error instanceof Error
          ? `Could not load the full species list: ${error.message}`
          : "Could not load the full species list.";
      }
      return;
    }
  }

  const occurrenceBands = getOccurrenceSpeciesBands(speciesKeys);
  elements.dictionaryStatus.textContent =
    `Shortlisted ${formatNumber(occurrenceBands.common.length)} common + ${formatNumber(occurrenceBands.rare.length)} rare species from ${formatNumber(speciesKeys.length)} nearby; ${formatNumber(occurrenceBands.excluded.length)} less-observed species remain in the area overview.`;
  const knownSpecies = new Map(state.species.map((species) => [String(species.key), species]));
  dictionarySpecies = [
    ...occurrenceBands.common.map((species) => ({ ...species, occurrenceBand: "common" })),
    ...occurrenceBands.rare.map((species) => ({ ...species, occurrenceBand: "rare" }))
  ].map((species) => ({
    ...knownSpecies.get(String(species.key)),
    ...species,
    selected: false,
    loading: true,
    infoLoading: true,
    recordingCount: group.xenoGroups?.length ? null : 0,
    recordings: [],
    error: group.xenoGroups?.length ? "" : "Audio search is not available for this group yet."
  }));
  renderDictionarySpecies();

  let detailedCount = 0;
  await mapWithConcurrency(dictionarySpecies, 4, async (item) => {
    await loadSpeciesInfo(item);
    detailedCount += 1;
    if (version === dictionaryVersion) {
      if (detailedCount === 1 || detailedCount % 20 === 0 || detailedCount === dictionarySpecies.length) {
        renderDictionarySpecies();
      }
      elements.dictionaryStatus.textContent = `Loading species names: ${detailedCount} of ${dictionarySpecies.length}…`;
    }
  });
  if (version !== dictionaryVersion) return;

  if (!group.xenoGroups?.length) {
    dictionarySpecies.forEach((item) => {
      item.loading = false;
      item.error = "Audio search is not configured for this group yet.";
    });
    elements.dictionaryStatus.textContent = "The complete nearby species list is ready, but Xeno-canto audio search is not configured for this group yet.";
    renderDictionarySpecies();
    return;
  }

  if (!elements.xenoKey.value.trim()) {
    dictionarySpecies.forEach((item) => {
      item.loading = false;
      item.error = "Add your Xeno-canto API key below.";
    });
    renderDictionarySpecies();
    elements.dictionaryStatus.textContent = "Enter and save your Xeno-canto API key below, then reopen this category.";
    elements.xenoKey.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.xenoKey.focus({ preventScroll: true });
    return;
  }

  const location = currentSearch.location;
  let completedCount = 0;
  await mapWithConcurrency(dictionarySpecies, 3, async (item) => {
    if (item.error) return;
    item.loading = true;
    try {
      const result = await fetchXenoCantoRecords(item, group, location, 50);
      if (version !== dictionaryVersion) return;
      item.recordingCount = result.total;
      item.recordings = result.recordings;
      item.recordingQueries = result.queries;
      item.hasSpectrogram = result.recordings.some((recording) => recording.sono?.large || recording.sono?.med);
      item.selected = false;
    } catch (error) {
      if (version !== dictionaryVersion) return;
      item.loading = false;
      item.error = error instanceof Error ? error.message : "Could not check recording availability.";
      renderDictionarySpecies();
      return;
    }
    if (version === dictionaryVersion) {
      item.loading = false;
      completedCount += 1;
      if (completedCount === 1 || completedCount % 10 === 0 || completedCount === dictionarySpecies.length) {
        renderDictionarySpecies();
      }
      elements.dictionaryStatus.textContent = `Checking Xeno-canto availability: ${completedCount} of ${dictionarySpecies.length} species…`;
    }
  });
  if (version === dictionaryVersion) {
    if (!dictionarySelectionTouched) {
      selectCommonSpecies();
    }
    const availableCount = dictionarySpecies.filter((item) => item.recordingCount > 0).length;
    const failedCount = dictionarySpecies.filter((item) => item.error).length;
    elements.dictionaryStatus.textContent = `${availableCount} of ${dictionarySpecies.length} listed species have matching records in the Xeno-canto search${failedCount ? `; ${failedCount} availability checks failed` : ""}. Counts use Xeno-canto’s approximate coordinate search.`;
    renderDictionarySpecies();
  }
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function safeFileName(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "species";
}

function fileExtension(url, contentType, fallback) {
  const path = String(url || "").split("?")[0];
  const urlExtension = path.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (urlExtension) return urlExtension.toLowerCase();
  const mimeExtension = {
    "audio/mpeg": "mp3",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  }[String(contentType || "").split(";")[0].toLowerCase()];
  return mimeExtension || fallback;
}

async function fetchBinaryAsset(url) {
  const proxyUrl = new URL("/asset-proxy", window.location.origin);
  proxyUrl.searchParams.set("url", url);
  const response = await fetch(proxyUrl);
  if (response.status === 404) {
    const port = window.location.port || "8765";
    throw new Error(`This page is reaching a static server without the media proxy. Open http://127.0.0.1:${port}/index.html, served by \`python .\\server.py\`, then retry.`);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Media proxy failed (${response.status}): ${url}`);
  }
  return {
    blob: await response.blob(),
    contentType: response.headers.get("content-type") || ""
  };
}

function recordingSeconds(recording) {
  const parts = String(recording.length || "").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return 30;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} sec`;
  return `~${Math.ceil(seconds / 60)} min`;
}

async function getRandomRecordings(species, group, location, count) {
  const queryPages = await Promise.all((species.recordingQueries || [])
    .filter((query) => query.total > 0)
    .map(async (query) => {
      const pageCount = Math.max(1, Math.ceil(query.total / 50));
      const page = 1 + Math.floor(Math.random() * pageCount);
      return fetchXenoCantoPage(species, location, query.queryGroup, page, 50);
    }));
  const candidates = new Map();
  for (const result of queryPages) {
    for (const recording of result.recordings) candidates.set(recording.id, recording);
  }
  return shuffle([...candidates.values()]).slice(0, Math.min(count, species.recordingCount));
}

async function buildDictionary() {
  if (!activeDictionaryGroup || !currentSearch) return;
  const group = activeDictionaryGroup;
  const selected = dictionarySpecies.filter((item) => item.selected && item.recordingCount > 0);
  if (!selected.length) {
    elements.dictionaryStatus.textContent = "Select at least one species with available recordings.";
    return;
  }
  generatedDictionaryArchive = null;
  elements.viewGeneratedDictionary.classList.add("is-hidden");
  const requestedSamples = Math.max(1, Math.min(20, Number(elements.samplesPerSpecies.value) || 5));
  elements.samplesPerSpecies.value = String(requestedSamples);
  elements.buildDictionary.disabled = true;
  elements.dictionaryPreview.classList.remove("is-hidden");
  elements.previewSummary.textContent = `Preparing randomized recordings and available species information for ${selected.length} species…`;
  elements.previewRecordings.replaceChildren();
  elements.downloadProgress.value = 0;
  try {
    if (!window.JSZip) throw new Error("The ZIP download library did not load. Check your internet connection and refresh the page.");
    const zip = new window.JSZip();
    const manifest = {
      createdAt: new Date().toISOString(),
      location: currentSearch.location,
      radiusKm: currentSearch.radiusKm,
      group: group.title,
      requestedSamplesPerSpecies: requestedSamples,
      species: [],
      downloadIssues: []
    };
    const expectedRecordings = selected.reduce((total, species) =>
      total + Math.min(species.recordingCount, requestedSamples), 0);
    const lengths = selected.flatMap((species) => species.recordings.map(recordingSeconds));
    const averageSeconds = lengths.length
      ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length
      : 30;
    const estimatedBytes = Math.round(expectedRecordings * averageSeconds * 16000);
    const estimatedSeconds = expectedRecordings * 3 + selected.length * 2;
    elements.previewSummary.textContent = `About ${formatNumber(expectedRecordings)} audio clips · ${formatBytes(estimatedBytes)} · ${formatDuration(estimatedSeconds)} estimated (network-dependent).`;
    elements.dictionaryStatus.textContent = "Preparing archive…";
    let completedSpecies = 0;

    await mapWithConcurrency(selected, 2, async (species) => {
      const slug = `${safeFileName(speciesDisplayName(species))}_${safeFileName(species.scientificName)}`;
      const folder = zip.folder(`species/${slug}`);
      elements.dictionaryStatus.textContent = `Collecting species information for ${speciesDisplayName(species)}…`;
      const entry = {
        key: species.key,
        scientificName: species.scientificName,
        commonName: species.commonName || "",
        occurrenceBand: species.occurrenceBand || "",
        gbifObservations: species.observations,
        gbifSpeciesUrl: `https://www.gbif.org/species/${species.key}`,
        taxonomy: species.taxonomy || null,
        descriptions: [],
        image: species.image ? {
          sourceUrl: species.image.identifier,
          title: species.image.title || "",
          creator: species.image.creator || "",
          license: species.image.license || species.image.rights || "",
          attribution: species.image.rightsHolder || ""
        } : null,
        recordings: []
      };
      const descriptionUrl = `https://api.gbif.org/v1/species/${encodeURIComponent(species.key)}/descriptions?limit=10`;
      try {
        const response = await fetch(descriptionUrl);
        if (!response.ok) throw new Error(`GBIF descriptions request failed (${response.status}).`);
        const data = await response.json();
        entry.descriptions = data.results || [];
      } catch (error) {
        manifest.downloadIssues.push({
          species: species.scientificName,
          asset: "species descriptions",
          message: error instanceof Error ? error.message : "Could not download species descriptions."
        });
      }

      if (species.image?.identifier) {
        elements.dictionaryStatus.textContent = `Downloading species image for ${speciesDisplayName(species)}…`;
        try {
          const asset = await fetchBinaryAsset(species.image.identifier);
          const imagePath = `images/species.${fileExtension(species.image.identifier, asset.contentType, "jpg")}`;
          folder.file(imagePath, asset.blob);
          entry.image.archivePath = imagePath;
        } catch (error) {
          manifest.downloadIssues.push({
            species: species.scientificName,
            asset: "species image",
            sourceUrl: species.image.identifier,
            message: error instanceof Error ? error.message : "Could not download species image."
          });
        }
      }

      let recordings = [];
      try {
        elements.dictionaryStatus.textContent = `Choosing random recordings for ${speciesDisplayName(species)}…`;
        recordings = await getRandomRecordings(species, group, currentSearch.location, requestedSamples);
        if (recordings.length < Math.min(requestedSamples, species.recordingCount)) {
          manifest.downloadIssues.push({
            species: species.scientificName,
            asset: "audio selection",
            message: `Requested ${requestedSamples}; only ${recordings.length} unique recordings were returned.`
          });
        }
      } catch (error) {
        manifest.downloadIssues.push({
          species: species.scientificName,
          asset: "audio search",
          message: error instanceof Error ? error.message : "Could not retrieve audio recordings."
        });
      }

      for (const recording of recordings) {
        const id = safeFileName(recording.id || `recording-${entry.recordings.length + 1}`);
        elements.dictionaryStatus.textContent = `Downloading ${speciesDisplayName(species)} · XC${recording.id}…`;
        const recordEntry = {
          id: recording.id,
          recordist: recording.rec || "",
          date: recording.date || "",
          country: recording.cnt || "",
          locality: recording.loc || "",
          quality: recording.q || "",
          length: recording.length || "",
          license: recording.lic || "",
          sourcePage: `https://xeno-canto.org/${recording.id}`,
          audioSource: recording.file || "",
          spectrogramSource: recording.sono?.large || recording.sono?.med || "",
          audioArchivePath: "",
          spectrogramArchivePath: ""
        };
        if (recording.file) {
          try {
            const asset = await fetchBinaryAsset(recording.file);
            recordEntry.audioArchivePath = `audio/${id}.${fileExtension(recording.file, asset.contentType, "mp3")}`;
            folder.file(recordEntry.audioArchivePath, asset.blob);
          } catch (error) {
            manifest.downloadIssues.push({
              species: species.scientificName,
              recordingId: recording.id,
              asset: "audio",
              sourceUrl: recording.file,
              message: error instanceof Error ? error.message : "Could not download audio."
            });
          }
        } else {
          manifest.downloadIssues.push({ species: species.scientificName, recordingId: recording.id, asset: "audio", message: "No audio URL supplied." });
        }
        const spectrogramUrl = recording.sono?.large || recording.sono?.med;
        if (spectrogramUrl) {
          try {
            const asset = await fetchBinaryAsset(spectrogramUrl);
            recordEntry.spectrogramArchivePath = `spectrograms/${id}.${fileExtension(spectrogramUrl, asset.contentType, "jpg")}`;
            folder.file(recordEntry.spectrogramArchivePath, asset.blob);
          } catch (error) {
            manifest.downloadIssues.push({
              species: species.scientificName,
              recordingId: recording.id,
              asset: "spectrogram",
              sourceUrl: spectrogramUrl,
              message: error instanceof Error ? error.message : "Could not download spectrogram."
            });
          }
        }
        entry.recordings.push(recordEntry);
      }
      folder.file("species.json", JSON.stringify(entry, null, 2));
      manifest.species.push({
        scientificName: entry.scientificName,
        commonName: entry.commonName,
        gbifSpeciesUrl: entry.gbifSpeciesUrl,
        image: entry.image,
        recordings: entry.recordings
      });
      completedSpecies += 1;
      elements.downloadProgress.value = Math.round(completedSpecies / selected.length * 75);
      elements.dictionaryStatus.textContent = `Collecting files: ${completedSpecies} of ${selected.length} species…`;
      elements.previewSummary.textContent = `${completedSpecies} of ${selected.length} species processed · ${manifest.downloadIssues.length} item download issue${manifest.downloadIssues.length === 1 ? "" : "s"}.`;
    });

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("README.txt", [
      "Fieldnotes wildlife sound dictionary",
      `Created: ${manifest.createdAt}`,
      `Area: ${manifest.location.name} (${manifest.location.latitude}, ${manifest.location.longitude}), ${manifest.radiusKm} km radius`,
      `Group: ${manifest.group}`,
      `Species included: ${manifest.species.length}`,
      `Requested recordings per species: ${requestedSamples}`,
      "",
      "Sources and reuse:",
      "- Species taxonomy, descriptions and images are from GBIF. See each species.json and media record for source and rights information.",
      "- Audio recordings and spectrograms are from Xeno-canto. Each recording's license and recordist are included in manifest.json and species.json.",
      "- Check the individual license terms before redistribution or publication.",
      `- ${manifest.downloadIssues.length} file or metadata issue(s) are listed in manifest.json.`
    ].join("\n"));
    elements.dictionaryStatus.textContent = "Packaging files into a ZIP archive…";
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } },
      (metadata) => {
        elements.downloadProgress.value = 75 + Math.round(metadata.percent * 0.25);
      }
    );
    const fileName = `${safeFileName(currentSearch.location.name)}_${safeFileName(group.id)}_dictionary.zip`;
    generatedDictionaryArchive = new File([blob], fileName, { type: "application/zip", lastModified: Date.now() });
    elements.viewGeneratedDictionary.classList.remove("is-hidden");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    elements.dictionaryStatus.textContent = manifest.downloadIssues.length
      ? `ZIP downloaded with ${manifest.downloadIssues.length} issue(s); see manifest.json for missing files and source links.`
      : "Dictionary ZIP downloaded successfully.";
    elements.previewSummary.textContent = `${formatNumber(manifest.species.length)} species · ${formatNumber(manifest.species.reduce((sum, item) => sum + item.recordings.length, 0))} recordings · ${formatBytes(blob.size)} ZIP.`;
    elements.previewRecordings.textContent = manifest.downloadIssues.length
      ? `${manifest.downloadIssues.length} file or metadata issue(s) are listed in the ZIP manifest.`
      : "Audio, available spectrograms, species images and species information are included.";
    elements.downloadProgress.value = 100;
  } catch (error) {
    elements.dictionaryStatus.textContent = error instanceof Error
      ? `Could not create dictionary: ${error.message}`
      : "Could not create dictionary.";
    elements.previewSummary.textContent = "No ZIP was created. Resolve the issue above and try again.";
  } finally {
    updateDictionarySelectionCount();
  }
}

function percentOf(value, total) {
  return total ? Math.round(value / total * 100) : 0;
}

function groupOverviewRow(group, state) {
  if (state.loading) {
    return `<tr><td><a class="overview-drill" href="#species-group-${group.id}">${group.title} ↓</a></td><td colspan="4">Loading nearby records…</td></tr>`;
  }
  if (state.error) {
    return `<tr><td><a class="overview-drill" href="#species-group-${group.id}">${group.title} ↓</a></td><td colspan="4" class="group-error">${escapeHtml(state.error)}</td></tr>`;
  }
  if (!state.speciesCount) {
    return `<tr><td><a class="overview-drill" href="#species-group-${group.id}">${group.title} ↓</a></td><td>0</td><td>0</td><td colspan="2">No records in this area</td></tr>`;
  }
  return `<tr>
    <td><a class="overview-drill" href="#species-group-${group.id}">${group.title} ↓</a></td>
    <td>${state.speciesCount >= 1000 ? "1,000+" : formatNumber(state.speciesCount)}</td>
    <td>${formatNumber(state.totalRecords)}</td>
    <td class="summary-band"><strong>${formatNumber(state.top20.speciesCount)} species · ${percentOf(state.top20.records, state.speciesRecords)}%</strong><span>Average ${formatNumber(Math.round(state.top20.averageRecords))} records per species</span></td>
    <td class="summary-band"><strong>${formatNumber(state.next50.speciesCount)} species · ${percentOf(state.next50.records, state.speciesRecords)}%</strong><span>Average ${formatNumber(Math.round(state.next50.averageRecords))} records per species</span></td>
  </tr>`;
}

function renderOverview(states, radiusKm) {
  const availableGroups = groups.filter((group) => !states[group.id].loading && !states[group.id].error);
  const knownSpecies = availableGroups.reduce((sum, group) => sum + states[group.id].speciesCount, 0);
  const speciesCountCapped = availableGroups.some((group) => states[group.id].speciesCount >= 1000);
  const totalRecords = availableGroups.reduce((sum, group) => sum + states[group.id].totalRecords, 0);
  const isLoading = Object.values(states).some((state) => state.loading);
  elements.overviewRadius.textContent = `${radiusKm} km radius`;
  elements.overviewStats.innerHTML = `
    <div class="overview-stat"><strong>${isLoading && !knownSpecies ? "…" : formatNumber(knownSpecies)}${speciesCountCapped || (isLoading && knownSpecies) ? "+" : ""}</strong><span>species with records${isLoading ? " so far" : ""}</span></div>
    <div class="overview-stat"><strong>${isLoading && !totalRecords ? "…" : formatNumber(totalRecords)}${isLoading && totalRecords ? "+" : ""}</strong><span>GBIF occurrence records${isLoading ? " so far" : ""}</span></div>
    <div class="overview-stat"><strong>${availableGroups.length} / ${groups.length}</strong><span>wildlife groups checked</span></div>`;
  elements.overviewRows.innerHTML = groups.map((group) => groupOverviewRow(group, states[group.id])).join("");
}

async function checkBirdAudio(button) {
  const key = elements.xenoKey.value.trim();
  if (!key) {
    elements.xenoKey.focus();
    elements.resultsStatus.textContent = "Enter a Xeno-canto API key to check bird recording counts.";
    return;
  }
  const scientificName = button.dataset.scientificName;
  const location = selectedLocation;
  if (!location) return;

  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const query = makeXenoCantoQuery(scientificName, location);
    const params = new URLSearchParams({ query, key, per_page: "1" });
    const response = await fetch(`https://xeno-canto.org/api/3/recordings?${params}`);
    if (!response.ok) throw new Error(`Xeno-canto request failed (${response.status}). Check the API key and try again.`);
    const data = await response.json();
    if (!data.numRecordings) throw new Error("Xeno-canto returned no recording count.");
    const count = Number(data.numRecordings);
    const result = document.createElement("span");
    result.className = "audio-count";
    result.textContent = `${formatNumber(count)} recordings`;
    const link = document.createElement("a");
    link.href = `https://xeno-canto.org/explore?query=${encodeURIComponent(query)}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View on Xeno-canto ↗";
    result.append(link);
    button.replaceWith(result);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Retry audio";
    elements.resultsStatus.textContent = error instanceof Error ? error.message : "Could not retrieve the Xeno-canto count.";
  }
}

elements.searchSpecies.addEventListener("click", async () => {
  if (!selectedLocation) return;
  const version = ++searchVersion;
  currentSearch = null;
  elements.saveProject.disabled = true;
  const radiusKm = Number(elements.radius.value);
  const states = Object.fromEntries(groups.map((group) => [group.id, { loading: true, species: [] }]));
  elements.results.classList.remove("is-hidden");
  elements.resultsPlace.textContent = selectedLocation.name.split(",")[0];
  elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${selectedLocation.latitude}&mlon=${selectedLocation.longitude}#map=10/${selectedLocation.latitude}/${selectedLocation.longitude}`;
  elements.resultsStatus.textContent = `Searching a ${radiusKm} km area for species records…`;
  renderOverview(states, radiusKm);
  elements.searchSpecies.disabled = true;
  renderGroups(states);
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });

  const tasks = groups.map(async (group) => {
    try {
      const result = await fetchSpeciesOccurrences(group, selectedLocation, radiusKm);
      if (version === searchVersion) states[group.id] = { loading: false, ...result };
    } catch (error) {
      if (version === searchVersion) {
        states[group.id] = {
          loading: false,
          error: error instanceof Error ? error.message : "Could not load records. Please try again.",
          species: [],
          totalRecords: 0
        };
      }
    }
    if (version === searchVersion) {
      renderOverview(states, radiusKm);
      renderGroups(states);
    }
  });
  await Promise.all(tasks);
  if (version === searchVersion) {
    elements.resultsStatus.textContent = "Showing up to 8 species per group, ranked by GBIF occurrence records in the selected area.";
    elements.searchSpecies.disabled = false;
    currentSearch = {
      location: { ...selectedLocation },
      radiusKm,
      states: JSON.parse(JSON.stringify(states))
    };
    updateSaveProjectAvailability();
    setProjectStatus("Search ready. Give it a name to save and load it later.");
  }
});
