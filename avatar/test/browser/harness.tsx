import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { AvatarMode, AvatarProps, Portal } from "@pithagoras/extension-api";

/**
 * The page the browser tests drive the 3D Avatar on: the portal's React handed over as the portal hands it, a stand-in
 * for the rest of the portal that keeps what the extension registers, and the extension's built browser half
 * (web/client.js) loaded into it. Its server half answers under /api/x/%40pithagoras/flair-avatar (serve.ts).
 *
 * A test mounts an entry's component in a box as voice mode draws its avatar, with the orb a stand-in canvas
 * (`data-testid="orb"`), the made-up voice of the portal's Avatar dialog, and an error boundary and a Suspense of its
 * own as the portal's; or the extension's page in Settings. `?lang=de` is the page in German.
 */

type Entry = { id: string; component: React.ComponentType<any>; [key: string]: unknown };
const slots = new Map<string, Entry[]>();
const watchers = new Set<() => void>();
const strings = new Map<string, Record<string, string>>();
const lang = new URLSearchParams(location.search).get("lang") ?? "en";
const asked: string[] = [];

const fill = (text: string, vars?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (all, name) => (vars && name in vars ? String(vars[name]) : all));
const t = (text: string, vars?: Record<string, string | number>) => fill(strings.get(lang)?.[text] ?? text, vars);

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `HTTP ${res.status}`, res.status, body);
  }
  return res.json();
}

/** Draws `fallback` in place of what fails to draw, as the portal's own boundary does. */
class Boundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed?: Error }> {
  state: { failed?: Error } = {};
  static getDerivedStateFromError(failed: Error) {
    return { failed };
  }
  componentDidCatch(error: Error) {
    (window as any).harness.failures.push(error.message);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const button = "rounded-lg border px-2 py-1 text-xs";
const ui = {
  Section: ({ title, hint, action, children }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) => (
    <section aria-label={title}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  ),
  Empty: ({ children }: { children: React.ReactNode }) => <p data-testid="empty">{children}</p>,
  ErrorBanner: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  LoadFailed: ({ error }: { error: string }) => <div role="alert">{String(error)}</div>,
  RowsSkeleton: ({ label }: { label?: string }) => <p>{label}</p>,
  classes: { input: "", inputSmall: "", codeArea: "", button, primary: button, primarySmall: button, ghost: button, viewerButton: button, iconButton: button },
  asksBeforeDeleting: () => true,
  confirm: async ({ title }: { title: string }) => {
    asked.push(title);
    return true;
  },
  lazy: (load: () => Promise<Record<string, React.ComponentType<any>>>, name: string) => React.lazy(() => load().then((module) => ({ default: module[name] }))),
};

const portal = {
  version: 1,
  extension: "@pithagoras/flair-avatar",
  React,
  slots: {
    register(slot: string, entry: Entry) {
      const list = slots.get(slot) ?? [];
      if (list.some((e) => e.id === entry.id)) throw new Error(`already has an entry called "${entry.id}" in ${slot}`);
      slots.set(slot, [...list, entry]);
      watchers.forEach((w) => w());
      return () => {
        slots.set(slot, (slots.get(slot) ?? []).filter((e) => e !== entry));
        watchers.forEach((w) => w());
      };
    },
  },
  ui,
  api: { json, url: (path: string) => `/api/x/%40pithagoras/flair-avatar${path}`, ApiError },
  t,
  locale: {
    add(code: string, given: Record<string, string>) {
      strings.set(code, { ...strings.get(code), ...given });
      return () => strings.delete(code);
    },
    use: () => lang,
  },
  format: { number: (n: number, options?: Intl.NumberFormatOptions) => n.toLocaleString(lang, options) },
} as unknown as Portal;

/**
 * The portal's orb, as a stand-in: what the avatar draws while it has nothing of its own. A canvas of the orb's class
 * in the orb's overscanned square, as the portal's own is (VoiceOrb.tsx and stage.css), so what the extension's rules
 * do to a canvas they meet is seen here too.
 */
const Orb = () => (
  <canvas
    data-testid="orb"
    className="voice-orb"
    width={64}
    height={64}
    style={{ position: "absolute", left: "-21.428571%", top: "-21.428571%", width: "142.857143%", aspectRatio: "1", maxWidth: "none" }}
    ref={(canvas) => {
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, "#82bcff");
      glow.addColorStop(0.7, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 64, 64);
    }}
  />
);

/** What a test mounts, and changes without mounting again: `level` holds the voice at one level in place of the made-up one. */
type Shown = { entry: string; size: number; mode: AvatarMode; still: boolean; hidden?: boolean; level?: number };
let root: Root | undefined;
let set: React.Dispatch<React.SetStateAction<Shown>> | undefined;
const levels: { current: { input: number; output: number } } = { current: { input: 0, output: 0 } };
let voiceMode: AvatarMode = "idle";
let fixed: number | undefined;

// The Avatar dialog's made-up voice: syllables rising and falling inside slower phrases.
const tick = (ms: number) => {
  const syllable = Math.max(0, Math.sin(ms * 0.012));
  const phrase = 0.55 + 0.45 * Math.sin(ms * 0.0019);
  const value = fixed ?? Math.min(1, syllable * phrase * 0.85 + Math.random() * 0.08);
  levels.current = { input: voiceMode === "input" ? value : 0, output: voiceMode === "output" ? value : 0 };
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

function Mounted({ first }: { first: Shown }) {
  const [shown, setShown] = React.useState(first);
  set = setShown;
  voiceMode = shown.mode;
  fixed = shown.level;
  const entries = React.useSyncExternalStore(
    (w) => (watchers.add(w), () => watchers.delete(w)),
    () => slots.get("voice.avatar") ?? [],
  );
  const entry = entries.find((e) => e.id === shown.entry);
  const orb = React.useMemo(() => <Orb />, []);
  const agent = React.useMemo(() => ({ id: "home", name: "Home" }), []);
  if (!entry) return null;
  const Part = entry.component as React.ComponentType<AvatarProps>;
  return (
    <div data-testid="box" style={{ position: "relative", width: shown.size, aspectRatio: "1", margin: shown.hidden ? "3000px 0 0 300px" : "200px 0 0 300px" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
        <Boundary fallback={orb}>
          <React.Suspense fallback={orb}>
            <Part agent={agent} mode={shown.mode} levels={levels} still={shown.still} orb={orb} />
          </React.Suspense>
        </Boundary>
      </div>
    </div>
  );
}

(window as any).__pithagoras = { React, jsxRuntime, ReactDOM };
(window as any).harness = {
  failures: [] as string[],
  asked,
  /** The entries of a slot, as the portal would list them. */
  entries: (slot = "voice.avatar") => (slots.get(slot) ?? []).map(({ component, ...rest }) => rest),
  mount(shown: Shown) {
    root?.unmount();
    root = createRoot(document.getElementById("root")!);
    root.render(<Mounted first={{ ...shown }} />);
  },
  change(patch: Partial<Shown>) {
    set!((shown) => ({ ...shown, ...patch }));
  },
  settings() {
    root?.unmount();
    root = createRoot(document.getElementById("root")!);
    const Page = slots.get("settings.page")![0].component;
    root.render(<Page />);
  },
  unmount() {
    root?.unmount();
    root = undefined;
  },
};

// Served beside this page, as built: not bundled into it.
const built = "/web/client.js";
const half = await import(built);
half.default(portal);
(window as any).harness.ready = true;
