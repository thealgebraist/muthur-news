"use strict";

const form = document.querySelector("#meet-form");
const input = document.querySelector("#meeting-code");
const error = document.querySelector("#form-error");
const relayState = document.querySelector("#relay-state");
const readout = document.querySelector("#scope-readout");
const clock = document.querySelector("#meet-clock");
const soundToggle = document.querySelector("#sound-toggle");

const audioState = {
  enabled: false,
  context: null,
};

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function parseMeetDestination(rawValue) {
  const value = rawValue.trim();
  if (!value) return null;

  const codeMatch = value.toLowerCase().match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/);
  if (codeMatch) return `https://meet.google.com/${codeMatch[1]}`;

  try {
    const candidate = new URL(value.includes("://") ? value : `https://${value}`);
    if (candidate.hostname !== "meet.google.com") return null;
    return candidate.href;
  } catch {
    return null;
  }
}

function ensureAudio() {
  if (!audioState.context) {
    audioState.context = new AudioContext();
  }
  if (audioState.context.state === "suspended") {
    audioState.context.resume();
  }
  return audioState.context;
}

function tone(frequency, duration, delay = 0, volume = 0.035) {
  if (!audioState.enabled) return;
  const context = ensureAudio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playAuthorization() {
  tone(78, 0.24, 0, 0.025);
  tone(156, 0.13, 0.11, 0.03);
  tone(312, 0.1, 0.26, 0.025);
  tone(624, 0.08, 0.39, 0.02);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const destination = parseMeetDestination(input.value);

  if (!destination) {
    error.textContent = "INVALID COORDINATES // ENTER A MEET CODE OR MEET.GOOGLE.COM URL";
    relayState.textContent = "LINK REFUSED";
    readout.textContent = "COORDINATE ERROR";
    tone(86, 0.18);
    return;
  }

  error.textContent = "";
  relayState.textContent = "LINK AUTHORIZED";
  readout.textContent = "OPENING SECURE GOOGLE CHANNEL";
  playAuthorization();
  window.open(destination, "_blank", "noopener,noreferrer");
  window.setTimeout(() => {
    relayState.textContent = "CHANNEL OPEN";
    readout.textContent = "MEET LINK ACTIVE IN SECONDARY DISPLAY";
  }, audioState.enabled ? 480 : 80);
});

input.addEventListener("input", () => {
  error.textContent = "";
  const destination = parseMeetDestination(input.value);
  relayState.textContent = destination ? "COORDINATES VALID" : "STANDBY";
  readout.textContent = destination ? "CHANNEL IDENTIFIED" : "AWAITING COORDINATES";
  if (audioState.enabled && input.value.length > 0) tone(980, 0.018, 0, 0.008);
});

soundToggle.addEventListener("click", () => {
  audioState.enabled = !audioState.enabled;
  soundToggle.setAttribute("aria-pressed", String(audioState.enabled));
  soundToggle.textContent = `[S] SOUND ${audioState.enabled ? "ON" : "OFF"}`;
  if (audioState.enabled) {
    tone(96, 0.1);
    tone(192, 0.08, 0.1);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "s" && document.activeElement !== input) {
    event.preventDefault();
    soundToggle.click();
  }
  if (event.key === "Escape") {
    window.location.href = "index.html";
  }
});

updateClock();
window.setInterval(updateClock, 1000);
