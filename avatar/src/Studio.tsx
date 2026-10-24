import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AvatarLevels, AvatarMode } from "@pithagoras/extension-api";
import { Avatar } from "./Avatar";
import { Licence } from "./Licence";
import type { Model } from "./model";
import { changed, DEFAULT_SETTINGS, RANGES, withDefaults, type Gaze, type ModelSettings, type NumberKey } from "./model-settings";
import { msg, portal, t } from "./portal";
import type { FramingKind, Shown } from "./stage";
import { NAME_MAX } from "./vrm-file";

/**
 * The model chosen on the Settings page, as a card of its own: its name (renamed in place), its file to download, a
 * way to delete it, what its licence says, a large live preview, and what can be set on it beside the preview.
 *
 * What is set is saved as it is changed: a slider when it is let go, a switch or a choice at once. The preview draws
 * a slider's value while it is still held, and the saved settings reach every avatar of the model wherever it is drawn
 * (models.ts). Saves go one at a time, the newest last, so the server keeps the last change whatever order two
 * answers would come in; a refused one is said over the page, and what is shown goes back to what is saved.
 */

/** The preview's states, in the words of the portal's own Avatar dialog. */
const STATES: [AvatarMode, string][] = [
  ["idle", msg("Idle")], ["input", msg("Listening")], ["output", msg("Speaking")], ["thinking", msg("Thinking")], ["muted", msg("Muted")],
];

/**
 * What the Talk button plays, each state for so many seconds: the person talks, the agent thinks (long enough for the
 * thinking pose, which starts after 0.6 s), and its reply is spoken with the made-up voice.
 */
const TURN: [AvatarMode, number][] = [["input", 2.5], ["thinking", 2], ["output", 4]];

type Tab = "look" | "motion" | "voice";
const TABS: [Tab, string][] = [["look", msg("Camera and light")], ["motion", msg("Motion")], ["voice", msg("Voice and pose")]];

/** Each slider: its setting, its name and what it does, in the tab it is in. */
const SLIDERS: [Tab, NumberKey, string, string][] = [
  ["look", "zoom", msg("Zoom"), msg("How close the camera is.")],
  ["look", "height", msg("Height"), msg("Moves the model up or down in its box.")],
  ["look", "brightness", msg("Brightness"), msg("How strongly the light falls on it.")],
  ["look", "warmth", msg("Warmth"), msg("The colour of the light, from cool to warm.")],
  ["motion", "motion", msg("Overall motion"), msg("All of its own movement: breathing, sway, eye movement, nodding, leaning in and the thinking pose. It blinks and speaks either way.")],
  ["motion", "breathing", msg("Breathing and sway"), msg("How much its chest rises and its head sways while it waits.")],
  ["motion", "blinkRate", msg("Blinking"), msg("How often it blinks.")],
  ["motion", "lean", msg("Leaning in"), msg("How far it leans towards you while you talk.")],
  ["voice", "mouth", msg("Mouth sensitivity"), msg("How wide the mouth opens at the same loudness. Raise it for a quiet voice.")],
  ["voice", "armDown", msg("Arm angle"), msg("How far the arms come down from the T-pose. Change it when the arms go into the body or stand out stiffly.")],
];

const GAZE: [Gaze, string, string][] = [
  ["you", msg("At you"), msg("Its eyes stay on you, moving a little now and then.")],
  ["around", msg("Around"), msg("Its eyes wander while nothing is said, and come back to you when you talk or it speaks.")],
];

