import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { ApiError } from "@pithagoras/extension-api";
import type { Model } from "./model";
import { withDefaults, type ModelSettings } from "./model-settings";
import { refreshModels } from "./models";
import { msg, portal, t } from "./portal";
import { makePortrait, portraitStamp } from "./stage";
import { Studio } from "./Studio";

const api = {
  list: () => portal.api.json<{ models: Model[] }>(portal.api.url("/models")).then((answer) => answer.models),
  // The file as it is: `api.json` merges its headers over its JSON default.
  upload: (file: File) =>
    portal.api.json<{ model: Model }>(portal.api.url(`/models?name=${encodeURIComponent(file.name)}`), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }),
  portrait: (id: string, png: Blob, stamp: string) =>
    portal.api.json<{ model: Model }>(portal.api.url(`/models/${id}/portrait?stamp=${encodeURIComponent(stamp)}`), { method: "PUT", headers: { "Content-Type": "image/png" }, body: png }),
  rename: (id: string, name: string) => portal.api.json<{ model: Model }>(portal.api.url(`/models/${id}`), { method: "PATCH", body: JSON.stringify({ name }) }),
  settings: (id: string, settings: Partial<ModelSettings>) =>
    portal.api.json<{ model: Model }>(portal.api.url(`/models/${id}/settings`), { method: "PUT", body: JSON.stringify({ settings }) }),
  remove: (id: string) => portal.api.json(portal.api.url(`/models/${id}`), { method: "DELETE" }),
};

/** What the server refused, in the page's language by its code; anything else as it was said. */
function refusal(e: unknown): string {
  const { code, detail } = (e as Partial<ApiError>).body ?? {};
  if (code === "not-glb" || code === "not-vrm") return t("This is not a VRM file.");
  if (code === "too-large") return t("The model is larger than 64 MB.");
  if (code === "missing-bone") return t("The model has no {bone} bone, which an avatar needs.", { bone: String(detail) });
  if (code === "compressed") return t("The model is compressed in a way this extension cannot read ({name}).", { name: String(detail) });
  if (code === "external") return t("The model loads parts of itself from outside its file, which this extension does not allow.");
  if (code === "bad-name") return t("The name must be 1 to 80 characters.");
  return (e as Error).message;
}

/**
 * Free models to start with, each with what its file says of its licence, checked against what this extension takes
 * and drawn as it is, with no setting changed: each a name, where it is, and a note to be translated.
 */
