/**
 * Back / Forward input: mouse buttons 4/5 (button 3/4), two-finger horizontal trackpad swipes,
 * and the usual shortcuts (Cmd+[ / Cmd+], Alt+Left / Alt+Right).
 * (The macOS three-finger swipe is caught natively in Rust; see install_swipe_back.)
 * Returns a cleanup function.
 */
export function installBackNavigation(back: () => void, forward: () => void): () => void {
  const onMouse = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      if (e.type === "mouseup") (e.button === 3 ? back : forward)();
    }
  };

  // Trackpad swipe: WebKit reports it as horizontal wheel events. Swiping two fingers to the
  // right (the system "back" gesture) gives negative deltaX. Fire once per gesture.
  const THRESHOLD = 140;
  let sum = 0;
  let fired = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return; // pinch-zoom
    clearTimeout(idle);
    idle = setTimeout(() => {
      sum = 0;
      fired = false;
    }, 250);
    if (fired || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
    if (scrollsHorizontally(e.target)) return; // let wide tables etc. scroll
    sum += e.deltaX;
    if (sum < -THRESHOLD) {
      fired = true;
      back();
    } else if (sum > THRESHOLD) {
      fired = true;
      forward();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if ((e.metaKey && e.key === "[") || (e.altKey && e.key === "ArrowLeft")) {
      e.preventDefault();
      back();
    } else if ((e.metaKey && e.key === "]") || (e.altKey && e.key === "ArrowRight")) {
      e.preventDefault();
      forward();
    }
  };

  window.addEventListener("mousedown", onMouse);
  window.addEventListener("mouseup", onMouse);
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("mousedown", onMouse);
    window.removeEventListener("mouseup", onMouse);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
    clearTimeout(idle);
  };
}

function scrollsHorizontally(target: EventTarget | null): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}
