export function createHydrationSettlement() {
  let pending: Promise<void> | undefined;
  let finishPrevious: (() => void) | undefined;

  return {
    start: () => {
      // Zustand does not call the completion callback for a superseded hydration.
      finishPrevious?.();
      let finish: () => void = () => {};
      const attempt = new Promise<void>((resolve) => {
        finish = resolve;
      });
      pending = attempt;
      finishPrevious = finish;
      return () => {
        if (pending === attempt) {
          pending = undefined;
          finishPrevious = undefined;
        }
        finish();
      };
    },
    wait: async () => {
      for (;;) {
        const attempt = pending;
        if (!attempt) return;
        await attempt;
      }
    },
  };
}