const FREE: [string, string, string][] = [
  ["AvatarSample_B", "https://raw.githubusercontent.com/pixiv/ChatVRM/main/public/AvatarSample_B.vrm", msg("By VRoid Project. VRM 1.0, 20 MB. VRM Public License 1.0: commercial use allowed, no credit needed, may be passed on. VRoid's own terms for its sample models apply as well.")],
  [
    "VRM1_Constraint_Twist_Sample",
    "https://raw.githubusercontent.com/pixiv/three-vrm/5a3242b66124386c32b085c6693d9059040e72e5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm",
    msg("By pixiv. VRM 1.0, 10 MB. VRM Public License 1.0: commercial use allowed, no credit needed, may be passed on."),
  ],
  ["Vita", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vita.vrm", msg("A sample from VRoid Studio's beta. VRM 0.x, 14 MB. CC0: free to use for anything, no credit needed.")],
  ["VRoid Studio", "https://vroid.com/en/studio", msg("Make your own: a free app for Windows and macOS that saves VRM files.")],
];

/** The plus of the Add a model card. */
const PLUS = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * The 3D Avatar's page in Settings: the models as a gallery of cards, added from VRM files picked or dropped on it, and
 * the one chosen in a card of its own under them (Studio.tsx), with what its licence says, a live preview in the five
 * states voice mode shows, and what can be set on it. An agent is given a model in its own Avatar dialog, which lists
 * them beside the orb. With no models yet, the page says where free ones are.
 *
 * The picture of a model that an agent's card shows is made here, in this browser, for each model whose picture is not
 * what it would draw now (`portraitStamp`: one made before its settings changed, or before a change to how models are
 * drawn, or none yet): when the page is opened, after a model is added and after its settings are saved. One at a
 * time, each with a drawing context of its own for a moment, and from the latest list after each, so a run of changes
 * ends in one picture of the last. The Agents page makes none: it uses no drawing context.
 */
export function Settings() {
  portal.locale.use();
  const { ui } = portal;
  const [models, setModels] = useState<Model[]>();
  const [loadFailed, setLoadFailed] = useState<string>();
  const [failure, setFailure] = useState<string>();
  // The file being uploaded, by its name.
  const [uploading, setUploading] = useState<string>();
  const [chosen, setChosen] = useState<string>();
  const [dragging, setDragging] = useState(false);
  // What a screen reader is told once a model is added.
  const [said, setSaid] = useState("");
  // The model whose portrait is being made, and those that could not be drawn, each with the stamp it was tried with.
  const [making, setMaking] = useState<string>();
  const [undrawable, setUndrawable] = useState<ReadonlySet<string>>(new Set());
  const file = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  // Drags over the gallery's children each enter and leave it: it is left when as many have left as entered.
  const depth = useRef(0);
  // Where the focus goes once the list is drawn again: a model's card, or the Add button.
  const focusNext = useRef<string>();
  // The latest list read, which the portraits are made from, and each list asked for: an answer that comes after a
  // later one's is not used, or a portrait due for the later one would not be seen.
  const latest = useRef<Model[]>([]);
  const asked = useRef(0);
  // Whether portraits are being made now: one run at a time, which reads the latest list after each.
  const painting = useRef(false);
  const failed = useRef(new Set<string>());

  // The list again, and the entries offered as avatars with it.
  const reload = useCallback(async () => {
    const mine = ++asked.current;
    const listed = await api.list();
    if (mine === asked.current) {
      latest.current = listed;
      setModels(listed);
    }
    void refreshModels();
  }, []);
  const paint = useCallback(async () => {
    if (painting.current) return;
    painting.current = true;
    try {
      for (;;) {
        const due = latest.current
          .map((model) => ({ model, stamp: portraitStamp(withDefaults(model.settings)) }))
          .find(({ model, stamp }) => model.portraitStamp !== stamp && !failed.current.has(`${model.id}|${stamp}`));
        if (!due) return;
        setMaking(due.model.id);
        try {
          await api.portrait(due.model.id, await makePortrait(due.model), due.stamp);
        } catch (e) {
          // Not tried again with these settings while the page is open: its card says so, and its preview says why.
          console.warn(`3D Avatar: no portrait of ${due.model.name}`, e);
          failed.current.add(`${due.model.id}|${due.stamp}`);
          setUndrawable(new Set(failed.current));
          continue;
        }
        await reload();
      }
    } finally {
      painting.current = false;
      setMaking(undefined);
    }
  }, [reload]);
  const load = useCallback(() => {
    setLoadFailed(undefined);
    api.list().then(
      (listed) => {
        latest.current = listed;
        setModels(listed);
        void paint();
      },
      (e) => setLoadFailed((e as Error).message),
    );
  }, [paint]);
  useEffect(load, [load]);
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    const to = want === "add" ? add.current : gallery.current?.querySelector<HTMLElement>(`[data-model="${want}"]`);
    if (!to) return;
    focusNext.current = undefined;
    to.focus();
  }, [models]);

  if (loadFailed) return <ui.LoadFailed error={loadFailed} onRetry={load} />;
  if (!models) return <ui.RowsSkeleton rows={2} label={t("Loading…")} />;

  // What it did, or false with why it could not over the page.
  const run = async (work: () => Promise<unknown>) => {
    setFailure(undefined);
    try {
      await work();
      return true;
    } catch (e) {
      setFailure(refusal(e));
      return false;
    }
  };
  // One after another; a file refused is said with its name when there were several, and the next is still added.
  const upload = async (files: File[]) => {
    setFailure(undefined);
    const refused: string[] = [];
    for (const picked of files) {
      setUploading(picked.name);
      try {
        const { model } = await api.upload(picked);
        await reload();
        setChosen(model.id);
        setSaid(t("Added {name}.", { name: model.name }));
        void paint();
      } catch (e) {
        refused.push(files.length === 1 ? refusal(e) : t("{file}: {reason}", { file: picked.name, reason: refusal(e) }));
      }
    }
    setUploading(undefined);
    if (file.current) file.current.value = "";
    if (refused.length) setFailure(refused.join("\n"));
  };
  const remove = (model: Model) =>
    run(async () => {
      const asking = t("Delete {name}? Agents that use it show the orb again.", { name: model.name });
      if (ui.asksBeforeDeleting() && !(await ui.confirm({ title: asking, confirmLabel: t("Delete"), danger: true, deletes: true }))) return;
      await api.remove(model.id);
      // The next by name, or the one before for the last; with none left, the way to add one.
      const at = models.findIndex((m) => m.id === model.id);
      const rest = models.filter((m) => m.id !== model.id);
      const next = rest[Math.min(at, rest.length - 1)];
      setChosen(next?.id);
      focusNext.current = next?.id ?? "add";
      await reload();
    });
  const choose = () => {
    // Kept focused while it uploads: a button that is disabled loses the focus.
    if (!uploading) file.current?.click();
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const drops = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current--;
      if (depth.current === 0) setDragging(false);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!uploading) void upload([...e.dataTransfer.files]);
    },
  };
  const addLabel = uploading ? t("Uploading {name}…", { name: uploading }) : dragging ? t("Drop to add") : t("Add a model");
  const previewed = models.find((m) => m.id === chosen) ?? models[0];

  return (
    <div className="space-y-5">
      {failure && <ui.ErrorBanner onClose={() => setFailure(undefined)}>{failure}</ui.ErrorBanner>}
      <ui.Section
        title={t("Models")}
        hint={t("VRM files (.vrm). Choose one for an agent in its Avatar dialog: on the Agents page, open the agent and use the palette on its avatar.")}
      >
        <div ref={gallery} {...drops}>
          {models.length === 0 ? (
            <>
              <div
                data-testid="flair-avatar-empty"
                className={`rounded-xl border border-dashed px-3 py-8 text-center text-sm transition motion-reduce:transition-none ${dragging ? "border-accent/60 bg-accent/5 text-accent" : "border-line text-fg-subtle"}`}
              >
                <p>{t("No models yet.")}</p>
                <p className="mt-1 text-xs">{t("Add a VRM file to give an agent a 3D character in voice mode.")}</p>
                <button ref={add} type="button" className={`mt-3 ${ui.classes.primarySmall}`} aria-disabled={uploading ? true : undefined} onClick={choose}>
                  {addLabel}
                </button>
                <p className="mt-1.5 text-[11px] text-fg-faint">{t("Choose a .vrm file, or drop one here")}</p>
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium text-fg-muted">{t("Free models to start with")}</p>
                <ul className="mt-1.5 space-y-1.5 text-xs">
                  {FREE.map(([name, href, note]) => (
                    <li key={name}>
                      <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                        {name}
                      </a>{" "}
                      <span className="text-fg-muted">{t(note)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-fg-faint">
                  {t("Download one, then drop it above. Each model's terms are its author's: check them before you use one in something you make money with.")}
                </p>
              </div>
            </>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
              {models.map((model) => (
                <li key={model.id}>
                  <Card
                    model={model}
                    chosen={model.id === previewed?.id}
                    making={making === model.id}
                    undrawable={undrawable.has(`${model.id}|${portraitStamp(withDefaults(model.settings))}`)}
                    onChoose={() => setChosen(model.id)}
                  />
                </li>
              ))}
              <li>
                <button
                  ref={add}
                  type="button"
                  aria-disabled={uploading ? true : undefined}
                  onClick={choose}
                  className={`flex h-full min-h-[10rem] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2 text-center transition motion-reduce:transition-none ${
                    dragging ? "border-accent/60 bg-accent/5 text-accent" : "border-line text-fg-subtle hover:bg-fg/5 hover:text-fg"
                  } ${uploading ? "cursor-progress" : ""}`}
                >
                  {PLUS}
                  <span className="text-xs font-medium [overflow-wrap:anywhere]">{addLabel}</span>
                  <span className="text-[11px] text-fg-faint">{t("Choose a .vrm file, or drop one here")}</span>
                </button>
              </li>
            </ul>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept=".vrm"
          multiple
          hidden
          data-testid="flair-avatar-file"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            if (picked.length) void upload(picked);
          }}
        />
        <p role="status" className="sr-only">{said}</p>
      </ui.Section>
      {previewed && (
        <Studio
          key={previewed.id}
          model={previewed}
          onRename={(name) =>
            run(async () => {
              await api.rename(previewed.id, name);
              await reload();
            })
          }
          onDelete={() => void remove(previewed)}
          onSave={(settings) =>
            run(async () => {
              await api.settings(previewed.id, settings);
              await reload();
              void paint();
            })
          }
        />
      )}
    </div>
  );
}

/** A model in the gallery, which chooses it: its portrait, name, VRM version and size. */
function Card({ model, chosen, making, undrawable, onChoose }: { model: Model; chosen: boolean; making: boolean; undrawable: boolean; onChoose: () => void }) {
  const size = portal.format.number(model.size / (1024 * 1024), { maximumFractionDigits: 1 });
  return (
    <button
      type="button"
      aria-pressed={chosen}
      data-model={model.id}
      onClick={onChoose}
      className={`block w-full rounded-xl border p-2 text-left transition motion-reduce:transition-none ${chosen ? "border-accent/50 bg-accent/10" : "border-line hover:bg-fg/5"}`}
    >
      <span className={`grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-[#0b1220] ${making ? "animate-pulse motion-reduce:animate-none" : ""}`}>
        {undrawable ? (
          <span className="px-2 text-center text-[11px] text-fg-faint">{t("Cannot be drawn")}</span>
        ) : (
          model.portrait && <img src={portal.api.url(`/models/${model.id}/portrait?v=${encodeURIComponent(model.portrait)}`)} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="mt-1.5 block truncate text-xs font-medium text-fg" title={model.name}>
        {model.name}
      </span>
      <span className="block truncate text-[11px] text-fg-subtle">{t("VRM {spec} · {size} MB", { spec: model.spec, size })}</span>
    </button>
  );
}
