// Return presses the highlighted (blue, .btn.primary) button of whatever you are filling in.
//
// From the focused field the search walks outwards to the nearest box that has primary buttons,
// and acts only when there is exactly one, so it never guesses (the vote list has a blue Vote button
// per row: there Return does nothing). It stops at a dialog, a card / section or a wallet tab, so a
// field never reaches a button in another part of the screen. With nothing focused, Return presses
// the open dialog's button. Fields that handle Return themselves (they call preventDefault),
// textareas, selects, links and buttons (Return already presses a focused button) are left alone.

const SCOPE = ".modal, .card, section, .tabbody, [data-enter-scope]";

function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null && el.getClientRects().length > 0;
}

function primaries(root: Element): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button.btn.primary")].filter((b) => !b.disabled && visible(b));
}

function target(start: Element | null): HTMLButtonElement | null {
  const modal = document.querySelector(".modal");
  // a dialog is open: only its own buttons count, whatever has focus
  if (modal && (!start || !modal.contains(start))) start = modal;
  if (!start) return null;
  for (let el: Element | null = start; el; el = el.parentElement) {
    const found = primaries(el);
    if (found.length) return found.length === 1 ? found[0] : null;
    if (el.matches(SCOPE)) return null;
  }
  return null;
}

export function installEnterKey(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const active = document.activeElement as HTMLElement | null;
    const onPage = !active || active === document.body;
    if (!onPage) {
      if (active.closest("textarea, select, button, a, [contenteditable]")) return;
      if (!(active instanceof HTMLInputElement)) return;
      if (["checkbox", "radio", "button", "submit", "file"].includes(active.type)) return;
    } else if (!document.querySelector(".modal")) {
      return; // nothing focused and no dialog: Return does nothing on the page itself
    }
    const btn = target(onPage ? null : active);
    if (!btn) return;
    e.preventDefault();
    btn.click();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
