"use strict";

const CYCLE_MS = 15_000;
const NETWORK_REFRESH_MS = 5 * 60_000;
const QUEUE_SIZE = 4;
const BOOT_TIMING = {
  blackout: 300,
  scan: 420,
  alert: 420,
  settle: 100,
};

const endpoints = {
  spaceflight:
    "https://api.spaceflightnewsapi.net/v4/articles/?limit=16&ordering=-published_at",
  hackerNews:
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=16",
};

const fallbackBulletins = [
  {
    title: "Deep-space relay enters scheduled diagnostic window",
    summary:
      "The local terminal is displaying a stored systems bulletin while public network access is unavailable.",
    source: "MU/TH/UR ARCHIVE",
    url: "",
    publishedAt: new Date().toISOString(),
    fallback: true,
  },
  {
    title: "Orbital traffic controllers publish revised approach corridor",
    summary:
      "Automated navigation notices remain available from the local cache. Live public stories will replace this record when the uplink returns.",
    source: "COLONY NETWORK",
    url: "",
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    fallback: true,
  },
  {
    title: "Atmospheric processor output holds within nominal range",
    summary:
      "This bundled continuity bulletin confirms the display loop is operational independently of external web services.",
    source: "SYSTEMS ARCHIVE",
    url: "",
    publishedAt: new Date(Date.now() - 7_200_000).toISOString(),
    fallback: true,
  },
  {
    title: "Public-network acquisition will retry automatically",
    summary:
      "No operator action is required. The terminal checks its keyless public feeds every five minutes or when refresh is selected.",
    source: "RELAY CONTROL",
    url: "",
    publishedAt: new Date(Date.now() - 10_800_000).toISOString(),
    fallback: true,
  },
];

const dom = {
  queue: document.querySelector("#bulletin-queue"),
  queueCount: document.querySelector("#queue-count"),
  feedMode: document.querySelector("#feed-mode"),
  signalRow: document.querySelector(".signal-row"),
  panel: document.querySelector(".transmission-panel"),
  sourceLabel: document.querySelector("#source-label"),
  publishedTime: document.querySelector("#published-time"),
  sequence: document.querySelector("#sequence"),
  headline: document.querySelector("#headline"),
  summary: document.querySelector("#summary"),
  sourceLink: document.querySelector("#source-link"),
  sourceDomain: document.querySelector("#source-domain"),
  countdown: document.querySelector("#countdown-seconds"),
  networkStatus: document.querySelector("#network-status"),
  sourceCount: document.querySelector("#source-count"),
  lastSync: document.querySelector("#last-sync"),
  refresh: document.querySelector("#refresh-button"),
  pause: document.querySelector("#pause-button"),
  next: document.querySelector("#next-button"),
  sound: document.querySelector("#sound-button"),
  sourceActions: document.querySelector(".source-actions"),
  statusPrimary: document.querySelector(".status-primary"),
  terminalState: document.querySelector("#terminal-state"),
  clock: document.querySelector("#ship-clock"),
};

const state = {
  bulletins: [...fallbackBulletins],
  cursor: 0,
  sequence: 1,
  deadline: performance.now() + CYCLE_MS,
  remaining: CYCLE_MS,
  paused: false,
  fetching: false,
  sound: false,
  audio: null,
  hum: null,
  plotController: null,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  liveSources: 0,
};

