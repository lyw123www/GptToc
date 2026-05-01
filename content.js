(() => {
  "use strict";

  if (window.__GPT_TOC_CONTENT_LOADED__) return;
  window.__GPT_TOC_CONTENT_LOADED__ = true;

  const IDS = {
    panel: "gpt-toc-panel",
    exportButton: "gpt-toc-export-button",
    toast: "gpt-toc-toast",
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
    assistantTurn: '#thread section[data-turn="assistant"]',
    userBubble:
      '[data-message-author-role="user"] .user-message-bubble-color',
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    message: '[data-message-author-role]',
    contentRoot:
      '.markdown, [class*="markdown"], [class*="prose"], .whitespace-pre-wrap, [class*="whitespace-pre-wrap"], article',
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
    export: "\u5bfc\u51fa",
    exportTitle: "\u5bfc\u51fa Markdown",
    exporting: "\u5bfc\u51fa\u4e2d...",
    downloading: "\u4e0b\u8f7d\u4e2d...",
    exportDone: "\u5df2\u5bfc\u51fa",
    exportFailed: "\u5bfc\u51fa\u5931\u8d25",
    noHeadings: "\u672c\u8f6e\u56de\u590d\u6682\u65e0\u5b50\u6807\u9898",
    expandChildren: "\u5c55\u5f00\u5b50\u6807\u9898",
    collapseChildren: "\u6536\u8d77\u5b50\u6807\u9898",
  };

  const ACTION_NOISE_PATTERN =
    /(copy|edit|regenerate|share|branch|retry|more|read aloud|copy code|good response|bad response|复制|编辑|重新生成|分享|分支|重试|更多|朗读|导出|开始听写|启动语音功能|关闭|show more|expand|continue generating|显示更多|展开|继续生成)/i;
  const FILE_EXTENSION_PATTERN = "(?:md|pdf|txt|docx?|xlsx?|csv|pptx?)";
  const TOOL_PAYLOAD_PATTERN =
    /^\s*\{[\s\S]{0,4000}"(?:queries|query|open|click|find|pointers|search_query|image_query|weather|finance|sports)"[\s\S]*\}\s*$/i;

  const state = {
    panel: null,
    list: null,
    count: null,
    empty: null,
    toggle: null,
    toggleLabel: null,
    toggleIcon: null,
    exportButton: null,
    thread: null,
    scrollRoot: null,
    items: [],
    activeIndex: -1,
    expandedKey: null,
    manualCollapsedKey: null,
    exporting: false,
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

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

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
        <div class="gpt-toc-title-row">
          <div class="gpt-toc-title">${TEXT.title}</div>
          <button class="gpt-toc-export-button" id="${IDS.exportButton}" type="button" title="${escapeHtml(TEXT.exportTitle)}" aria-label="${escapeHtml(TEXT.exportTitle)}" data-state="idle">
            <svg class="gpt-toc-export-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 3.75h6.9l4.35 4.35V17A2.25 2.25 0 0 1 16 19.25H7A2.25 2.25 0 0 1 4.75 17V6A2.25 2.25 0 0 1 7 3.75Z" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="1.5"/>
              <path d="M13.9 3.75v3.1a1.25 1.25 0 0 0 1.25 1.25h3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 12.1h8M8 15.4h5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span class="gpt-toc-export-spinner" aria-hidden="true"></span>
            <span class="gpt-toc-export-text">${escapeHtml(TEXT.export)}</span>
          </button>
        </div>
        <div class="gpt-toc-count">0</div>
      </div>
      <div class="gpt-toc-list" role="navigation" aria-label="${escapeHtml(TEXT.panelLabel)}">
        <div class="gpt-toc-empty">${escapeHtml(TEXT.empty)}</div>
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
    state.exportButton = panel.querySelector(".gpt-toc-export-button");

    const settings = await readSettings();
    state.collapsed = settings.collapsed;
    applyWidth(settings.width);
    applyCollapsed();

    panel
      .querySelector(".gpt-toc-resizer")
      ?.addEventListener("pointerdown", onResizePointerDown);
    state.toggle?.addEventListener("click", toggleCollapsed);
    state.exportButton?.addEventListener("click", handleExportClick);
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

  const getTurnRole = (turn) => {
    if (!(turn instanceof Element)) return "";
    const explicit = turn.getAttribute("data-turn");
    if (explicit) return explicit;
    const message = turn.querySelector(SELECTORS.message);
    return message?.getAttribute("data-message-author-role") || "";
  };

  const findAssistantTurnForUser = (userTurn) => {
    let node = userTurn?.nextElementSibling || null;
    while (node) {
      const role = getTurnRole(node);
      if (role === "assistant") return node;
      if (role === "user") return null;
      node = node.nextElementSibling;
    }
    return null;
  };

  const getContentRoot = (messageElement) => {
    if (!messageElement) return null;
    const candidates = Array.from(
      messageElement.querySelectorAll(SELECTORS.contentRoot),
    );
    if (!candidates.length) return messageElement;

    candidates.sort(
      (a, b) =>
        (b.innerText || b.textContent || "").length -
        (a.innerText || a.textContent || "").length,
    );
    return candidates[0];
  };

  const isVisibleElement = (element) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const hasBlockDescendant = (element) =>
    Boolean(
      element.querySelector?.(
        "p, ul, ol, pre, table, blockquote, h1, h2, h3, h4, h5, h6",
      ),
    );

  const extractHeadingText = (element) =>
    cleanText(element?.innerText || element?.textContent || "");

  const collectRenderedHeadings = (assistantTurn) => {
    const message =
      assistantTurn?.querySelector(SELECTORS.assistantMessage) || assistantTurn;
    const root = getContentRoot(message);
    if (!root) return [];

    const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .map((element) => {
        const level = Number(element.tagName.slice(1)) || 2;
        return {
          key: "",
          text: truncate(extractHeadingText(element), 72),
          level,
          target: element,
        };
      })
      .filter((heading) => heading.text && isVisibleElement(heading.target));

    return headings;
  };

  const collectStrongHeadings = (assistantTurn) => {
    const message =
      assistantTurn?.querySelector(SELECTORS.assistantMessage) || assistantTurn;
    const root = getContentRoot(message);
    if (!root) return [];

    const seen = new Set();
    const candidates = Array.from(
      root.querySelectorAll(
        "p strong, p b, li > strong:first-child, li > b:first-child",
      ),
    );

    return candidates
      .map((element) => {
        const container = element.closest("p, li") || element;
        const text = extractHeadingText(element).replace(/[：:]\s*$/u, "");
        if (!text || text.length > 44 || hasBlockDescendant(element)) return null;
        const containerText = extractHeadingText(container);
        if (containerText.length > Math.max(90, text.length + 45)) return null;
        if (seen.has(text)) return null;
        seen.add(text);
        return {
          key: "",
          text: truncate(text, 72),
          level: 3,
          target: container,
        };
      })
      .filter(Boolean)
      .filter((heading) => isVisibleElement(heading.target));
  };

  const collectChildHeadings = (assistantTurn, parentKey) => {
    const baseHeadings = collectRenderedHeadings(assistantTurn);
    const headings = baseHeadings.length
      ? baseHeadings
      : collectStrongHeadings(assistantTurn);

    return headings.map((heading, index) => ({
      ...heading,
      key: `${parentKey}-heading-${index + 1}`,
      index,
    }));
  };

  const collectItems = () => {
    const turns = Array.from(document.querySelectorAll(SELECTORS.userTurn));

    return turns.map((turn, index) => {
      const rawText = extractTurnText(turn);
      const key = getTurnKey(turn, index);
      const assistantTurn = findAssistantTurnForUser(turn);
      return {
        index,
        key,
        turn,
        assistantTurn,
        text: truncate(rawText || `${TEXT.question} ${index + 1}`),
        children: collectChildHeadings(assistantTurn, key),
      };
    });
  };

  const renderList = () => {
    if (!state.list || !state.count) return;

    const previousListScrollTop = state.list.scrollTop;
    const previousExpandedKey = state.expandedKey;
    const previousActiveKey =
      state.activeIndex >= 0 ? state.items[state.activeIndex]?.key : null;
    const nextItems = collectItems();
    const sameList =
      nextItems.length === state.items.length &&
      nextItems.every(
        (item, index) =>
          item.key === state.items[index]?.key &&
          item.text === state.items[index]?.text &&
          item.children.length === state.items[index]?.children?.length &&
          item.children.every(
            (child, childIndex) =>
              child.text === state.items[index]?.children?.[childIndex]?.text &&
              child.level === state.items[index]?.children?.[childIndex]?.level,
          ),
      );

    state.items = nextItems;
    state.count.textContent = String(state.items.length);
    updateCollapsedLabel();

    if (
      previousExpandedKey &&
      !state.items.some((item) => item.key === previousExpandedKey)
    ) {
      state.expandedKey = null;
    }

    if (!sameList) {
      const fragment = document.createDocumentFragment();
      if (state.empty) fragment.appendChild(state.empty);

      state.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "gpt-toc-row";
        row.dataset.index = String(item.index);
        row.dataset.key = item.key;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "gpt-toc-item";
        button.title = item.text;

        const indexSpan = document.createElement("span");
        indexSpan.className = "gpt-toc-index";
        indexSpan.textContent = String(item.index + 1);

        const textSpan = document.createElement("span");
        textSpan.className = "gpt-toc-text";
        textSpan.textContent = item.text;

        button.append(indexSpan, textSpan);
        button.addEventListener("click", () => scrollToItem(item.index));

        const foldButton = document.createElement("button");
        foldButton.type = "button";
        foldButton.className = "gpt-toc-fold";
        foldButton.dataset.index = String(item.index);
        foldButton.setAttribute("aria-label", TEXT.expandChildren);
        foldButton.title = item.children.length
          ? TEXT.expandChildren
          : TEXT.noHeadings;
        foldButton.disabled = item.children.length === 0;
        foldButton.innerHTML = `<span aria-hidden="true">›</span>`;
        foldButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleItemChildren(item.index);
        });

        row.append(button, foldButton);
        fragment.appendChild(row);

        const children = document.createElement("div");
        children.className = "gpt-toc-children";
        children.dataset.parentKey = item.key;
        children.setAttribute("role", "group");

        item.children.forEach((child) => {
          const childButton = document.createElement("button");
          childButton.type = "button";
          childButton.className = "gpt-toc-child";
          childButton.dataset.parentIndex = String(item.index);
          childButton.dataset.childIndex = String(child.index);
          childButton.style.setProperty(
            "--gpt-toc-child-indent",
            `${Math.max(0, child.level - 1) * 10}px`,
          );
          childButton.title = child.text;
          childButton.textContent = child.text;
          childButton.addEventListener("click", () =>
            scrollToChildHeading(item.index, child.index),
          );
          children.appendChild(childButton);
        });

        fragment.appendChild(children);
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

    syncExpandedDom();

    setupScrollListeners();
    requestActiveUpdate();
  };

  const getItemByIndex = (index) =>
    state.items.find((item) => item.index === index);

  const syncExpandedDom = () => {
    if (!state.list) return;

    state.list.querySelectorAll(".gpt-toc-row").forEach((row) => {
      const isExpanded = row.dataset.key === state.expandedKey;
      const index = Number(row.dataset.index);
      const item = getItemByIndex(index);

      row.classList.toggle("gpt-toc-expanded", isExpanded);

      const foldButton = row.querySelector(".gpt-toc-fold");
      if (foldButton) {
        foldButton.setAttribute(
          "aria-expanded",
          isExpanded ? "true" : "false",
        );
        foldButton.setAttribute(
          "aria-label",
          isExpanded ? TEXT.collapseChildren : TEXT.expandChildren,
        );
        foldButton.title = item?.children?.length
          ? isExpanded
            ? TEXT.collapseChildren
            : TEXT.expandChildren
          : TEXT.noHeadings;
      }
    });

    state.list.querySelectorAll(".gpt-toc-children").forEach((children) => {
      children.classList.toggle(
        "gpt-toc-expanded",
        children.dataset.parentKey === state.expandedKey,
      );
    });
  };

  const expandItem = (item, options = {}) => {
    if (!item?.children?.length) {
      if (options.collapseOthers) {
        state.expandedKey = null;
      } else if (options.forceCollapseEmpty && state.expandedKey === item?.key) {
        state.expandedKey = null;
      }
      syncExpandedDom();
      return;
    }

    if (state.manualCollapsedKey === item.key && !options.manual && !options.force) {
      return;
    }

    state.expandedKey = item.key;
    if (options.manual || options.force) {
      state.manualCollapsedKey = null;
    }
    syncExpandedDom();
  };

  const collapseItem = (item, options = {}) => {
    if (state.expandedKey === item?.key) {
      state.expandedKey = null;
    }
    if (options.manual && item?.key) {
      state.manualCollapsedKey = item.key;
    }
    syncExpandedDom();
  };

  const toggleItemChildren = (index) => {
    const item = getItemByIndex(index);
    if (!item?.children?.length) return;

    if (state.expandedKey === item.key) {
      collapseItem(item, { manual: true });
      return;
    }

    expandItem(item, { manual: true, force: true });
  };

  const setActive = (index, options = {}) => {
    const alreadyActive = state.activeIndex === index;
    state.activeIndex = index;
    if (!state.list) return;

    state.list.querySelectorAll(".gpt-toc-row.gpt-toc-active").forEach((node) => {
      if (Number(node.dataset.index) !== index) {
        node.classList.remove("gpt-toc-active");
      }
    });

    const activeRow = state.list.querySelector(
      `.gpt-toc-row[data-index="${index}"]`,
    );

    if (!activeRow) return;

    activeRow.classList.add("gpt-toc-active");

    if (!alreadyActive) {
      const item = getItemByIndex(index);
      if (!item || state.manualCollapsedKey !== item.key) {
        state.manualCollapsedKey = null;
      }
      expandItem(item, { collapseOthers: true });
    }

    if (!alreadyActive && options.scrollList) {
      activeRow.scrollIntoView({
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
    expandItem(item, { force: true });
    setActive(index);
    stabilizeScroll(item, behavior);
  };

  const scrollToChildHeading = (parentIndex, childIndex) => {
    const item = getItemByIndex(parentIndex);
    const child = item?.children?.[childIndex];
    if (!item || !child?.target || !document.body.contains(child.target)) return;

    expandItem(item, { force: true });
    setActive(parentIndex, { scrollList: true });

    const plan = measureTargetOffset(child.target);
    const distance = Math.abs(plan.targetTop - getCurrentScrollTop(plan.scroller));
    const behavior = distance > 2500 ? "auto" : "smooth";

    plan.scroller.scrollTo({
      top: plan.targetTop,
      behavior,
    });
    window.setTimeout(() => {
      if (document.body.contains(child.target)) {
        scrollTargetIntoPlace(child.target, "auto");
      }
    }, behavior === "smooth" ? 380 : 80);
    highlightHeading(child.target);
  };

  const highlightTurn = (turn) => {
    turn.classList.add("gpt-toc-target-highlight");
    window.setTimeout(() => {
      turn.classList.remove("gpt-toc-target-highlight");
    }, 1400);
  };

  const highlightHeading = (heading) => {
    heading.classList.add("gpt-toc-heading-highlight");
    window.setTimeout(() => {
      heading.classList.remove("gpt-toc-heading-highlight");
    }, 1400);
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const normalizePlainText = (text) =>
    (text || "")
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const sanitizeFileName = (name) => {
    const fallback = "chatgpt-export";
    const value = normalizePlainText(name)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (value || fallback).slice(0, 120);
  };

  const escapeYamlString = (value) => JSON.stringify(String(value || ""));

  const expandAllCollapsedContent = () => {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) {
      if (state.panel?.contains(button)) continue;
      const label = `${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`.trim();
      if (
        ACTION_NOISE_PATTERN.test(label) &&
        /(show more|expand|continue generating|显示更多|展开|继续生成)/i.test(label)
      ) {
        try {
          button.click();
        } catch {
          // ignore unavailable page buttons
        }
      }
    }
  };

  const removeNoiseNodes = (root) => {
    const removableSelectors = [
      `#${IDS.panel}`,
      `#${IDS.toast}`,
      "script",
      "style",
      ".sr-only",
    ];

    for (const selector of removableSelectors) {
      root.querySelectorAll(selector).forEach((element) => element.remove());
    }

    stripCitationChips(root);
    root.querySelectorAll('[class*="toolbar"]').forEach((element) => element.remove());

    root.querySelectorAll("button").forEach((button) => {
      const label = `${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`.trim();
      if (!label || ACTION_NOISE_PATTERN.test(label)) button.remove();
    });

    root.querySelectorAll("a").forEach((anchor) => {
      if (!normalizeChipText(anchor.innerText || anchor.textContent || "")) {
        anchor.remove();
      }
    });
  };

  const normalizeChipText = (text) =>
    normalizePlainText(text || "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s*\+\s*(\d+)/g, "+$1")
      .replace(/\s+/g, " ")
      .trim();

  const stripCitationChips = (root) => {
    const removals = new Set();

    root.querySelectorAll('[data-testid*="citation"]').forEach((element) => {
      removals.add(
        element.closest("a") ||
          element.closest('[aria-haspopup="dialog"][data-state]') ||
          element,
      );
    });

    root.querySelectorAll('[aria-haspopup="dialog"][data-state]').forEach((element) => {
      const text = normalizeChipText(element.innerText || element.textContent || "");
      if (!text || text.length > 160) return;
      removals.add(element);
    });

    removals.forEach((element) => element?.remove?.());
  };

  const getTextContent = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || "";
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();
      if (tag === "br") text += "\n";
      else if (tag === "strong" || tag === "b") text += `**${getTextContent(child)}**`;
      else if (tag === "em" || tag === "i") text += `*${getTextContent(child)}*`;
      else if (
        tag === "code" &&
        child.parentElement &&
        child.parentElement.tagName.toLowerCase() !== "pre"
      ) {
        text += `\`${getTextContent(child)}\``;
      } else {
        text += getTextContent(child);
      }
    }
    return text;
  };

  const getPreformattedText = (node) => {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";

    let text = "";
    for (const child of node.childNodes) text += getPreformattedText(child);

    const className =
      typeof node.className === "string"
        ? node.className
        : node.getAttribute("class") || "";
    const isLineWrapper =
      /^(div|p|li|tr)$/.test(tag) ||
      /\b(?:line|token-line|code-line|view-line)\b/i.test(className);

    if (isLineWrapper && text && !text.endsWith("\n")) text += "\n";
    return text;
  };

  const extractLanguage = (codeElement) => {
    const classes = (codeElement.className || "").split(/\s+/);
    for (const className of classes) {
      if (className.startsWith("language-")) return className.slice(9);
      if (className.startsWith("lang-")) return className.slice(5);
    }
    return "";
  };

  const prefixLines = (text, prefix) =>
    text
      .split("\n")
      .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
      .join("\n");

  const processTable = (tableNode) => {
    const rows = Array.from(tableNode.querySelectorAll("tr"));
    if (!rows.length) return "";

    let result = "\n";
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      result += `| ${cells.map((cell) => getTextContent(cell).trim()).join(" | ")} |\n`;
      if (rowIndex === 0) {
        result += `| ${cells.map(() => "---").join(" | ")} |\n`;
      }
    });

    return `${result}\n`;
  };

  const processListItems = (listNode, isOrdered, depth) => {
    let result = "";
    let index = 1;
    const items = Array.from(listNode.children).filter(
      (child) => child.tagName.toLowerCase() === "li",
    );

    for (const item of items) {
      const taskCheckbox = item.querySelector?.('input[type="checkbox"]');
      const marker = isOrdered ? `${index}. ` : "- ";
      const indent = "  ".repeat(depth);
      let content = "";

      for (const child of item.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          content += child.textContent || "";
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();
          if (tag === "ul" || tag === "ol") {
            content += `\n${processListItems(child, tag === "ol", depth + 1)}`;
          } else {
            content += processNode(child, depth);
          }
        }
      }

      const lines = normalizePlainText(content).split("\n");
      if (lines[0]) {
        const taskPrefix = taskCheckbox
          ? taskCheckbox.checked
            ? "[x] "
            : "[ ] "
          : "";
        result += `${indent}${marker}${taskPrefix}${lines[0]}\n`;
        for (let i = 1; i < lines.length; i += 1) {
          if (!lines[i]) continue;
          result += `${indent}  ${lines[i]}\n`;
        }
      }

      index += 1;
    }

    return result;
  };

  const processChildren = (node, depth) => {
    let result = "";
    for (const child of node.childNodes) result += processNode(child, depth);
    return result;
  };

  const shouldKeepImageNode = (node) => {
    const alt = normalizePlainText(node.getAttribute("alt") || "");
    const src = normalizePlainText(node.getAttribute("src") || "");

    if (!src || !alt) return false;
    if (/^(?:image|img|图片|图像)$/i.test(alt)) return false;
    if (/^https?:\/\//i.test(alt)) return false;
    return alt !== src;
  };

  function processNode(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case "h1":
        return `\n# ${getTextContent(node).trim()}\n\n`;
      case "h2":
        return `\n## ${getTextContent(node).trim()}\n\n`;
      case "h3":
        return `\n### ${getTextContent(node).trim()}\n\n`;
      case "h4":
        return `\n#### ${getTextContent(node).trim()}\n\n`;
      case "h5":
        return `\n##### ${getTextContent(node).trim()}\n\n`;
      case "h6":
        return `\n###### ${getTextContent(node).trim()}\n\n`;
      case "p":
        return `${processChildren(node, depth)}\n\n`;
      case "br":
        return "\n";
      case "strong":
      case "b":
        return `**${getTextContent(node)}**`;
      case "em":
      case "i":
        return `*${getTextContent(node)}*`;
      case "code":
        if (node.parentElement && node.parentElement.tagName.toLowerCase() !== "pre") {
          return `\`${getTextContent(node)}\``;
        }
        return getTextContent(node);
      case "pre": {
        const codeElement = node.querySelector("code");
        const language = codeElement ? extractLanguage(codeElement) : "";
        const code = (
          getPreformattedText(codeElement || node) ||
          getTextContent(codeElement || node)
        )
          .replace(/\n{3,}/g, "\n\n")
          .replace(/\n+$/g, "");
        return `\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
      }
      case "a": {
        const href = node.getAttribute("href") || "";
        const text = getTextContent(node).trim();
        if (!text) return "";
        return href ? `[${text}](${href})` : text;
      }
      case "ul":
      case "ol":
        return `\n${processListItems(node, tag === "ol", depth)}\n`;
      case "blockquote":
        return `\n${prefixLines(normalizePlainText(processChildren(node, depth)), "> ")}\n\n`;
      case "hr":
        return "\n---\n\n";
      case "table":
        return processTable(node);
      case "img": {
        if (!shouldKeepImageNode(node)) return "";
        const alt = node.getAttribute("alt") || "image";
        const src = node.getAttribute("src") || "";
        return src ? `![${alt}](${src})` : "";
      }
      case "div":
      case "span":
      case "section":
      case "article":
      case "main":
      case "li":
        return processChildren(node, depth);
      default:
        return processChildren(node, depth);
    }
  }

  const htmlToMarkdown = (element) => {
    if (!element) return "";
    const clone = element.cloneNode(true);
    removeNoiseNodes(clone);
    const markdown = processNode(clone, 0);
    return normalizePlainText(markdown.replace(/\n{3,}/g, "\n\n"));
  };

  const stripLeadingFileReferences = (text) => {
    if (!text) return "";
    const pattern = new RegExp(
      `^(?:(?:\\[附件:[^\\]]+\\]|《[^》]{1,120}》\\.${FILE_EXTENSION_PATTERN}|「[^」]{1,120}」\\.${FILE_EXTENSION_PATTERN}|[^\\n。！？?]{1,120}?\\.${FILE_EXTENSION_PATTERN})(?:文件)?\\s*)+`,
      "i",
    );
    return text.replace(pattern, "").trim();
  };

  const cleanupMessageText = (content, role) => {
    const originalValue = normalizePlainText(content);
    if (!originalValue) return "";
    if (TOOL_PAYLOAD_PATTERN.test(originalValue)) return "";

    let cleaned = originalValue
      .replace(/\n?(Copy code|复制代码|Edit|编辑|Regenerate|重新生成)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (role === "user") cleaned = stripLeadingFileReferences(cleaned);
    if (role === "assistant" && /^ChatGPT$/i.test(cleaned)) return "";
    return cleaned;
  };

  const getConversationTitle = () => {
    const activeConversation = document.querySelector('nav a[aria-current="page"]');
    if (activeConversation) {
      const titleElement =
        activeConversation.querySelector('div[class*="truncate"]') ||
        activeConversation.querySelector("div");
      const title = normalizePlainText(titleElement ? titleElement.innerText : "");
      if (title && !/^(new chat|chatgpt|新聊天)$/i.test(title)) return title;
    }

    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle?.content) {
      const title = normalizePlainText(metaTitle.content);
      if (title && title !== "ChatGPT") return title;
    }

    if (document.title && document.title !== "ChatGPT") {
      const title = normalizePlainText(
        document.title.replace(/\s*-\s*ChatGPT\s*$/i, ""),
      );
      if (title) return title;
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `ChatGPT 对话 ${y}-${m}-${d}`;
  };

  const shiftMarkdownHeadings = (markdown, levels) => {
    if (!markdown || levels <= 0) return markdown;
    let inFence = false;

    return markdown
      .split("\n")
      .map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence) return line;

        const match = line.match(/^(#{1,6})(\s+.+)$/);
        if (!match) return line;

        const nextLevel = Math.min(6, match[1].length + levels);
        return `${"#".repeat(nextLevel)}${match[2]}`;
      })
      .join("\n");
  };

  const compactMarkdownSpacing = (markdown) => {
    if (!markdown) return markdown;

    const lines = markdown.split("\n");
    const result = [];
    let inFence = false;

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        result.push(line);
        continue;
      }

      if (inFence || line.trim()) {
        result.push(line);
        continue;
      }

      const previous = result.length ? result[result.length - 1] : "";
      if (!previous || previous.trim() === "") continue;
      result.push(line);
    }

    return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  const groupMessagesIntoRounds = (messages) => {
    const rounds = [];
    let currentRound = null;

    for (const message of messages) {
      if (message.role === "user") {
        currentRound = { user: message.content, assistantParts: [] };
        rounds.push(currentRound);
        continue;
      }

      if (!currentRound) {
        currentRound = { user: "", assistantParts: [] };
        rounds.push(currentRound);
      }

      currentRound.assistantParts.push(message.content);
    }

    return rounds
      .map((round) => {
        const assistantParts = round.assistantParts
          .map((part) => normalizePlainText(part))
          .filter(Boolean);

        return {
          user: normalizePlainText(round.user || ""),
          answer: assistantParts.length
            ? assistantParts[assistantParts.length - 1]
            : "",
          thinking:
            assistantParts.length > 1
              ? normalizePlainText(assistantParts.slice(0, -1).join("\n\n"))
              : "",
        };
      })
      .filter((round) => round.user || round.thinking || round.answer);
  };

  const extractConversation = async () => {
    expandAllCollapsedContent();
    await sleep(900);

    const messageElements = Array.from(document.querySelectorAll(SELECTORS.message));
    if (!messageElements.length) {
      throw new Error("未找到对话消息，确认当前页面是具体对话页。");
    }

    const messages = [];
    for (const messageElement of messageElements) {
      const role = messageElement.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") continue;

      const contentRoot = getContentRoot(messageElement);
      let content = htmlToMarkdown(contentRoot);

      if (!content) {
        const fallbackRoot = messageElement.cloneNode(true);
        removeNoiseNodes(fallbackRoot);
        content = normalizePlainText(
          fallbackRoot.innerText || fallbackRoot.textContent || "",
        );
      }

      content = cleanupMessageText(content, role);
      if (content) messages.push({ role, content });
    }

    if (!messages.length) {
      throw new Error("页面已找到消息节点，但没有提取到有效内容。");
    }

    return messages;
  };

  const buildMarkdown = (messages, title) => {
    const exportedAt = new Date();
    const exportedAtIso = exportedAt.toISOString();
    const exportedAtLocal = exportedAt.toLocaleString("zh-CN", { hour12: false });
    const rounds = groupMessagesIntoRounds(messages);

    const sections = rounds.map((round, index) => {
      const userContent = round.user
        ? compactMarkdownSpacing(shiftMarkdownHeadings(round.user, 1))
        : "（无显式用户输入）";
      const thinkingContent = round.thinking
        ? compactMarkdownSpacing(shiftMarkdownHeadings(round.thinking, 1))
        : "";
      const answerContent = round.answer
        ? compactMarkdownSpacing(shiftMarkdownHeadings(round.answer, 1))
        : "（本轮没有提取到 AI 正式回答）";

      const blocks = [
        `# 第 ${index + 1} 轮对话`,
        "",
        "**用户**",
        "",
        userContent,
        "",
      ];

      if (thinkingContent) {
        blocks.push("**AI 思考 / 过程**", "", thinkingContent, "");
      }

      blocks.push("**AI 正式回答**", "", answerContent);
      return blocks.join("\n");
    });

    return compactMarkdownSpacing(
      [
        "---",
        'source: "ChatGPT"',
        `conversationTitle: ${escapeYamlString(title)}`,
        `exportedAt: "${exportedAtIso}"`,
        `messageCount: ${messages.length}`,
        `roundCount: ${rounds.length}`,
        "---",
        "",
        `> 会话标题：${title}`,
        "> 导出来源：ChatGPT",
        `> 导出时间：${exportedAtLocal}`,
        "",
        ...sections,
      ].join("\n"),
    );
  };

  const downloadMarkdown = (markdown, title) => {
    const fileTitle = sanitizeFileName(title);
    const blob = new Blob(["\uFEFF", markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileTitle}_${Date.now()}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const setExportButtonState = (isLoading, label) => {
    const button = state.exportButton || document.getElementById(IDS.exportButton);
    if (!button) return;
    button.disabled = isLoading;
    button.dataset.state = isLoading ? "loading" : "idle";
    const text = button.querySelector(".gpt-toc-export-text");
    if (text) text.textContent = label || TEXT.export;
  };

  const showToast = (message, type = "success") => {
    let toast = document.getElementById(IDS.toast);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = IDS.toast;
      toast.className = "gpt-toc-toast";
      document.body.appendChild(toast);
    }

    toast.dataset.type = type;
    toast.textContent = message;
    toast.classList.add("show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  };

  async function handleExportClick() {
    if (state.exporting) return;

    state.exporting = true;
    setExportButtonState(true, TEXT.exporting);

    try {
      const messages = await extractConversation();
      const title = getConversationTitle();
      const markdown = buildMarkdown(messages, title);

      setExportButtonState(true, TEXT.downloading);
      downloadMarkdown(markdown, title);
      showToast(`${TEXT.exportDone} ${messages.length} 条消息`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : TEXT.exportFailed;
      console.error("[GPT TOC] export failed:", error);
      showToast(message, "error");
    } finally {
      state.exporting = false;
      setExportButtonState(false, TEXT.export);
    }
  }

  const scheduleRebuild = (delay = 300) => {
    window.clearTimeout(state.rebuildTimer);
    state.rebuildTimer = window.setTimeout(() => {
      bindThreadObserver();
      renderList();
    }, delay);
  };

  const isConversationNode = (node) => {
    if (!(node instanceof Element)) return false;
    return (
      node.matches(SELECTORS.userTurn) ||
      node.matches(SELECTORS.assistantTurn) ||
      node.matches(SELECTORS.userMessage) ||
      node.matches(SELECTORS.assistantMessage) ||
      Boolean(node.querySelector?.(SELECTORS.userTurn)) ||
      Boolean(node.querySelector?.(SELECTORS.assistantTurn)) ||
      Boolean(node.querySelector?.(SELECTORS.userMessage)) ||
      Boolean(node.querySelector?.(SELECTORS.assistantMessage))
    );
  };

  const shouldRebuildFromThreadMutations = (mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (
          isConversationNode(mutation.target) ||
          mutation.target.closest?.(SELECTORS.userTurn) ||
          mutation.target.closest?.(SELECTORS.assistantTurn)
        ) {
          return true;
        }
      }

      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (
            isConversationNode(node) ||
            node.parentElement?.closest?.(SELECTORS.assistantTurn)
          ) {
            return true;
          }
        }
        for (const node of mutation.removedNodes) {
          if (
            isConversationNode(node) ||
            node.parentElement?.closest?.(SELECTORS.assistantTurn)
          ) {
            return true;
          }
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
    state.activeIndex = -1;
    state.expandedKey = null;
    state.manualCollapsedKey = null;
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