/** A slider's value as it is shown beside it and said to a screen reader, in the page's language. */
function shown(key: NumberKey, value: number): string {
  const number = portal.format.number;
  const percent = (v: number) => number(v, { style: "percent", maximumFractionDigits: 0 });
  switch (key) {
    case "zoom":
      return `${number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
    case "height":
      return `${number(Math.round(value * 100), { signDisplay: "exceptZero" })} cm`;
    case "warmth":
      return value === 0 ? t("Neutral") : value > 0 ? t("Warmer {n}", { n: percent(value) }) : t("Cooler {n}", { n: percent(-value) });
    case "blinkRate":
      return t("About {n} a minute", { n: Math.round(15 * value) });
    case "armDown":
      return `${number(Math.round((value * 180) / Math.PI))}°`;
    default:
      return percent(value);
  }
}

/** A small line drawing for a button, in the button's colour. */
const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    {paths}
  </svg>
);
const PENCIL = icon(<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />);
const DOWNLOAD = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
const TRASH = icon(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
const RESET = icon(<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />);
const PLAY = icon(<path d="M8 5v14l11-7z" />);
const STOP = icon(<path d="M7 7h10v10H7z" />);

export function Studio({ model, onRename, onDelete, onSave }: {
  model: Model;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  /** Saves what differs from the defaults: false when it was refused, which the page says. */
  onSave: (settings: Partial<ModelSettings>) => Promise<boolean>;
}) {
  const saved = withDefaults(model.settings);
  // A slider's value while it is held, and the value sent and not yet answered: the preview and the controls show them.
  const [held, setHeld] = useState<ModelSettings>();
  const holding = useRef<ModelSettings>();
  const [pending, setPending] = useState<ModelSettings>();
  const drawn = held ?? pending ?? saved;
  const queued = useRef<ModelSettings>();
  const sending = useRef(false);

  const save = async (next: ModelSettings) => {
    setPending(next);
    queued.current = next;
    if (sending.current) return;
    sending.current = true;
    try {
      while (queued.current) {
        const sent = queued.current;
        queued.current = undefined;
        if (!(await onSave(changed(sent)))) {
          // What was changed meanwhile is dropped with it: the controls show what is saved again.
          queued.current = undefined;
          break;
        }
      }
      // The list read after the last save has it, or what is saved is shown again after a refusal.
      setPending(undefined);
    } finally {
      sending.current = false;
    }
  };
  const hold = (next: ModelSettings) => {
    holding.current = next;
    setHeld(next);
  };
  const letGo = () => {
    const next = holding.current;
    if (!next) return;
    holding.current = undefined;
    setHeld(undefined);
    void save(next);
  };
  const set = (patch: Partial<ModelSettings>) => void save({ ...drawn, ...patch });

  return (
    <div role="region" aria-label={model.name} className="rounded-2xl border border-line bg-raised/40 p-4">
      <Header model={model} onRename={onRename} onDelete={onDelete} />
      <div className="mt-3">
        <Licence model={model} />
      </div>
      <div className="mt-5 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6">
        {/* Stays in view while the controls scroll past, so a change is seen as it is made. */}
        <div className="lg:sticky lg:top-0 lg:self-start">
          <Preview model={model} settings={drawn} />
        </div>
        <div className="mt-5 min-w-0 lg:mt-0">
          <Controls
            settings={drawn}
            onMove={(patch) => hold({ ...(holding.current ?? drawn), ...patch })}
            onLetGo={letGo}
            onSet={set}
            onReset={() => {
              holding.current = undefined;
              setHeld(undefined);
              void save({ ...DEFAULT_SETTINGS });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The model's name and what can be done with it. The name is a button that turns into a field, as the portal's own
 * titles do: Enter or clicking away keeps what is typed, Escape puts it back, and an empty or unchanged name counts as
 * not renaming it. Its keys stay in the field: the Settings dialog closes on Escape.
 */
function Header({ model, onRename, onDelete }: { model: Model; onRename: (name: string) => Promise<boolean>; onDelete: () => void }) {
  const { ui } = portal;
  const [renaming, setRenaming] = useState(false);
  const name = useRef<HTMLButtonElement>(null);
  // Back to the name once the field has gone, as it was before it was opened.
  const returning = useRef(false);
  useEffect(() => {
    if (renaming || !returning.current) return;
    returning.current = false;
    name.current?.focus();
  }, [renaming]);
  const finish = (next: string | null) => {
    returning.current = true;
    setRenaming(false);
    if (next) void onRename(next);
  };
  const size = portal.format.number(model.size / (1024 * 1024), { maximumFractionDigits: 1 });
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <h3 className="text-sm font-medium text-fg">
          {renaming ? (
            <NameField value={model.name} onFinish={finish} />
          ) : (
            <button
              ref={name}
              type="button"
              title={t("Rename")}
              onClick={() => setRenaming(true)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg text-left transition hover:text-accent"
            >
              <span className="truncate">{model.name}</span>
              <span className="text-fg-faint">{PENCIL}</span>
            </button>
          )}
        </h3>
        <p className="mt-0.5 text-xs text-fg-subtle">{t("VRM {spec} · {size} MB", { spec: model.spec, size })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={ui.classes.ghost} onClick={() => setRenaming(true)}>
          {PENCIL}
          {t("Rename")}
        </button>
        <a href={portal.api.url(`/models/${model.id}/file`)} download={`${model.name}.vrm`} className={ui.classes.ghost}>
          {DOWNLOAD}
          {t("Download")}
        </a>
        <button type="button" className={`${ui.classes.ghost} hover:bg-danger/10 hover:text-danger`} onClick={onDelete}>
          {TRASH}
          {t("Delete")}
        </button>
      </div>
    </div>
  );
}

/** The name as a field, until it is kept or put back: whichever comes first, as Enter and then the blur it causes both would. */
function NameField({ value, onFinish }: { value: string; onFinish: (name: string | null) => void }) {
  const { ui } = portal;
  const finished = useRef(false);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    const trimmed = next?.trim();
    onFinish(trimmed && trimmed !== value ? trimmed : null);
  };
  return (
    <input
      autoFocus
      defaultValue={value}
      aria-label={t("Rename")}
      maxLength={NAME_MAX}
      className={ui.classes.inputSmall}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Enter" && e.key !== "Escape") return;
        // Not passed on to the name's button, which has the focus again by the time Enter would press it.
        e.preventDefault();
        finish(e.key === "Enter" ? e.currentTarget.value : null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/**
 * The model drawn live in a large dark square, as the Avatar dialog's preview is, in the bust voice mode draws in the
 * middle of its stage or the face it draws in a small box, in a state chosen under it, with the dialog's made-up voice
 * (syllables rising and falling inside slower phrases) while it listens or speaks. Talk plays a whole turn. What is
 * drawn while the model is not says why: still loading, a model that cannot be drawn, or a browser without WebGL 2.
 */
function Preview({ model, settings }: { model: Model; settings: ModelSettings }) {
  const { ui } = portal;
  const [chosen, setChosen] = useState<AvatarMode>("output");
  // The step of the turn Talk plays, while it plays.
  const [step, setStep] = useState<number>();
  const [framing, setFraming] = useState<FramingKind>("bust");
  const [shownNow, setShownNow] = useState<Shown>("loading");
  const mode = step === undefined ? chosen : TURN[step][0];
  const levels = useRef<AvatarLevels>({ input: 0, output: 0 });
  const talkHint = useId();
  useEffect(() => {
    let frame = 0;
    const tick = (ms: number) => {
      const syllable = Math.max(0, Math.sin(ms * 0.012));
      const phrase = 0.55 + 0.45 * Math.sin(ms * 0.0019);
      const value = Math.min(1, syllable * phrase * 0.85 + Math.random() * 0.08);
      levels.current = { input: mode === "input" ? value : 0, output: mode === "output" ? value : 0 };
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  useEffect(() => {
    if (step === undefined) return;
    const next = setTimeout(() => setStep(step + 1 < TURN.length ? step + 1 : undefined), TURN[step][1] * 1000);
    return () => clearTimeout(next);
  }, [step]);
  const why =
    shownNow === "failed" ? t("This model could not be drawn. Voice mode shows the orb for it.")
    : shownNow === "unsupported" ? t("WebGL 2 is not available in this browser, so voice mode shows the orb.")
    : t("Loading the model…");
  return (
    <div className="max-w-[22rem]">
      <div role="region" aria-label={t("Preview")} className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-[#0b1220]">
        {/* The canvas is larger than the box by 3/14 of it on each side: at 70% the canvas fills the square. */}
        <div className="relative aspect-square w-[70%]" data-testid="flair-avatar-preview">
          <Avatar
            model={model}
            mode={mode}
            levels={levels}
            settings={settings}
            framing={framing}
            onShown={setShownNow}
            orb={<p aria-hidden="true" className="absolute inset-0 grid place-items-center text-center text-xs text-[#acc9ee]">{why}</p>}
          />
        </div>
      </div>
      <p role="status" className="sr-only">{shownNow === "drawn" ? "" : why}</p>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ui.Segments
            label={t("Framing")}
            showLabel
            size="sm"
            value={framing}
            onChange={setFraming}
            options={[{ id: "bust", label: t("Bust") }, { id: "face", label: t("Face") }]}
          />
          <button
            type="button"
            className={ui.classes.primarySmall}
            aria-pressed={step !== undefined}
            aria-describedby={talkHint}
            onClick={() => setStep(step === undefined ? 0 : undefined)}
          >
            {step === undefined ? PLAY : STOP}
            {step === undefined ? t("Talk") : t("Stop")}
          </button>
        </div>
        <ui.Segments
          label={t("Preview state")}
          size="sm"
          value={mode}
          onChange={(next) => {
            setChosen(next);
            setStep(undefined);
          }}
          options={STATES.map(([id, label]) => ({ id, label: t(label) }))}
        />
        <p id={talkHint} className="text-[11px] text-fg-faint">{t("Plays a made-up turn: you talk, it thinks, then it answers.")}</p>
      </div>
    </div>
  );
}

/**
 * What can be set on the model, in three tabs as the Avatar dialog groups its own: the camera and the light, how it
 * moves, and its mouth and arms. The labels of `ui.Segments` are passed translated: it says them through the portal's
 * own texts, which do not have the extension's.
 */
function Controls({ settings, onMove, onLetGo, onSet, onReset }: {
  settings: ModelSettings;
  onMove: (patch: Partial<ModelSettings>) => void;
  onLetGo: () => void;
  onSet: (patch: Partial<ModelSettings>) => void;
  onReset: () => void;
}) {
  const { ui } = portal;
  const [tab, setTab] = useState<Tab>("look");
  const ids = useId();
  // Read as the page is drawn: the stage reads it once, as it is made.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slider = (key: NumberKey, label: string, hint: string) => {
    const { min, max, step } = RANGES[key];
    const said = shown(key, settings[key]);
    return (
      <label key={key} className="block text-xs text-fg-muted">
        <span className="flex justify-between gap-3">
          <span id={`${ids}-${key}-name`}>{t(label)}</span>
          <span className="tabular-nums text-accent">{said}</span>
        </span>
        <input
          type="range"
          className="mt-1.5 w-full accent-current"
          min={min}
          max={max}
          step={step}
          value={settings[key]}
          // Named by its name alone: its value is said as it is shown, and what it does is its description.
          aria-labelledby={`${ids}-${key}-name`}
          aria-valuetext={said}
          aria-describedby={`${ids}-${key}`}
          onChange={(e) => onMove({ [key]: Number(e.target.value) })}
          onPointerUp={onLetGo}
          onKeyUp={onLetGo}
          onBlur={onLetGo}
        />
        <span id={`${ids}-${key}`} className="mt-0.5 block text-[11px] text-fg-faint">{t(hint)}</span>
      </label>
    );
  };
  const sliders = (of: Tab) => SLIDERS.filter(([inTab]) => inTab === of).map(([, key, label, hint]) => slider(key, label, hint));
  const gazeHint = GAZE.find(([id]) => id === settings.gaze)![2];
  return (
    <div data-setting={t("Look and motion")}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{t("Look and motion")}</h4>
      <p className="mt-0.5 text-xs text-fg-subtle">{t("Saved as you change them, for this model wherever it is drawn: here, in voice mode and in each agent's Avatar dialog.")}</p>
      <div role="tablist" aria-label={t("Settings of this model")} className="mt-3 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" onKeyDown={ui.tabKeys}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            id={`${ids}-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-1.5 text-xs transition ${tab === id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="space-y-4 pt-4">
        {tab === "motion" && reduced && (
          <p className="text-[11px] text-fg-faint">
            {t("Your system asks for less motion: breathing, sway and eye movement stay off, and leaning in and the thinking pose are at most half as strong, whatever is set here.")}
          </p>
        )}
        {sliders(tab)}
        {tab === "motion" && (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-xs text-fg-muted">
                {t("Thinking pose")}
                <span className="mt-0.5 block text-[11px] text-fg-faint">{t("Tilts its head and looks away while the agent works on its answer.")}</span>
              </div>
              <ui.Switch on={settings.thinkingPose} label={t("Thinking pose")} onChange={(on) => onSet({ thinkingPose: on })} />
            </div>
            <div>
              <p className="text-xs text-fg-muted">{t("Gaze")}</p>
              <div className="mt-1.5">
                <ui.Segments label={t("Gaze")} size="sm" value={settings.gaze} onChange={(gaze) => onSet({ gaze })} options={GAZE.map(([id, label]) => ({ id, label: t(label) }))} />
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">{t(gazeHint)}</p>
            </div>
          </>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" className={ui.classes.ghost} disabled={Object.keys(changed(settings)).length === 0} onClick={onReset}>
          {RESET}
          {t("Reset to defaults")}
        </button>
      </div>
    </div>
  );
}