function cleanText(value, fallback = "") {
  const documentFragment = new DOMParser().parseFromString(
    String(value ?? ""),
    "text/html",
  );
  return (documentFragment.body.textContent || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}…`;
}

function normalizeSpaceflight(data) {
  return (data.results || []).map((item) => ({
    title: cleanText(item.title, "Untitled transmission"),
    summary: clampText(
      cleanText(item.summary, "No summary was supplied by the source."),
      420,
    ),
    source: cleanText(item.news_site, "SPACEFLIGHT NEWS"),
    url: item.url || "",
    publishedAt: item.published_at,
    fallback: false,
  }));
}

function normalizeHackerNews(data) {
  return (data.hits || [])
    .filter((item) => item.title)
    .map((item) => ({
      title: cleanText(item.title),
      summary: `A public technology bulletin submitted by ${cleanText(
        item.author,
        "an unknown operator",
      )}. Signal response: ${item.points ?? 0} points and ${
        item.num_comments ?? 0
      } comments.`,
      source: "HN FRONT PAGE",
      url:
        item.url ||
        `https://news.ycombinator.com/item?id=${encodeURIComponent(item.objectID)}`,
      publishedAt: item.created_at,
      fallback: false,
    }));
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLocaleLowerCase();
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function weave(first, second) {
  const output = [];
  const max = Math.max(first.length, second.length);
  for (let index = 0; index < max; index += 1) {
    if (first[index]) output.push(first[index]);
    if (second[index]) output.push(second[index]);
  }
  return output;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function refreshNetwork() {
  if (state.fetching) return;
  state.fetching = true;
  setNetworkState("SYNCING", "acquiring");
  dom.refresh.disabled = true;
  dom.refresh.textContent = "CONTACTING NETWORK…";

  const [spaceflight, hackerNews] = await Promise.allSettled([
    fetchJson(endpoints.spaceflight),
    fetchJson(endpoints.hackerNews),
  ]);

  const spaceItems =
    spaceflight.status === "fulfilled" ? normalizeSpaceflight(spaceflight.value) : [];
  const hackerItems =
    hackerNews.status === "fulfilled" ? normalizeHackerNews(hackerNews.value) : [];
  const incoming = deduplicate(weave(spaceItems, hackerItems));

  if (incoming.length > 0) {
    state.bulletins = incoming;
    state.cursor = 0;
    state.liveSources = Number(spaceItems.length > 0) + Number(hackerItems.length > 0);
    setNetworkState(
      state.liveSources === 2 ? "LIVE / 2 LINKS" : "LIVE / 1 LINK",
      "live",
    );
    dom.lastSync.textContent = utcClock(new Date());
    state.deadline = performance.now() + CYCLE_MS;
    state.remaining = CYCLE_MS;
    showCurrent(true);
  } else {
    state.bulletins = [...fallbackBulletins];
    state.cursor = 0;
    state.liveSources = 0;
    setNetworkState("OFFLINE / ARCHIVE", "offline");
    state.deadline = performance.now() + CYCLE_MS;
    state.remaining = CYCLE_MS;
    showCurrent(true);
  }

  state.fetching = false;
  dom.refresh.disabled = false;
  dom.refresh.textContent = "RECALL NETWORK [R]";
}

function setNetworkState(label, mode) {
  dom.networkStatus.textContent = label;
  dom.feedMode.textContent =
    mode === "live"
      ? "PUBLIC SIGNAL LOCKED"
      : mode === "offline"
        ? "ARCHIVE SIGNAL"
        : "ACQUIRING SIGNAL";
  dom.sourceCount.textContent = String(state.liveSources).padStart(2, "0");
  dom.signalRow.className = `signal-row ${mode}`;
  dom.statusPrimary.className = `status-primary ${mode}`;
  dom.terminalState.textContent =
    mode === "live"
      ? "NETWORK LINK ACTIVE"
      : mode === "offline"
        ? "ARCHIVE MODE"
        : "NETWORK SYNC";
}

function currentQueue() {
  const size = Math.min(QUEUE_SIZE, state.bulletins.length);
  return Array.from({ length: size }, (_, offset) => {
    const index = (state.cursor + offset) % state.bulletins.length;
    return state.bulletins[index];
  });
}

function renderQueue() {
  const entries = currentQueue();
  dom.queue.replaceChildren(
    ...entries.map((bulletin, index) => {
      const item = document.createElement("li");
      if (index === 0) item.classList.add("active");

      const source = document.createElement("span");
      source.className = "queue-source";
      source.textContent = bulletin.source;

      const title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = bulletin.title;

      item.append(source, title);
      return item;
    }),
  );
  dom.queueCount.textContent = String(entries.length).padStart(2, "0");
}

function validDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function utcClock(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function displayDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

function sourceDomain(url) {
  if (!url) return "LOCAL STORAGE";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "SOURCE ADDRESS INVALID";
  }
}

function waitForPlot(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timer = window.setTimeout(() => resolve(true), milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });
}

function plotDelay(character, base, variance) {
  const jitter = Math.random() * variance;
  if (/[.!?:;]/.test(character)) return base + jitter + 95;
  if (character === ",") return base + jitter + 45;
  if (character === " ") return base * 0.3 + jitter;
  return base + jitter;
}

