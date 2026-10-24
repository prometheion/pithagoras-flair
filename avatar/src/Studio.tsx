import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import type { AvatarLevels, AvatarMode } from "@pithagoras/extension-api";
import { Avatar } from "./Avatar";
import { CLIP_GESTURES, type ClipGesture } from "./gestures";
import { Licence } from "./Licence";
import type { Model } from "./model";
import { changed, DEFAULT_SETTINGS, RANGES, withDefaults, type Gaze, type ModelSettings, type NumberKey } from "./model-settings";
import { msg, portal, t } from "./portal";
import type { Cue, FramingKind, Shown } from "./stage";
import { NAME_MAX } from "./vrm-file";

/**
 * The model chosen on the Settings page, as a card of its own: its name (renamed in place), its file to download, a
 * way to delete it, what its licence says, a large live preview, and what can be set on it beside the preview.
 *
 * The preview stays in view while what is set scrolls past it, so a change is seen as it is made. Where the card is
 * 36rem wide or more it is beside the settings, as wide as there is room for up to 36rem and 62% of the screen's
 * height, so it and its controls fit the Settings dialog; narrower, as on a phone or a tablet's narrow dialog, it is
 * over them, held at the top of the page as they scroll under it, a third of the screen's height. The card is a size
 * container for that: it is the card's width that counts, not the screen's, whatever the dialog has beside it.
 *
 * What is set is saved as it is changed: a slider when it is let go, a switch or a choice at once. The preview draws
 * a slider's value while it is still held, and the saved settings reach every avatar of the model wherever it is drawn
 * (models.ts). Saves go one at a time, the newest last, so the server keeps the last change whatever order two
 * answers would come in; a refused one is said over the page, and what is shown goes back to what is saved. Reset to
 * defaults is saved at once too, and can be undone until something else is changed: what was set before it is kept
 * for that, here, while the model is the one chosen.
 *
 * The model's gesture clips are uploaded and removed in the Motion group, each saved at once (they are files, not
 * settings: Reset to defaults leaves them), and Try makes a gesture in the preview, with its clip or without.
 */

/** The preview's states, in the words of the portal's own Avatar dialog. */
const STATES: [AvatarMode, string][] = [
  ["idle", msg("Idle")], ["input", msg("Listening")], ["output", msg("Speaking")], ["thinking", msg("Thinking")], ["muted", msg("Muted")],
];

/** The preview's framings: the bust voice mode draws in the middle of its stage, and the face it draws in a small box. */
const FRAMINGS: [FramingKind, string][] = [["bust", msg("Bust")], ["face", msg("Face")]];

/**
 * What the Talk button plays, each state for so many seconds: the person talks, the agent thinks (long enough for the
 * thinking pose, which starts after 0.6 s), and its reply is spoken with the made-up voice.
 */
const TURN: [AvatarMode, number][] = [["input", 2.5], ["thinking", 2], ["output", 4]];

/** The groups the settings are shown in, one under the other, each under a heading of its own. */
type Group = "camera" | "light" | "motion" | "eyes" | "voice" | "arms";
const GROUPS: [Group, string][] = [
  ["camera", msg("Camera")], ["light", msg("Light")], ["motion", msg("Motion")], ["eyes", msg("Eyes")], ["voice", msg("Voice")], ["arms", msg("Arms")],
];

