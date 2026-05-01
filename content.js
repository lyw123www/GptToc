(() => {
  "use strict";

  if (window.__GPT_TOC_CONTENT_LOADED__) return;
  window.__GPT_TOC_CONTENT_LOADED__ = true;

  const IDS = {
    panel: "gpt-toc-panel",
  };

  const WIDTH = {
    key: "gptTocWidth",
    default: 300,
    min: 220,
    max: 480,
  };

  const COLLAPSE = {
    key: "gptTocCollapsed",
    default: false,
  };

  const SELECTORS = {
    thread: "#thread",
    userTurn: '#thread section[data-turn="user"]',
    userBubble:
      '[data-message-author-role="user"] .user-message-bubble-color',
    userMessage: '[data-message-author-role="user"]',
    scrollRoot: "[data-scroll-root]",
  };

  const TEXT = {
    panelLabel: "\u0043\u0068\u0061\u0074\u0047\u0050\u0054 \u7528\u6237\u63d0\u95ee\u76ee\u5f55",
    resizeTitle: "\u62d6\u62fd\u8c03\u6574\u76ee\u5f55\u5bbd\u5ea6",
    title: "\u63d0\u95ee\u76ee\u5f55",
    empty: "\u5f53\u524d\u9875\u9762\u8fd8\u6ca1\u6709\u53ef\u5b9a\u4f4d\u7684\u7528\u6237\u63d0\u95ee\u3002",
    collapse: "\u6536\u8d77\u76ee\u5f55",
    expand: "\u5c55\u5f00\u76ee\u5f55",
    tab: "\u76ee\u5f55",
    question: "\u63d0\u95ee",
  };

  const state = {
    panel: null,
    list: null,
    count: null,
    empty: null,
    toggle: null,
    toggleLabel: null,
    toggleIcon: null,
    thread: null,
    scrollRoot: null,
    items: [],
    activeIndex: -1,
    threadObserver: null,
    pageObserver: null,
    rebuildTimer: 0,
    activeTimer: 0,
    urlTimer: 0,
    activeLockUntil: 0,
    stabilizeRunId: 0,
    stabilizeTimers: [],
    lastUrl: location.href,
    isDragging: false,
    dragStartX: 0,
    dragStartWidth: WIDTH.default,
    collapsed: COLLAPSE.default,
    scrollListenerRoot: null,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const cleanText = (text) =>
    (text || "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");

  const truncate = (text, maxLength = 60) => {
    const value = cleanText(text);
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
  };

  const getThread = () => document.querySelector(SELECTORS.thread);

  const getScrollRoot = () =>
    document.querySelector(SELECTORS.scrollRoot) ||
    document.scrollingElement ||
    document.documentElement;

  const getStorage = () => globalThis.chrome?.storage?.local || null;

  const readSettings = () =>
    new Promise((resolve) => {
      const fallback = () => {
        let width = WIDTH.default;
        let collapsed = COLLAPSE.default;

        try {
          width = Number(localStorage.getItem(WIDTH.key)) || WIDTH.default;
          collapsed = localStorage.getItem(COLLAPSE.key) === "true";
        } catch {
          // ignore localStorage errors
        }

        resolve({
          width: clamp(width, WIDTH.min, WIDTH.max),
          collapsed,
        });
      };

      const storage = getStorage();
      if (!storage) {
        fallback();
        return;
      }

      try {
        storage.get(
          {
            [WIDTH.key]: WIDTH.default,
            [COLLAPSE.key]: COLLAPSE.default,
          },
          (result) => {
            if (globalThis.chrome?.runtime?.lastError) {
              fallback();
              return;
            }

            resolve({
              width: clamp(
                Number(result?.[WIDTH.key]) || WIDTH.default,
                WIDTH.min,
                WIDTH.max,
              ),
              collapsed: Boolean(result?.[COLLAPSE.key]),
            });
          },
        );
      } catch {
        fallback();
      }
    });

  const saveSettings = (partial) => {
    const storage = getStorage();
    const data = {};

    if (Object.prototype.hasOwnProperty.call(partial, "width")) {
      data[WIDTH.key] = clamp(Math.round(partial.width), WIDTH.min, WIDTH.max);
    }

    if (Object.prototype.hasOwnProperty.call(partial, "collapsed")) {
      data[COLLAPSE.key] = Boolean(partial.collapsed);
    }

    try {
      if (storage) {
        storage.set(data);
        return;
      }
    } catch {
      // fall back to localStorage
    }

    try {
      if (Object.prototype.hasOwnProperty.call(data, WIDTH.key)) {
        localStorage.setItem(WIDTH.key, String(data[WIDTH.key]));
      }
      if (Object.prototype.hasOwnProperty.call(data, COLLAPSE.key)) {
        localStorage.setItem(COLLAPSE.key, String(data[COLLAPSE.key]));
      }
    } catch {
      // ignore persistence errors
    }
  };

  const applyWidth = (width) => {
    if (!state.panel) return;
    state.panel.style.width = `${clamp(Math.round(width), WIDTH.min, WIDTH.max)}px`;
  };

  const createPanel = async () => {
    if (state.panel && document.body.contains(state.panel)) return;

    const panel = document.createElement("aside");
    panel.id = IDS.panel;
    panel.setAttribute("aria-label", TEXT.panelLabel);

    panel.innerHTML = `
      <button class="gpt-toc-toggle" type="button">
        <span class="gpt-toc-toggle-icon" aria-hidden="true">›</span>
        <span class="gpt-toc-toggle-label">${TEXT.tab}</span>
      </button>
      <div class="gpt-toc-resizer" title="${TEXT.resizeTitle}" aria-hidden="true"></div>
      <div class="gpt-toc-header">
        <div class="gpt-toc-title">${TEXT.title}</div>
        <div class="gpt-toc-count">0</div>
      </div>
      <div class="gpt-toc-list" role="navigation" aria-label="${TEXT.panelLabel}">
        <div class="gpt-toc-empty">${TEXT.empty}</div>
      </div>
    `;

    document.body.appendChild(panel);

    state.panel = panel;
    state.list = panel.querySelector(".gpt-toc-list");
    state.count = panel.querySelector(".gpt-toc-count");
    state.empty = panel.querySelector(".gpt-toc-empty");
    state.toggle = panel.querySelector(".gpt-toc-toggle");
    state.toggleLabel = panel.querySelector(".gpt-toc-toggle-label");
    state.toggleIcon = panel.querySelector(".gpt-toc-toggle-icon");

    const settings = await readSettings();
    state.collapsed = settings.collapsed;
    applyWidth(settings.width);
    applyCollapsed();

    panel
      .querySelector(".gpt-toc-resizer")
      ?.addEventListener("pointerdown", onResizePointerDown);
    state.toggle?.addEventListener("click", toggleCollapsed);
  };

  const applyCollapsed = () => {
    if (!state.panel || !state.toggle) return;

    state.panel.classList.toggle("gpt-toc-collapsed", state.collapsed);
    state.toggle.setAttribute(
      "aria-label",
      state.collapsed ? TEXT.expand : TEXT.collapse,
    );
    state.toggle.title = state.collapsed ? TEXT.expand : TEXT.collapse;

    if (state.toggleIcon) {
      state.toggleIcon.textContent = state.collapsed ? "‹" : "›";
    }

    updateCollapsedLabel();
  };

  const updateCollapsedLabel = () => {
    if (!state.toggleLabel) return;
    const count = state.items.length;
    state.toggleLabel.textContent = state.collapsed
      ? `${TEXT.tab} ${count}`
      : TEXT.tab;
  };

  const toggleCollapsed = () => {
    state.collapsed = !state.collapsed;
    applyCollapsed();
    saveSettings({ collapsed: state.collapsed });
  };

  const onResizePointerDown = (event) => {
    if (!state.panel || state.collapsed) return;

    state.isDragging = true;
    state.dragStartX = event.clientX;
    state.dragStartWidth = state.panel.getBoundingClientRect().width;
    state.panel.classList.add("gpt-toc-dragging");

    event.preventDefault();
    document.addEventListener("pointermove", onResizePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", onResizePointerUp, { once: true });
    document.addEventListener("pointercancel", onResizePointerUp, { once: true });
  };

  const onResizePointerMove = (event) => {
    if (!state.isDragging) return;

    event.preventDefault();
    const delta = state.dragStartX - event.clientX;
    applyWidth(state.dragStartWidth + delta);
  };

  const onResizePointerUp = () => {
    if (!state.isDragging || !state.panel) return;

    state.isDragging = false;
    state.panel.classList.remove("gpt-toc-dragging");
    document.removeEventListener("pointermove", onResizePointerMove);
    saveSettings({ width: state.panel.getBoundingClientRect().width });
  };

  const extractTurnText = (turn) => {
    const textNode =
      turn.querySelector(SELECTORS.userBubble) ||
      turn.querySelector(SELECTORS.userMessage) ||
      turn;

    return cleanText(textNode.innerText || textNode.textContent || "");
  };

  const getTurnKey = (turn, index) => {
    const message = turn.querySelector(SELECTORS.userMessage);
    return (
      turn.getAttribute("data-turn-id") ||
      message?.getAttribute("data-message-id") ||
      `user-turn-${index + 1}`
    );
  };

  const collectItems = () => {
    const turns = Array.from(document.querySelectorAll(SELECTORS.userTurn));

    return turns.map((turn, index) => {
      const rawText = extractTurnText(turn);
      return {
        index,
        key: getTurnKey(turn, index),
        turn,
        text: truncate(rawText || `${TEXT.question} ${index + 1}`),
      };
    });
  };

  const renderList = () => {
    if (!state.list || !state.count) return;

    const previousListScrollTop = state.list.scrollTop;
    const previousActiveKey =
      state.activeIndex >= 0 ? state.items[state.activeIndex]?.key : null;
    const nextItems = collectItems();
    const sameList =
      nextItems.length === state.items.length &&
      nextItems.every(
        (item, index) =>
          item.key === state.items[index]?.key &&
          item.text === state.items[index]?.text,
      );

    state.items = nextItems;
    state.count.textContent = String(state.items.length);
    updateCollapsedLabel();

    if (!sameList) {
      const fragment = document.createDocumentFragment();
      if (state.empty) fragment.appendChild(state.empty);

      state.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gpt-toc-item";
        button.dataset.index = String(item.index);
        button.title = item.text;

        const indexSpan = document.createElement("span");
        indexSpan.className = "gpt-toc-index";
        indexSpan.textContent = String(item.index + 1);

        const textSpan = document.createElement("span");
        textSpan.className = "gpt-toc-text";
        textSpan.textContent = item.text;

        button.append(indexSpan, textSpan);
        button.addEventListener("click", () => scrollToItem(item.index));
        fragment.appendChild(button);
      });

      state.list.replaceChildren(fragment);
      state.list.classList.toggle("gpt-toc-is-empty", state.items.length === 0);

      requestAnimationFrame(() => {
        if (state.list) state.list.scrollTop = previousListScrollTop;
      });
    }

    state.activeIndex = previousActiveKey
      ? state.items.findIndex((item) => item.key === previousActiveKey)
      : state.activeIndex;

    setupScrollListeners();
    requestActiveUpdate();
  };

  const setActive = (index, options = {}) => {
    const alreadyActive = state.activeIndex === index;
    state.activeIndex = index;
    if (!state.list) return;

    state.list.querySelectorAll(".gpt-toc-item.gpt-toc-active").forEach((node) => {
      if (Number(node.dataset.index) !== index) {
        node.classList.remove("gpt-toc-active");
      }
    });

    const activeButton = state.list.querySelector(
      `.gpt-toc-item[data-index="${index}"]`,
    );

    if (!activeButton) return;

    activeButton.classList.add("gpt-toc-active");
    if (!alreadyActive && options.scrollList) {
      activeButton.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
    }
  };

  const getRootMetrics = () => {
    const root = state.scrollRoot || getScrollRoot();
    if (root === document.scrollingElement || root === document.documentElement) {
      return {
        root,
        top: 0,
        height: window.innerHeight,
      };
    }

    const rect = root.getBoundingClientRect();
    return {
      root,
      top: rect.top,
      height: root.clientHeight || rect.height,
    };
  };

  const updateActiveByPosition = () => {
    if (Date.now() < state.activeLockUntil) return;

    if (!state.items.length) {
      setActive(-1);
      return;
    }

    const metrics = getRootMetrics();
    const anchorY = metrics.top + Math.min(metrics.height * 0.28, 220);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const item of state.items) {
      if (!document.body.contains(item.turn)) continue;

      const rect = item.turn.getBoundingClientRect();
      const distance = Math.abs(rect.top - anchorY);
      const passedAnchor = rect.top <= anchorY;

      if (passedAnchor && distance < bestDistance) {
        bestIndex = item.index;
        bestDistance = distance;
      }
    }

    if (bestDistance === Number.POSITIVE_INFINITY) {
      for (const item of state.items) {
        if (!document.body.contains(item.turn)) continue;

        const rect = item.turn.getBoundingClientRect();
        const distance = Math.abs(rect.top - anchorY);
        if (distance < bestDistance) {
          bestIndex = item.index;
          bestDistance = distance;
        }
      }
    }

    setActive(bestIndex);
  };

  const requestActiveUpdate = () => {
    window.clearTimeout(state.activeTimer);
    state.activeTimer = window.setTimeout(updateActiveByPosition, 80);
  };

  const setupScrollListeners = () => {
    state.scrollRoot = getScrollRoot();

    if (state.scrollListenerRoot !== state.scrollRoot) {
      state.scrollListenerRoot?.removeEventListener?.("scroll", requestActiveUpdate);
      state.scrollListenerRoot = state.scrollRoot;
      state.scrollListenerRoot?.addEventListener?.("scroll", requestActiveUpdate, {
        passive: true,
      });
    }

    window.removeEventListener("resize", requestActiveUpdate);
    window.addEventListener("resize", requestActiveUpdate, { passive: true });
  };

  const TARGET_OFFSET = 76;
  const STABILIZE_THRESHOLD = 10;
  const STABILIZE_DELAYS = [80, 220, 500, 900, 1400];

  const getCurrentScrollTop = (scroller) => {
    if (scroller === window) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    return scroller.scrollTop;
  };

  const measureTargetOffset = (targetTurn) => {
    const scrollRoot = getScrollRoot();

    if (
      scrollRoot &&
      scrollRoot !== document.scrollingElement &&
      scrollRoot !== document.documentElement
    ) {
      const rootRect = scrollRoot.getBoundingClientRect();
      const targetRect = targetTurn.getBoundingClientRect();
      const currentTop = scrollRoot.scrollTop;
      const offset = targetRect.top - rootRect.top - TARGET_OFFSET;

      return {
        scroller: scrollRoot,
        offset,
        targetTop: Math.max(0, currentTop + offset),
        currentTop,
      };
    }

    const currentTop = window.scrollY || document.documentElement.scrollTop || 0;
    const offset = targetTurn.getBoundingClientRect().top - TARGET_OFFSET;

    return {
      scroller: window,
      offset,
      targetTop: Math.max(0, currentTop + offset),
      currentTop,
    };
  };

  const scrollTargetIntoPlace = (targetTurn, behavior = "auto") => {
    const measurement = measureTargetOffset(targetTurn);
    measurement.scroller.scrollTo({
      top: measurement.targetTop,
      behavior,
    });

    return measurement;
  };

  const clearStabilizeTimers = () => {
    state.stabilizeTimers.forEach((timer) => window.clearTimeout(timer));
    state.stabilizeTimers = [];
  };

  const stabilizeScroll = (item, initialBehavior) => {
    clearStabilizeTimers();
    const runId = ++state.stabilizeRunId;
    const lockMs = Math.max(...STABILIZE_DELAYS) + 450;
    state.activeLockUntil = Date.now() + lockMs;

    const firstMeasurement = scrollTargetIntoPlace(item.turn, initialBehavior);

    STABILIZE_DELAYS.forEach((delay, stepIndex) => {
      const timer = window.setTimeout(() => {
        if (runId !== state.stabilizeRunId) return;
        if (!document.body.contains(item.turn)) return;

        setActive(item.index);

        const measurement = measureTargetOffset(item.turn);
        if (Math.abs(measurement.offset) > STABILIZE_THRESHOLD) {
          scrollTargetIntoPlace(item.turn, "auto");
        }

        if (stepIndex === STABILIZE_DELAYS.length - 1) {
          state.activeLockUntil = 0;
          requestActiveUpdate();
        }
      }, delay);

      state.stabilizeTimers.push(timer);
    });

    return firstMeasurement;
  };

  const scrollToItem = (index) => {
    const item = state.items[index];
    if (!item?.turn) return;

    const plan = measureTargetOffset(item.turn);
    const distance = Math.abs(plan.targetTop - getCurrentScrollTop(plan.scroller));
    const behavior = distance > 2500 ? "auto" : "smooth";

    highlightTurn(item.turn);
    setActive(index);
    stabilizeScroll(item, behavior);
  };

  const highlightTurn = (turn) => {
    turn.classList.add("gpt-toc-target-highlight");
    window.setTimeout(() => {
      turn.classList.remove("gpt-toc-target-highlight");
    }, 1400);
  };

  const scheduleRebuild = (delay = 300) => {
    window.clearTimeout(state.rebuildTimer);
    state.rebuildTimer = window.setTimeout(() => {
      bindThreadObserver();
      renderList();
    }, delay);
  };

  const isUserNode = (node) => {
    if (!(node instanceof Element)) return false;
    return (
      node.matches(SELECTORS.userTurn) ||
      node.matches(SELECTORS.userMessage) ||
      Boolean(node.querySelector?.(SELECTORS.userTurn)) ||
      Boolean(node.querySelector?.(SELECTORS.userMessage))
    );
  };

  const shouldRebuildFromThreadMutations = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (isUserNode(mutation.target) || mutation.target.closest?.(SELECTORS.userTurn)) {
          return true;
        }
      }

      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (isUserNode(node)) return true;
        }
        for (const node of mutation.removedNodes) {
          if (isUserNode(node)) return true;
        }
      }
    }

    return false;
  };

  const bindThreadObserver = () => {
    const thread = getThread();
    if (thread === state.thread) return;

    state.threadObserver?.disconnect();
    state.thread = thread;

    if (!thread) return;

    state.threadObserver = new MutationObserver((mutations) => {
      if (shouldRebuildFromThreadMutations(mutations)) {
        scheduleRebuild(350);
      }
    });

    state.threadObserver.observe(thread, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-turn", "data-message-author-role", "data-message-id"],
    });
  };

  const setupPageObserver = () => {
    if (state.pageObserver || !document.body) return;

    state.pageObserver = new MutationObserver(() => {
      window.clearTimeout(state.urlTimer);
      state.urlTimer = window.setTimeout(() => {
        bindThreadObserver();
        if (!state.thread) scheduleRebuild(300);
      }, 250);
    });

    state.pageObserver.observe(document.body, {
      childList: true,
      subtree: false,
    });
  };

  const onRouteMaybeChanged = () => {
    if (state.lastUrl === location.href) return;

    state.lastUrl = location.href;
    state.thread = null;
    state.threadObserver?.disconnect();
    state.threadObserver = null;
    scheduleRebuild(300);
  };

  const installRouteWatchers = () => {
    window.addEventListener("popstate", onRouteMaybeChanged);
    window.addEventListener("hashchange", onRouteMaybeChanged);
    window.setInterval(onRouteMaybeChanged, 700);
  };

  const init = async () => {
    await createPanel();
    installRouteWatchers();
    setupPageObserver();
    bindThreadObserver();
    renderList();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