async function plotText(element, text, options) {
  const { base, variance, signal } = options;
  element.textContent = "";
  element.setAttribute("aria-label", text);
  element.classList.add("plot-target", "typing");

  for (let index = 0; index < text.length; index += 1) {
    if (signal.aborted) {
      element.classList.remove("typing");
      return false;
    }

    const character = text[index];
    element.textContent += character;
    glyphTick(character, index);

    if (index % 5 === 0 && typeof element.animate === "function") {
      element.animate(
        [
          { opacity: 0.48, filter: "brightness(1.75)" },
          { opacity: 1, filter: "brightness(1)" },
        ],
        { duration: 48, easing: "steps(2, end)" },
      );
    }

    const continued = await waitForPlot(
      plotDelay(character, base, variance),
      signal,
    );
    if (!continued) {
      element.classList.remove("typing");
      return false;
    }
  }

  element.classList.remove("typing");
  return true;
}

function setBulletinLink(bulletin) {
  dom.sourceDomain.textContent = sourceDomain(bulletin.url);
  dom.sourceLink.href = bulletin.url || "#";
  dom.sourceLink.classList.toggle("disabled", !bulletin.url);
  dom.sourceLink.setAttribute("aria-disabled", String(!bulletin.url));
}

function showBulletinImmediately(bulletin) {
  dom.panel.dataset.phase = "live";
  dom.panel.dataset.plotState = "complete";
  dom.sourceLabel.textContent = `SOURCE: ${bulletin.source}`;
  dom.publishedTime.textContent = `UTC / ${displayDate(validDate(bulletin.publishedAt))}`;
  dom.headline.textContent = bulletin.title;
  dom.summary.textContent = bulletin.summary;
  dom.sourceActions.classList.remove("plot-hidden");
}

async function animateBulletin(bulletin, controller) {
  const { signal } = controller;
  const sourceText = `SOURCE: ${bulletin.source}`;
  const timeText = `UTC / ${displayDate(validDate(bulletin.publishedAt))}`;

  dom.panel.dataset.plotState = "booting";
  dom.sourceLabel.textContent = "";
  dom.publishedTime.textContent = "";
  dom.headline.textContent = "";
  dom.summary.textContent = "";
  dom.sourceActions.classList.add("plot-hidden");

  dom.panel.dataset.phase = "blackout";
  powerSequenceSound();
  if (!(await waitForPlot(BOOT_TIMING.blackout, signal))) return;

  dom.panel.dataset.phase = "scan";
  if (!(await waitForPlot(BOOT_TIMING.scan, signal))) return;

  dom.panel.dataset.phase = "alert";
  alertLockSound();
  if (!(await waitForPlot(BOOT_TIMING.alert, signal))) return;

  dom.panel.dataset.phase = "live";
  dom.panel.dataset.plotState = "plotting";
  if (!(await waitForPlot(BOOT_TIMING.settle, signal))) return;

  const metadataResults = await Promise.all([
    plotText(dom.sourceLabel, sourceText, { base: 23, variance: 14, signal }),
    plotText(dom.publishedTime, timeText, { base: 19, variance: 11, signal }),
  ]);
  if (signal.aborted || metadataResults.includes(false)) return;

  if (
    !(await plotText(dom.headline, bulletin.title, {
      base: 42,
      variance: 24,
      signal,
    }))
  ) {
    return;
  }

  if (!(await waitForPlot(130, signal))) return;

  if (
    !(await plotText(dom.summary, bulletin.summary, {
      base: 10,
      variance: 7,
      signal,
    }))
  ) {
    return;
  }

  dom.sourceActions.classList.remove("plot-hidden");
  dom.panel.dataset.plotState = "complete";
  completionSound();
}

function showCurrent(animate = true) {
  const bulletin = state.bulletins[state.cursor];
  if (!bulletin) return;

  state.plotController?.abort();
  dom.sourceLabel.classList.remove("typing");
  dom.publishedTime.classList.remove("typing");
  dom.headline.classList.remove("typing");
  dom.summary.classList.remove("typing");
  dom.sequence.textContent = String(state.sequence).padStart(4, "0");
  setBulletinLink(bulletin);
  renderQueue();

  if (!animate || state.reducedMotion) {
    showBulletinImmediately(bulletin);
    return;
  }

  const controller = new AbortController();
  state.plotController = controller;
  void animateBulletin(bulletin, controller);
}

function nextBulletin() {
  state.cursor = (state.cursor + 1) % state.bulletins.length;
  state.sequence += 1;
  state.deadline = performance.now() + CYCLE_MS;
  state.remaining = CYCLE_MS;
  showCurrent();
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) {
    state.remaining = Math.max(0, state.deadline - performance.now());
    dom.pause.textContent = "[SPACE] RELEASE";
    dom.terminalState.textContent = "RELAY HELD";
  } else {
    state.deadline = performance.now() + state.remaining;
    dom.pause.textContent = "[SPACE] HOLD";
    dom.terminalState.textContent =
      state.liveSources > 0 ? "NETWORK LINK ACTIVE" : "ARCHIVE MODE";
  }
}