/** Each slider: the group it is in, its setting, its name and what it does. */
const SLIDERS: [Group, NumberKey, string, string][] = [
  ["camera", "zoom", msg("Zoom"), msg("How close the camera is.")],
  ["camera", "height", msg("Height"), msg("Moves the model up or down in its box.")],
  ["light", "brightness", msg("Brightness"), msg("How strongly the light falls on it.")],
  ["light", "warmth", msg("Warmth"), msg("The colour of the light, from cool to warm.")],
  ["motion", "motion", msg("Overall motion"), msg("All of its own movement: breathing, sway, eye movement, nodding, leaning in, the thinking pose and its gestures. It blinks and speaks either way.")],
  ["motion", "breathing", msg("Breathing and sway"), msg("How much its chest rises and its head sways while it waits.")],
  ["motion", "lean", msg("Leaning in"), msg("How far it leans towards you while you talk.")],
  [
    "motion",
    "gestures",
    msg("Gestures"),
    msg("How much it moves its hands and head on the words it stresses, nods while you talk, waves as voice mode starts, puts a hand to its chin on a long think, and shifts its weight and stretches while it waits."),
  ],
  ["eyes", "blinkRate", msg("Blinking"), msg("How often it blinks.")],
  ["voice", "mouth", msg("Mouth sensitivity"), msg("How wide the mouth opens at the same loudness. Raise it for a quiet voice.")],
  ["arms", "armDown", msg("Arm angle"), msg("How far the arms come down from the T-pose. Change it when the arms go into the body or stand out stiffly.")],
];

/** The gestures a clip can be uploaded for, each with its name and when it is made. */
const CLIPS: Record<ClipGesture, [string, string]> = {
  greeting: [msg("Wave"), msg("As voice mode starts.")],
  thinking: [msg("Hand to the chin"), msg("When the agent thinks for more than a moment.")],
};

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
const UNDO = icon(<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />);
const PLAY = icon(<path d="M8 5v14l11-7z" />);
const STOP = icon(<path d="M7 7h10v10H7z" />);

