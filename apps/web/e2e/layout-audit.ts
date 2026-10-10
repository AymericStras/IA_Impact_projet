/**
 * Layout audit used by responsive.spec.ts. `auditLayout` runs INSIDE the page
 * (`page.evaluate`) and returns human-readable problems; an empty list means the layout
 * holds. It must stay self-contained: no imports, no closures over module scope.
 */

export interface AuditOptions {
  touch: boolean;
  /** False while the recorder replaces the composer. */
  expectComposer: boolean;
  minConversationRatio: number;
  twoColumnMinRem: number;
}

export interface AuditResult {
  issues: string[];
  conversationHeight: number;
  viewportHeight: number;
}

/** Runs inside the page. Returns human-readable layout problems (empty when all is well). */
export function auditLayout(options: AuditOptions): AuditResult {
  const issues: string[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  const rectOf = (el: Element) => el.getBoundingClientRect();
  const name = (el: Element) => {
    const testId = el.getAttribute("data-testid");
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} "${label}"`;
  };
  /** True when the element itself holds text (not only through its children). */
  const hasOwnText = (el: Element) =>
    [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
  const isVisible = (el: Element) => {
    const r = rectOf(el);
    const cs = getComputedStyle(el);
    // Screen-reader-only elements are clipped to 1 px: not part of the visual layout.
    return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  /** Content of the one intentionally horizontally scrollable region (the JSON block). */
  const inScrollRegion = (el: Element) => el.closest("[data-scroll-x]") !== null && !el.matches("[data-scroll-x]");
  const inViewport = (el: Element) => {
    const r = rectOf(el);
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  };
  /**
   * True when the element is what the user would actually hit at its centre, i.e. it is
   * not underneath another layer (expanded panel, dialog) or scrolled out of its container.
   */
  const isExposed = (el: Element) => {
    const r = rectOf(el);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || x > vw || y < 0 || y > vh) return false;
    const top = document.elementFromPoint(x, y);
    if (!top) return false;
    if (top === el || el.contains(top)) return true;
    // Disabled buttons let pointer events through: accept them when what lies beneath is their own container.
    return (el as HTMLButtonElement).disabled === true && top.contains(el);
  };

  // 1. No horizontal scrolling, neither of the page nor of the app shell.
  if (document.documentElement.scrollWidth > vw + 1) {
    issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
  }
  const shell = document.querySelector('[data-testid="app-shell"]');
  if (shell && shell.scrollWidth > shell.clientWidth + 1) {
    issues.push(`content is wider than the app shell (${shell.scrollWidth} > ${shell.clientWidth})`);
  }

  // An inner scroller (the thread, the panel body, the dialog) absorbs content that is too
  // wide without widening the shell: the user would have to scroll sideways inside it.
  // Only the region marked `data-scroll-x` (the JSON block) may do that.
  const everything = [...document.body.querySelectorAll("*")];
  for (const el of everything) {
    if (el.matches("[data-scroll-x], input, select") || !isVisible(el)) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
      issues.push(`scrolls horizontally (${el.scrollWidth} > ${el.clientWidth}): ${name(el)}`);
    }
  }

  // 2. Nothing sticks out of the viewport horizontally, and no text is cut by its box.
  //    Checked on every control and on every element that holds text of its own (a
  //    message bubble is a plain div).
  const reported = new Set<string>();
  const TEXT_AND_CONTROLS = "button, a[href], input, textarea, select, p, h1, h2, h3, span, li, label, pre, output, time";
  const textAndControls = everything.filter((el) => el.matches(TEXT_AND_CONTROLS) || hasOwnText(el));
  for (const el of textAndControls) {
    if (!isVisible(el) || inScrollRegion(el)) continue;
    const r = rectOf(el);
    if (r.left < -1 || r.right > vw + 1) {
      const key = `outside:${name(el)}`;
      if (!reported.has(key)) {
        reported.add(key);
        issues.push(`outside the viewport horizontally (${Math.round(r.left)}..${Math.round(r.right)} of ${vw}): ${name(el)}`);
      }
    }
    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    if (clipsX && !el.matches("[data-scroll-x], textarea, input") && el.scrollWidth > el.clientWidth + 1) {
      issues.push(`text clipped horizontally: ${name(el)}`);
    }
  }

  // 3. Buttons show their whole label.
  for (const button of document.querySelectorAll("button")) {
    if (!isVisible(button)) continue;
    if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
      issues.push(`button label clipped: ${name(button)}`);
    }
  }

  // 4. The composer is fully visible, usable and not covered.
  const composer = document.querySelector<HTMLTextAreaElement>("#composer-input");
  if (options.expectComposer) {
    if (!composer || !isVisible(composer)) {
      issues.push("composer textarea is missing");
    } else {
      const r = rectOf(composer);
      if (r.top < 0 || r.bottom > vh + 1) issues.push(`composer not fully visible (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, viewport ${vh})`);
      if (r.height < 36) issues.push(`composer too short: ${Math.round(r.height)} px`);
      if (!isExposed(composer)) issues.push("composer is covered by another element");
      // The placeholder must fit on one line.
      const cs = getComputedStyle(composer);
      const probe = document.createElement("span");
      probe.textContent = composer.placeholder;
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
      document.body.appendChild(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      const available = composer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (composer.value === "" && needed > available + 1) {
        issues.push(`composer placeholder does not fit on one line (${Math.round(needed)} > ${Math.round(available)} px)`);
      }
    }
  }

  // 5. The conversation keeps a fair share of the height.
  const conversation = document.querySelector('[data-testid="conversation-scroll"]');
  const conversationHeight = conversation ? conversation.clientHeight : 0;
  if (!conversation) {
    issues.push("conversation area is missing");
  } else if (conversationHeight < options.minConversationRatio * vh - 0.5) {
    issues.push(
      `conversation area too small: ${conversationHeight} px = ${((100 * conversationHeight) / vh).toFixed(1)} % of ${vh} (minimum ${options.minConversationRatio * 100} %)`,
    );
  }

  // 6. No two controls the user can reach overlap.
  const CONTROLS = "button, a[href], input, textarea, select";
  /** The floating layer an element belongs to, if any (expanded panel, dialog). */
  const layerOf = (el: Element) => el.closest('[data-testid="panel-body"], [role="dialog"]');
  /**
   * A control hidden under ANOTHER CONTROL of the same layer is a layout bug, not a
   * legitimately covered element (as the thread is under the expanded panel): it must stay
   * in the list so that the overlap is reported.
   */
  /** The part of the element that its scrolling/clipping ancestors actually let through. */
  const visibleRect = (el: Element) => {
    const r = rectOf(el);
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const cs = getComputedStyle(parent);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const pr = rectOf(parent);
      box.left = Math.max(box.left, pr.left);
      box.top = Math.max(box.top, pr.top);
      box.right = Math.min(box.right, pr.right);
      box.bottom = Math.min(box.bottom, pr.bottom);
    }
    return box;
  };
  const isUnderSiblingControl = (el: Element) => {
    const r = rectOf(el);
    const v = visibleRect(el);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // Scrolled out of its container: clipped, not covered.
    if (x < v.left || x > v.right || y < v.top || y > v.bottom) return false;
    const top = document.elementFromPoint(x, y);
    const other = top?.closest(CONTROLS);
    return !!other && other !== el && !other.contains(el) && !el.contains(other) && layerOf(other) === layerOf(el);
  };
  const controls = [...document.querySelectorAll(CONTROLS)].filter(
    (el) => isVisible(el) && inViewport(el) && (isExposed(el) || isUnderSiblingControl(el)),
  );
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.contains(b) || b.contains(a)) continue;
      const ra = visibleRect(a);
      const rb = visibleRect(b);
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > 2 && overlapY > 2) issues.push(`controls overlap: ${name(a)} and ${name(b)}`);
    }
  }

  // 7. Touch targets.
  if (options.touch) {
    for (const el of controls) {
      const r = rectOf(el);
      if (r.width < 43.5 || r.height < 43.5) {
        issues.push(`touch target ${Math.round(r.width)}×${Math.round(r.height)} px (< 44): ${name(el)}`);
      }
    }
  }

  // 8. Two columns from 48rem of effective width, a single column below.
  const panel = document.querySelector('[data-testid="requirements-panel"]');
  const area = document.querySelector('[data-testid="conversation-area"]');
  if (panel && area) {
    const rp = rectOf(panel);
    const ra = rectOf(area);
    const expectTwoColumns = vw / rootFontSize >= options.twoColumnMinRem;
    const sideBySide = rp.left >= ra.right - 1;
    const stacked = rp.bottom <= ra.top + 1;
    if (expectTwoColumns && !sideBySide) issues.push("expected two columns (panel to the right of the conversation)");
    if (!expectTwoColumns && !stacked) issues.push("expected a single column (panel summary above the conversation)");
  } else {
    issues.push("panel or conversation area is missing");
  }

  return { issues, conversationHeight, viewportHeight: vh };
}
