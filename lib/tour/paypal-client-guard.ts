/**
 * Browser-side half of "the tour never calls PayPal". While a tour runs, any fetch / XHR to a PayPal host or to our
 * own /api/paypal routes is refused and logged, and PayPal script tags are removed. The server refuses the same
 * calls (lib/tour/paypal-guard.ts), so this is a second, independent layer.
 */
export const isPaypalBound = (url: string, origin = "http://localhost"): boolean => {
  try {
    const u = new URL(url, origin);
    return /(^|\.)paypal(objects)?\.com$/i.test(u.hostname) || /^\/api\/paypal(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
};

interface GuardWindow {
  fetch: typeof fetch;
  location: { origin: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XMLHttpRequest?: { prototype: { open: (...a: any[]) => any } };
  document?: { querySelectorAll?: (s: string) => ArrayLike<{ remove(): void }> };
  MutationObserver?: new (cb: () => void) => { observe(n: unknown, o: unknown): void; disconnect(): void };
}

export const blockedLog: string[] = [];

export function installPaypalGuard(win: GuardWindow, onBlock: (url: string) => void = () => {}): () => void {
  const realFetch = win.fetch;
  const note = (u: string) => {
    blockedLog.push(u);
    console.warn("[tour] blocked a PayPal-bound request during the guided demo:", u);
    onBlock(u);
  };
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isPaypalBound(url, win.location.origin)) {
      note(url);
      return Promise.resolve(new Response(JSON.stringify({ error: "The guided demo never calls PayPal.", code: "tour_paypal_blocked" }), { status: 403, headers: { "content-type": "application/json" } }));
    }
    return realFetch.call(win, input, init);
  }) as typeof fetch;

  const xhr = win.XMLHttpRequest?.prototype;
  const realOpen = xhr?.open;
  if (xhr && realOpen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xhr.open = function (this: unknown, ...args: any[]) {
      const url = String(args[1] ?? "");
      if (isPaypalBound(url, win.location.origin)) {
        note(url);
        args[1] = "data:application/json,%7B%7D"; // neutralised: nothing is sent anywhere
      }
      return realOpen.apply(this, args);
    };
  }

  const sweep = () => {
    for (const s of Array.from(win.document?.querySelectorAll?.('script[src*="paypal.com"], script[src*="paypalobjects.com"]') ?? [])) {
      note("script tag");
      s.remove();
    }
  };
  const obs = win.MutationObserver && win.document ? new win.MutationObserver(sweep) : null;
  obs?.observe(win.document, { childList: true, subtree: true });

  return () => {
    win.fetch = realFetch;
    if (xhr && realOpen) xhr.open = realOpen;
    obs?.disconnect();
  };
}
