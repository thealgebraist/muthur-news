"use strict";

const CYCLE_MS = 15_000;
const NETWORK_REFRESH_MS = 5 * 60_000;
const QUEUE_SIZE = 4;

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
    showCurrent(false);
  } else {
    state.bulletins = [...fallbackBulletins];
    state.cursor = 0;
    state.liveSources = 0;
    setNetworkState("OFFLINE / ARCHIVE", "offline");
    showCurrent(false);
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

function showCurrent(animate = true) {
  const bulletin = state.bulletins[state.cursor];
  if (!bulletin) return;

  if (animate) {
    dom.panel.classList.remove("switching");
    void dom.panel.offsetWidth;
    dom.panel.classList.add("switching");
    beep();
  }

  dom.sourceLabel.textContent = `SOURCE: ${bulletin.source}`;
  dom.publishedTime.textContent = `UTC / ${displayDate(validDate(bulletin.publishedAt))}`;
  dom.sequence.textContent = String(state.sequence).padStart(4, "0");
  dom.headline.textContent = bulletin.title;
  dom.summary.textContent = bulletin.summary;
  dom.sourceDomain.textContent = sourceDomain(bulletin.url);
  dom.sourceLink.href = bulletin.url || "#";
  dom.sourceLink.classList.toggle("disabled", !bulletin.url);
  dom.sourceLink.setAttribute("aria-disabled", String(!bulletin.url));
  renderQueue();
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
  if (state.sound) beep();
}

function beep() {
  if (!state.sound) return;
  state.audio ||= new AudioContext();
  const oscillator = state.audio.createOscillator();
  const gain = state.audio.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(660, state.audio.currentTime);
  gain.gain.setValueAtTime(0.025, state.audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, state.audio.currentTime + 0.055);
  oscillator.connect(gain).connect(state.audio.destination);
  oscillator.start();
  oscillator.stop(state.audio.currentTime + 0.06);
}

function updateCycle(now) {
  let remaining = state.paused ? state.remaining : state.deadline - now;
  if (!state.paused && remaining <= 0) {
    nextBulletin();
    remaining = CYCLE_MS;
  }

  const fraction = Math.min(1, Math.max(0, remaining / CYCLE_MS));
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
