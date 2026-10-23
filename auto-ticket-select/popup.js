const $ = (id) => document.getElementById(id);
let tab, host;

function defaultConfig() {
  return { steps: [], refreshSec: 0, waitSec: 10, running: false, attempts: 0, stepIndex: 0 };
}

async function getConfig() {
  const { sites = {} } = await chrome.storage.local.get("sites");
  return Object.assign(defaultConfig(), sites[host] || {});
}

async function saveConfig(patch) {
  const { sites = {} } = await chrome.storage.local.get("sites");
  sites[host] = Object.assign(defaultConfig(), sites[host] || {}, patch);
  await chrome.storage.local.set({ sites });
}

// Make sure the content script is present (tabs opened before install don't have it).
async function send(msg) {
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, msg);
  }
}

function renderSteps(steps) {
  const list = $("steps");
  list.textContent = "";
  steps.forEach((step, i) => {
    const li = $("stepTpl").content.firstElementChild.cloneNode(true);
    const type = li.querySelector(".type");
    const match = li.querySelector(".match");
    const value = li.querySelector(".value");
    const count = li.querySelector(".countIn");

    type.value = step.type;
    match.value = step.match || "exact";
    match.hidden = step.type !== "text";
    value.value = step.type === "text" ? step.text : step.selector;
    count.value = step.count || 1;

    const update = async (patch) => {
      const cfg = await getConfig();
      Object.assign(cfg.steps[i], patch);
      await saveConfig({ steps: cfg.steps });
    };
    type.onchange = async () => {
      await update({ type: type.value });
      load();
    };
    match.onchange = () => update({ match: match.value });
    value.oninput = () => update(type.value === "text" ? { text: value.value } : { selector: value.value });
    count.oninput = () => update({ count: Math.max(1, parseInt(count.value, 10) || 1) });
    li.querySelector(".del").onclick = async () => {
      const cfg = await getConfig();
      cfg.steps.splice(i, 1);
      await saveConfig({ steps: cfg.steps });
      load();
    };
    li.querySelector(".up").onclick = async () => {
      if (i === 0) return;
      const cfg = await getConfig();
      [cfg.steps[i - 1], cfg.steps[i]] = [cfg.steps[i], cfg.steps[i - 1]];
      await saveConfig({ steps: cfg.steps });
      load();
    };
    list.appendChild(li);
  });
  if (!steps.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No steps yet.";
    list.appendChild(li);
  }
}

async function load() {
  const cfg = await getConfig();
  renderSteps(cfg.steps);
  $("waitSec").value = cfg.waitSec;
  $("refreshSec").value = cfg.refreshSec;
  showState(cfg);
}

function showState(cfg) {
  $("state").textContent = cfg.running
    ? `Running… (attempt ${cfg.attempts}, step ${cfg.stepIndex + 1})`
    : cfg.attempts
      ? `Stopped after ${cfg.attempts} attempt(s).`
      : "Idle.";
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab.url);
  } catch (_) {}
  if (!url || !/^https?:$/.test(url.protocol)) {
    document.body.innerHTML = "<p>Open a ticket website first, then click the extension again.</p>";
    return;
  }
  host = url.host;
  $("host").textContent = host;

  $("pick").onclick = async () => {
    await send({ type: "pick" });
    window.close(); // let the user click on the page
  };
  $("addManual").onclick = async () => {
    const cfg = await getConfig();
    cfg.steps.push({ type: "text", text: "", match: "exact", selector: "", count: 1 });
    await saveConfig({ steps: cfg.steps });
    load();
  };
  $("waitSec").oninput = () => saveConfig({ waitSec: Math.max(1, parseInt($("waitSec").value, 10) || 10) });
  $("refreshSec").oninput = () => {
    const v = parseInt($("refreshSec").value, 10) || 0;
    saveConfig({ refreshSec: v > 0 ? Math.max(3, v) : 0 });
  };
  $("start").onclick = async () => {
    const cfg = await getConfig();
    if (!cfg.steps.length) {
      $("state").textContent = "Add at least one step first.";
      return;
    }
    await saveConfig({ running: true, attempts: 0, stepIndex: 0 });
    await send({ type: "start" });
    load();
  };
  $("stop").onclick = async () => {
    await saveConfig({ running: false, stepIndex: 0 });
    await send({ type: "stop" }).catch(() => {});
    load();
  };

  // only refresh the status line live, so typing in a step isn't interrupted
  chrome.storage.onChanged.addListener(async () => showState(await getConfig()));
  load();
}

init();