export function Studio({ model, onRename, onDelete, onSave, onClip, onRemoveClip, previewRef }: {
  model: Model;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  /** Saves what differs from the defaults: false when it was refused, which the page says. */
  onSave: (settings: Partial<ModelSettings>) => Promise<boolean>;
  /** Uploads a clip for a gesture, or removes the one it has: the page says it when that is refused. */
  onClip: (gesture: ClipGesture, file: File) => void;
  onRemoveClip: (gesture: ClipGesture) => void;
  /** The preview with its controls, for the page to bring into view when a model is chosen. */
  previewRef?: Ref<HTMLDivElement>;
}) {
  const saved = withDefaults(model.settings);
  // A slider's value while it is held, and the value sent and not yet answered: the preview and the controls show them.
  const [held, setHeld] = useState<ModelSettings>();
  const holding = useRef<ModelSettings>();
  const [pending, setPending] = useState<ModelSettings>();
  const drawn = held ?? pending ?? saved;
  const queued = useRef<ModelSettings>();
  const sending = useRef(false);
  // What was set before Reset to defaults, for Undo, until any other change.
  const [undo, setUndo] = useState<ModelSettings>();
  // The gesture Try last asked the preview for.
  const [cue, setCue] = useState<Cue>();

  const save = async (next: ModelSettings) => {
    setPending(next);
    setUndo(undefined);
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
    <div role="region" aria-label={model.name} className="rounded-2xl border border-line bg-raised/40 p-4 [container-type:inline-size]">
      <Header model={model} onRename={onRename} onDelete={onDelete} />
      <div className="mt-3">
        <Licence model={model} />
      </div>
      <div className="mt-5 grid gap-4 [@container(min-width:36rem)]:grid-cols-[minmax(0,3fr)_minmax(14rem,2fr)] [@container(min-width:36rem)]:gap-6">
        {/* Held at the top of the page. Over the settings, it hides them as they scroll under it: the card's own colour,
            as the card's is the page's under its own. The Settings pane's padding (1rem) would leave a strip above it
            that they show in: it is held that much higher, over a band of its colour, and is that much higher in the
            card as well, so it is where it was until it is held. */}
        <div ref={previewRef} className="sticky -top-4 z-10 -mt-4 bg-surface [@container(min-width:36rem)]:self-start">
          <div className="bg-raised/40 pb-3 pt-4">
            <Preview model={model} settings={drawn} cue={cue} />
          </div>
        </div>
        <div className="min-w-0">
          <Controls
            settings={drawn}
            onMove={(patch) => hold({ ...(holding.current ?? drawn), ...patch })}
            onLetGo={letGo}
            onSet={set}
            onReset={() => {
              holding.current = undefined;
              setHeld(undefined);
              void save({ ...DEFAULT_SETTINGS });
              setUndo(drawn);
            }}
            onUndo={undo && (() => void save(undo))}
            clips={model.clips}
            onClip={onClip}
            onRemoveClip={onRemoveClip}
            onTry={(gesture) => setCue({ gesture })}
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
 * middle of its stage or the face it draws in a small box (chosen on the square's corner, as a camera's), in a state
 * chosen under it, with the dialog's made-up voice (syllables rising and falling inside slower phrases) while it
 * listens or speaks. Talk, beside the states it plays through, plays a whole turn. What is drawn while the model is not
 * says why: still loading, a model that cannot be drawn, or a browser without WebGL 2. `cue` is a gesture Try asks for.
 *
 * The square's height is a share of the screen's small viewport (svh), which does not change as a phone's address bar
 * comes and goes: the model is not drawn at a new size as the page scrolls. The five states are one row of equal
 * cells, small enough for German on a phone, as in the Avatar dialog.
 */
function Preview({ model, settings, cue }: { model: Model; settings: ModelSettings; cue?: Cue }) {
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
    <div className="mx-auto w-full [@container(min-width:36rem)]:max-w-[min(36rem,62svh)]">
      <div
        role="region"
        aria-label={t("Preview")}
        className="relative mx-auto grid aspect-square w-full max-w-[34svh] place-items-center overflow-hidden rounded-xl bg-[#0b1220] [@container(min-width:36rem)]:max-w-none"
      >
        {/* The canvas is larger than the box by 3/14 of it on each side: at 70% the canvas fills the square. */}
        <div className="relative aspect-square w-[70%]" data-testid="flair-avatar-preview">
          <Avatar
            model={model}
            mode={mode}
            levels={levels}
            settings={settings}
            framing={framing}
            cue={cue}
            onShown={setShownNow}
            orb={<p aria-hidden="true" className="absolute inset-0 grid place-items-center text-center text-xs text-[#acc9ee]">{why}</p>}
          />
        </div>
        {/* On the dark square in either theme, so in its colours, not the theme's. */}
        <div role="radiogroup" aria-label={t("Framing")} className="absolute right-2 top-2 flex gap-0.5 rounded-lg bg-[#0b1220]/80 p-0.5 ring-1 ring-inset ring-white/10">
          {FRAMINGS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={framing === id}
              onClick={() => setFraming(id)}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${framing === id ? "bg-white/15 text-white" : "text-[#acc9ee] hover:text-white"}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">{shownNow === "drawn" ? "" : why}</p>
      <div role="radiogroup" aria-label={t("Preview state")} className="mt-2 grid grid-cols-5 gap-1">
        {STATES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => {
              setChosen(id);
              setStep(undefined);
            }}
            className={`rounded-md px-1 py-1 text-[11px] transition ${mode === id ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25" : "bg-fg/5 text-fg-muted hover:bg-fg/10"}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <button type="button" className={`shrink-0 ${ui.classes.primarySmall}`} aria-describedby={talkHint} onClick={() => setStep(step === undefined ? 0 : undefined)}>
          {step === undefined ? PLAY : STOP}
          {step === undefined ? t("Talk") : t("Stop")}
        </button>
        <p id={talkHint} className="min-w-0 text-[11px] text-fg-faint">{t("Plays a made-up turn: you talk, it thinks, then it answers.")}</p>
      </div>
    </div>
  );
}

/**
 * What can be set on the model, all of it at once in one column, in groups under headings of their own: the camera,
 * the light, how it moves (with its gesture clips), its eyes, its voice and its arms. A value that differs from the default is shown in the
 * accent colour. Reset to defaults is on the column's heading, as it puts back all of it, and turns into Undo once
 * pressed, until something else is changed. The labels of `ui.Segments` are passed translated: it says them through
 * the portal's own texts, which do not have the extension's.
 */
function Controls({ settings, onMove, onLetGo, onSet, onReset, onUndo, clips, onClip, onRemoveClip, onTry }: {
  settings: ModelSettings;
  onMove: (patch: Partial<ModelSettings>) => void;
  onLetGo: () => void;
  onSet: (patch: Partial<ModelSettings>) => void;
  onReset: () => void;
  /** Puts back what was set before Reset to defaults, while that can be done. */
  onUndo?: () => void;
  clips: Model["clips"];
  onClip: (gesture: ClipGesture, file: File) => void;
  onRemoveClip: (gesture: ClipGesture) => void;
  onTry: (gesture: ClipGesture) => void;
}) {
  const { ui } = portal;
  const ids = useId();
  // Read as the page is drawn: the stage reads it once, as it is made.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sliders = (of: Group) =>
    SLIDERS.filter(([group]) => group === of).map(([, key, label, hint]) => (
      <Slider
        key={key}
        setting={key}
        label={label}
        hint={hint}
        value={settings[key]}
        differs={settings[key] !== DEFAULT_SETTINGS[key]}
        onMove={(value) => onMove({ [key]: value })}
        onLetGo={onLetGo}
      />
    ));
  const gazeHint = GAZE.find(([id]) => id === settings.gaze)![2];
  return (
    <div data-setting={t("Look and motion")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{t("Look and motion")}</h4>
        <div className="flex items-center gap-2">
          <p role="status" className="text-[11px] text-fg-faint">{onUndo ? t("Back to the defaults.") : ""}</p>
          {/* One button for both, so it keeps the focus as it turns from one into the other. */}
          <button
            type="button"
            className={ui.classes.ghost}
            disabled={!onUndo && Object.keys(changed(settings)).length === 0}
            onClick={onUndo ?? onReset}
          >
            {onUndo ? UNDO : RESET}
            {onUndo ? t("Undo") : t("Reset to defaults")}
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-fg-subtle">{t("Saved as you change them, for this model wherever it is drawn: here, in voice mode and in each agent's Avatar dialog.")}</p>
      {GROUPS.map(([group, title]) => (
        <div key={group} role="group" aria-labelledby={`${ids}-${group}`} className="mt-4 space-y-4 border-t border-line pt-4">
          <h5 id={`${ids}-${group}`} className="text-xs font-medium text-fg">{t(title)}</h5>
          {group === "motion" && reduced && (
            <p className="text-[11px] text-fg-faint">
              {t("Your system asks for less motion: breathing, sway, eye movement and gestures stay off, and leaning in and the thinking pose are at most half as strong, whatever is set here.")}
            </p>
          )}
          {group === "eyes" && (
            <div>
              <p className="text-xs text-fg-muted">{t("Gaze")}</p>
              <div className="mt-1.5">
                <ui.Segments label={t("Gaze")} size="sm" value={settings.gaze} onChange={(gaze) => onSet({ gaze })} options={GAZE.map(([id, label]) => ({ id, label: t(label) }))} />
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">{t(gazeHint)}</p>
            </div>
          )}
          {sliders(group)}
          {group === "motion" && (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-xs text-fg-muted">
                {t("Thinking pose")}
                <span className="mt-0.5 block text-[11px] text-fg-faint">{t("Tilts its head and looks away while the agent works on its answer.")}</span>
              </div>
              <ui.Switch on={settings.thinkingPose} label={t("Thinking pose")} onChange={(on) => onSet({ thinkingPose: on })} />
            </div>
          )}
          {group === "motion" && (
            <div>
              <p className="text-xs text-fg-muted">{t("Gesture clips")}</p>
              <p className="mt-0.5 text-[11px] text-fg-faint">
                {t("A VRM Animation file (.vrma) uploaded here plays in place of the built-in gesture. Try shows it in the preview.")}
              </p>
              <div className="mt-2 space-y-2">
                {CLIP_GESTURES.map((gesture) => (
                  <ClipRow key={gesture} gesture={gesture} file={clips?.[gesture]} onClip={onClip} onRemove={onRemoveClip} onTry={onTry} />
                ))}
              </div>
            </div>
          )}
          {group === "voice" && (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 text-xs text-fg-muted">
                {t("Mouth shapes")}
                <span className="mt-0.5 block text-[11px] text-fg-faint">
                  {t("Shapes its mouth for a vowel on each syllable, guessed from how loud the voice is. Off, it only opens and shuts.")}
                </span>
              </div>
              <ui.Switch on={settings.mouthShapes} label={t("Mouth shapes")} onChange={(on) => onSet({ mouthShapes: on })} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A gesture's clip: its name and when it is made, the clip's file name or that the gesture is its own, and Try, Upload
 * (Replace once there is one) and Remove. A file is uploaded as it is picked; the page says it when it is refused.
 */
function ClipRow({ gesture, file, onClip, onRemove, onTry }: {
  gesture: ClipGesture;
  file?: NonNullable<Model["clips"]>[ClipGesture];
  onClip: (gesture: ClipGesture, file: File) => void;
  onRemove: (gesture: ClipGesture) => void;
  onTry: (gesture: ClipGesture) => void;
}) {
  const { ui } = portal;
  const picker = useRef<HTMLInputElement>(null);
  const [name, when] = CLIPS[gesture];
  return (
    <div role="group" aria-label={t(name)} data-clip={gesture} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-40 text-xs text-fg-muted">
        {t(name)}
        <span className="mt-0.5 block truncate text-[11px] text-fg-faint" title={file?.name}>
          {t(when)} {file ? file.name : t("Built in.")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={ui.classes.ghost} onClick={() => onTry(gesture)}>
          {t("Try")}
        </button>
        <button type="button" className={ui.classes.ghost} onClick={() => picker.current?.click()}>
          {file ? t("Replace") : t("Upload")}
        </button>
        {file && (
          <button type="button" className={ui.classes.ghost} onClick={() => onRemove(gesture)}>
            {t("Remove")}
          </button>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept=".vrma"
        hidden
        data-testid={`flair-avatar-clip-${gesture}`}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onClip(gesture, picked);
        }}
      />
    </div>
  );
}

/**
 * A setting on a slider, its value shown beside its name (in the accent colour when it `differs` from the default)
 * and said as it is shown. The value is drawn while the slider
 * is held (`onMove`, React's onChange, which is the input event) and saved when it is let go (`onLetGo`): on the
 * input's own change event, which the browser fires once a value is set, whether by a pointer let go, a key, or a
 * screen reader's gesture to raise or lower it, which moves neither a pointer nor a key nor the focus. React has no
 * handler for that event of its own.
 */
function Slider({ setting, label, hint, value, differs, onMove, onLetGo }: {
  setting: NumberKey;
  label: string;
  hint: string;
  value: number;
  differs: boolean;
  onMove: (value: number) => void;
  onLetGo: () => void;
}) {
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const letGo = useRef(onLetGo);
  letGo.current = onLetGo;
  useEffect(() => {
    const slider = input.current!;
    const set = () => letGo.current();
    slider.addEventListener("change", set);
    return () => slider.removeEventListener("change", set);
  }, []);
  const { min, max, step } = RANGES[setting];
  const said = shown(setting, value);
  return (
    <label className="block text-xs text-fg-muted">
      <span className="flex justify-between gap-3">
        <span id={`${ids}-name`}>{t(label)}</span>
        <span className={`tabular-nums ${differs ? "text-accent" : "text-fg-subtle"}`}>{said}</span>
      </span>
      <input
        ref={input}
        type="range"
        className="mt-1.5 w-full accent-current"
        min={min}
        max={max}
        step={step}
        value={value}
        // Named by its name alone: its value is said as it is shown, and what it does is its description.
        aria-labelledby={`${ids}-name`}
        aria-valuetext={said}
        aria-describedby={`${ids}-hint`}
        onChange={(e) => onMove(Number(e.target.value))}
      />
      <span id={`${ids}-hint`} className="mt-0.5 block text-[11px] text-fg-faint">{t(hint)}</span>
    </label>
  );
}
