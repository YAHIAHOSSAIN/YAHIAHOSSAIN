// Auto Ticket Select - content script
// Runs on every page. When the current site has a running config, it replays
// the recorded steps (click a seat/ticket/class/button), refreshing the page
// on failure if enabled. It never fills payment details or solves captchas.

(() => {
  if (window.__autoTicketSelectLoaded) return;
  window.__autoTicketSelectLoaded = true;

  const HOST = location.host;
  const POLL_MS = 300;
  const MIN_REFRESH_SEC = 3;

  let runToken = 0; // bumps whenever a run is started or stopped

  // ---------- storage helpers ----------

  function defaultConfig() {
    return { steps: [], refreshSec: 0, waitSec: 10, running: false, attempts: 0, stepIndex: 0 };
  }

  async function getConfig() {
    const { sites = {} } = await chrome.storage.local.get("sites");
    return Object.assign(defaultConfig(), sites[HOST] || {});
  }

  async function saveConfig(patch) {
    const { sites = {} } = await chrome.storage.local.get("sites");
    sites[HOST] = Object.assign(defaultConfig(), sites[HOST] || {}, patch);
    await chrome.storage.local.set({ sites });
    return sites[HOST];
  }

  // ---------- UI feedback ----------

  let badge;
  function status(text, color = "#1a73e8") {
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;z-index:2147483647;bottom:12px;right:12px;padding:8px 12px;" +
        "border-radius:8px;color:#fff;font:13px/1.3 system-ui,sans-serif;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:320px;pointer-events:none";
      document.documentElement.appendChild(badge);
    }
    badge.style.background = color;
    badge.textContent = "Auto Ticket: " + text;
  }

  function clearStatus() {
    if (badge) badge.remove();
    badge = null;
  }

  function notify(title, message) {
    chrome.runtime.sendMessage({ type: "notify", title, message }).catch(() => {});
    beep();
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.2;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.15);
      });
    } catch (_) {}
  }

  // ---------- element matching ----------

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function isDisabled(el) {
    return (
      el.disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      /\b(disabled|booked|sold|unavailable|reserved)\b/i.test(el.className || "")
    );
  }

  const CLICKABLE =
    "button, a, input[type=button], input[type=submit], input[type=radio], input[type=checkbox]," +
    " label, [role=button], [role=option], [onclick], td, li, span, div";

  function normalize(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findCandidates(step) {
    let list = [];
    if (step.type === "text") {
      const want = normalize(step.text);
      if (!want) return [];
      const exact = step.match === "exact";
      for (const el of document.querySelectorAll(CLICKABLE)) {
        const txt = normalize(el.innerText || el.value || "");
        if (!txt || txt.length > 200) continue;
        if (exact ? txt === want : txt.includes(want)) list.push(el);
      }
      // keep only the innermost matches so a wrapper div isn't clicked instead of the button
      list = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
    } else {
      try {
        list = [...document.querySelectorAll(step.selector)];
      } catch (_) {
        return [];
      }
    }
    return list.filter((el) => isVisible(el) && !isDisabled(el));
  }

  function clickEl(el) {
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
    if (el.tagName === "SELECT" || el.tagName === "OPTION") el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function captchaPresent() {
    return !!document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile'
    );
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- runner ----------

  async function run() {
    const token = ++runToken;
    const cfg = await getConfig();
    if (!cfg.running || !cfg.steps.length) return;

    const alive = async () => token === runToken && (await getConfig()).running;
    const attempt = cfg.attempts + 1;
    await saveConfig({ attempts: attempt });

    // A click may navigate to a new page; resume from the step we reached.
    const pageStart = Math.min(cfg.stepIndex || 0, cfg.steps.length - 1);

    for (let i = pageStart; i < cfg.steps.length; i++) {
      const step = cfg.steps[i];
      const want = Math.max(1, step.count || 1);
      const label = step.type === "text" ? `"${step.text}"` : step.selector;
      let clicked = 0;
      const deadline = Date.now() + (step.waitSec || cfg.waitSec) * 1000;
      const done = new Set();

      status(`attempt ${attempt} - step ${i + 1}/${cfg.steps.length}: waiting for ${label}`);

      while (clicked < want) {
        if (!(await alive())) return clearStatus();
        if (captchaPresent()) {
          await saveConfig({ running: false });
          status("captcha found - please solve it yourself", "#e37400");
          notify("Captcha detected", `Stopped on ${HOST}. Solve the captcha and continue manually.`);
          return;
        }
        const el = findCandidates(step).find((e) => !done.has(e));
        if (el) {
          done.add(el);
          clickEl(el);
          clicked++;
          await sleep(step.delayMs ?? 400);
          continue;
        }
        if (Date.now() > deadline) break;
        await sleep(POLL_MS);
      }

      if (clicked < want) {
        if (cfg.refreshSec > 0) {
          const sec = Math.max(MIN_REFRESH_SEC, cfg.refreshSec);
          status(`step ${i + 1} not available - refreshing in ${sec}s`, "#c5221f");
          await sleep(sec * 1000);
          if (await alive()) {
            // the refresh undoes clicks made on this page, so redo them
            await saveConfig({ stepIndex: pageStart });
            location.reload();
          }
        } else {
          await saveConfig({ running: false });
          status(`step ${i + 1} not found (${label}) - stopped`, "#c5221f");
          notify("Not found", `Could not find ${label} on ${HOST}.`);
        }
        return;
      }
      await saveConfig({ stepIndex: i + 1 });
    }

    await saveConfig({ running: false, stepIndex: 0 });
    status("done! please review and complete the booking", "#188038");
    notify("Ticket selected!", `All steps finished on ${HOST}. Review and complete payment yourself.`);
  }

  // ---------- element picker ----------

  function cssPath(el) {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
      return "#" + CSS.escape(el.id);
    }
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
        parts.unshift("#" + CSS.escape(el.id));
        break;
      }
      let part = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(" > ");
  }

  function startPicker() {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #e8710a;" +
      "background:rgba(232,113,10,.15);border-radius:3px;transition:all .05s";
    document.documentElement.appendChild(box);
    status("click the seat / ticket / button to record it (Esc to cancel)", "#e8710a");

    const onMove = (e) => {
      const r = e.target.getBoundingClientRect();
      Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    };
    const cleanup = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      box.remove();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
        clearStatus();
      }
    };
    const onClick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      const el = e.target;
      const text = (el.innerText || el.value || "").replace(/\s+/g, " ").trim();
      const step = {
        type: text && text.length <= 40 ? "text" : "selector",
        text: text.slice(0, 80),
        match: "exact",
        selector: cssPath(el),
        count: 1
      };
      const cfg = await getConfig();
      await saveConfig({ steps: [...cfg.steps, step] });
      status(`recorded step ${cfg.steps.length + 1}: ${step.type === "text" ? `"${step.text}"` : step.selector}`, "#188038");
      setTimeout(clearStatus, 2500);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  // ---------- messages from popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "pick") startPicker();
    if (msg.type === "start") run();
    if (msg.type === "stop") {
      runToken++;
      clearStatus();
    }
    if (msg.type === "ping") reply({ host: HOST });
  });

  // resume after a refresh
  run();
})();
