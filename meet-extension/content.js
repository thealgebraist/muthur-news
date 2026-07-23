"use strict";

const ROOT_CLASS = "muthur-meet";
const HEADER_ID = "muthur-meet-header";

function installHeader() {
  if (document.querySelector(`#${HEADER_ID}`)) return;
  const header = document.createElement("div");
  header.id = HEADER_ID;
  header.setAttribute("aria-hidden", "true");
  header.innerHTML = `
    <strong>MU/TH/UR 6000 // PERSONNEL COMMUNICATION LINK</strong>
    <span class="muthur-lamps"><i></i><i></i><i></i><i></i></span>
    <span id="muthur-meet-clock">UTC 00:00:00</span>
  `;
  document.body.append(header);
}

function classifyControls() {
  document.querySelectorAll("button, [role='button']").forEach((control) => {
    control.classList.add("muthur-control");
    const label = `${control.getAttribute("aria-label") || ""} ${
      control.getAttribute("data-tooltip") || ""
    } ${control.textContent || ""}`.toLowerCase();
    if (/leave|hang up|end call|exit/.test(label)) {
      control.dataset.muthurDanger = "true";
    }
  });
}

function updateClock() {
  const clock = document.querySelector("#muthur-meet-clock");
  if (!clock) return;
  clock.textContent = `UTC ${new Date().toISOString().slice(11, 19)}`;
}

function setEnabled(enabled) {
  document.documentElement.classList.toggle(ROOT_CLASS, enabled);
  sessionStorage.setItem("muthur-meet-enabled", String(enabled));
}

installHeader();
setEnabled(sessionStorage.getItem("muthur-meet-enabled") !== "false");
classifyControls();
updateClock();

const observer = new MutationObserver(() => {
  installHeader();
  classifyControls();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(updateClock, 1000);

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "m") {
    setEnabled(!document.documentElement.classList.contains(ROOT_CLASS));
  }
});