function toggleSound() {
  state.sound = !state.sound;
  dom.sound.textContent = state.sound ? "[S] SOUND ON" : "[S] SOUND OFF";
  dom.sound.setAttribute("aria-pressed", String(state.sound));
  if (state.sound) {
    ensureAudio();
    void state.audio.resume();
    startHum();
    powerSequenceSound();
  } else {
    stopHum();
  }
}

function ensureAudio() {
  if (state.audio) return state.audio;
  const BrowserAudioContext = window.AudioContext || window.webkitAudioContext;
  state.audio = new BrowserAudioContext();
  return state.audio;
}

function tone(frequency, duration, gainValue, type = "square", endFrequency = null) {
  if (!state.sound) return;
  const context = ensureAudio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(
      endFrequency,
      context.currentTime + duration,
    );
  }
  gain.gain.setValueAtTime(gainValue, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function noiseBurst(duration = 0.12, gainValue = 0.012) {
  if (!state.sound) return;
  const context = ensureAudio();
  const frameCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1280;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(gainValue, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
}

function startHum() {
  if (!state.sound || state.hum) return;
  const context = ensureAudio();
  const master = context.createGain();
  const filter = context.createBiquadFilter();
  const low = context.createOscillator();
  const harmonic = context.createOscillator();

  master.gain.setValueAtTime(0.0001, context.currentTime);
  master.gain.exponentialRampToValueAtTime(0.008, context.currentTime + 0.35);
  filter.type = "lowpass";
  filter.frequency.value = 190;
  low.type = "sawtooth";
  low.frequency.value = 47;
  harmonic.type = "sine";
  harmonic.frequency.value = 94.3;

  low.connect(filter);
  harmonic.connect(filter);
  filter.connect(master).connect(context.destination);
  low.start();
  harmonic.start();
  state.hum = { master, oscillators: [low, harmonic] };
}

function stopHum() {
  if (!state.hum || !state.audio) return;
  const { master, oscillators } = state.hum;
  const stopAt = state.audio.currentTime + 0.12;
  master.gain.cancelScheduledValues(state.audio.currentTime);
  master.gain.setValueAtTime(
    Math.max(master.gain.value, 0.0001),
    state.audio.currentTime,
  );
  master.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  oscillators.forEach((oscillator) => oscillator.stop(stopAt));
  state.hum = null;
}

function powerSequenceSound() {
  if (!state.sound) return;
  noiseBurst(0.16, 0.014);
  tone(58, 0.34, 0.018, "sawtooth", 116);
}

function alertLockSound() {
  tone(760, 0.065, 0.012, "square");
  window.setTimeout(() => tone(1140, 0.05, 0.009, "square"), 74);
}

function glyphTick(character, index) {
  if (!state.sound || character === " " || index % 3 !== 0) return;
  const frequency = 840 + ((character.charCodeAt(0) * 17) % 260);
  tone(frequency, 0.018, 0.0035, "square");
}

function completionSound() {
  tone(390, 0.08, 0.009, "sine");
  window.setTimeout(() => tone(585, 0.11, 0.007, "sine"), 68);
}

function updateCycle(now) {
  let remaining = state.paused ? state.remaining : state.deadline - now;
  if (!state.paused && remaining <= 0) {
    nextBulletin();
    remaining = CYCLE_MS;
  }

  dom.countdown.textContent = String(Math.max(0, Math.ceil(remaining / 1000))).padStart(
    2,
    "0",
  );
  requestAnimationFrame(updateCycle);
}

function updateClock() {
  dom.clock.textContent = utcClock(new Date());
}

dom.refresh.addEventListener("click", refreshNetwork);
dom.pause.addEventListener("click", togglePause);
dom.next.addEventListener("click", nextBulletin);
dom.sound.addEventListener("click", toggleSound);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key.toLowerCase() === "n") {
    nextBulletin();
  } else if (event.key.toLowerCase() === "r") {
    refreshNetwork();
  } else if (event.key.toLowerCase() === "s") {
    toggleSound();
  }
});

showCurrent(false);
updateClock();
window.setInterval(updateClock, 1000);
window.setInterval(refreshNetwork, NETWORK_REFRESH_MS);
requestAnimationFrame(updateCycle);
refreshNetwork();
