export function isActiveElementTextInputWithContent(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && (active.type === "text" || active.type === "search"))
  ) {
    return active.value.length > 0;
  }
  if (active.getAttribute("contenteditable") === "true") {
    return (active.textContent?.length ?? 0) > 0;
  }
  return false;
}

interface FocusWithRetriesOptions {
  focus: () => void;
  isFocused: () => boolean;
  deferInitialAttempt?: boolean;
  timeoutMs?: number;
  onSuccess?: () => void;
  onTimeout?: () => void;
}

export function focusWithRetries({
  focus,
  isFocused,
  deferInitialAttempt = false,
  timeoutMs = 1500,
  onSuccess,
  onTimeout,
}: FocusWithRetriesOptions): () => void {
  let cancelled = false;
  const deadlineMs = Date.now() + timeoutMs;

  const tick = () => {
    if (cancelled) return;

    try {
      focus();
    } catch {
      // ignore
    }

    if (isFocused()) {
      onSuccess?.();
      return;
    }

    if (Date.now() >= deadlineMs) {
      onTimeout?.();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(tick);
    });
  };

  if (deferInitialAttempt) {
    requestAnimationFrame(tick);
  } else {
    tick();
  }

  return () => {
    cancelled = true;
  };
}
