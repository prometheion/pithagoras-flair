import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiError, AvatarLevels, AvatarMode } from "@pithagoras/extension-api";
import { Avatar } from "./Avatar";
import type { Model } from "./model";
import { refreshModels } from "./models";
import { msg, portal, t } from "./portal";
import { makePortrait, type Shown } from "./stage";

/** The preview's states, in the words of the portal's own Avatar dialog. */
const STATES: [AvatarMode, string][] = [
  ["idle", msg("Idle")], ["input", msg("Listening")], ["output", msg("Speaking")], ["thinking", msg("Thinking")], ["muted", msg("Muted")],
];

const api = {
  list: () => portal.api.json<{ models: Model[] }>(portal.api.url("/models")).then((answer) => answer.models),
  // The file as it is: `api.json` merges its headers over its JSON default.
  upload: (file: File) =>
    portal.api.json<{ model: Model }>(portal.api.url(`/models?name=${encodeURIComponent(file.name)}`), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }),
  portrait: (id: string, png: Blob) => portal.api.json<{ model: Model }>(portal.api.url(`/models/${id}/portrait`), { method: "PUT", headers: { "Content-Type": "image/png" }, body: png }),
  rename: (id: string, name: string) => portal.api.json<{ model: Model }>(portal.api.url(`/models/${id}`), { method: "PATCH", body: JSON.stringify({ name }) }),
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
 * The 3D Avatar's page in Settings: the models, added from a VRM file, each with what it says of its own licence, and
 * a live preview of the one chosen, in the five states voice mode shows. An agent is given a model in its own Avatar
 * dialog, which lists them beside the orb.
 *
 * The picture of a model that an agent's card shows is made here, in this browser, after the model is added, and for
 * any model without one when the page is opened: one at a time, each with a drawing context of its own for a moment.
 */
export function Settings() {
  portal.locale.use();
  const { ui } = portal;
  const [models, setModels] = useState<Model[]>();
  const [loadFailed, setLoadFailed] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  // Portraits asked for while the page is open, so none is made twice.
  const painting = useRef(new Set<string>());

  // The list again, and the entries offered as avatars with it.
  const reload = useCallback(async () => {
    const listed = await api.list();
    setModels(listed);
    void refreshModels();
    return listed;
  }, []);
  const paint = useCallback(
    async (listed: Model[]) => {
      for (const model of listed) {
        if (model.portrait || painting.current.has(model.id)) continue;
        painting.current.add(model.id);
        try {
          await api.portrait(model.id, await makePortrait(model));
        } catch (e) {
          // A model that cannot be drawn has no portrait: its preview says so, and its cards show the orb.
          console.warn(`3D Avatar: no portrait of ${model.name}`, e);
          continue;
        }
        await reload();
      }
    },
    [reload],
  );
  const load = useCallback(() => {
    setLoadFailed(undefined);
    api.list().then(
      (listed) => {
        setModels(listed);
        void paint(listed);
      },
      (e) => setLoadFailed((e as Error).message),
    );
  }, [paint]);
  useEffect(load, [load]);

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
  const add = (picked: File) =>
    run(async () => {
      setUploading(true);
      try {
        const { model } = await api.upload(picked);
        setChosen(model.id);
        void paint(await reload());
      } finally {
        setUploading(false);
        if (file.current) file.current.value = "";
      }
    });
  const remove = (model: Model) =>
    run(async () => {
      const asked = t("Delete {name}? Agents that use it show the orb again.", { name: model.name });
      if (ui.asksBeforeDeleting() && !(await ui.confirm({ title: asked, confirmLabel: t("Delete"), danger: true, deletes: true }))) return;
      await api.remove(model.id);
      await reload();
    });
  const previewed = models.find((m) => m.id === chosen) ?? models[0];

  return (
    <div className="space-y-5">
      {failure && <ui.ErrorBanner onClose={() => setFailure(undefined)}>{failure}</ui.ErrorBanner>}
      <ui.Section
        title={t("Models")}
        hint={t("VRM files (.vrm). Choose one for an agent in its Avatar dialog: on the Agents page, open the agent and use the palette on its avatar.")}
        action={
          <>
            <button type="button" className={ui.classes.primarySmall} disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? t("Uploading…") : t("Add a model")}
            </button>
            <input
              ref={file}
              type="file"
              accept=".vrm"
              hidden
              data-testid="flair-avatar-file"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) void add(picked);
              }}
            />
          </>
        }
      >
        {models.length === 0 ? (
          <ui.Empty>{t("No models yet.")}</ui.Empty>
        ) : (
          <ul className="divide-y divide-line">
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                previewed={model.id === previewed?.id}
                onPreview={() => setChosen(model.id)}
                onRename={(name) =>
                  run(async () => {
                    await api.rename(model.id, name);
                    await reload();
                  })
                }
                onDelete={() => void remove(model)}
              />
            ))}
          </ul>
        )}
      </ui.Section>
      {previewed && (
        <ui.Section title={t("Preview")}>
          <Preview key={previewed.id} model={previewed} />
        </ui.Section>
      )}
    </div>
  );
}

/** A model in the list: its portrait, name, version and size, what its licence says, and what can be done with it. */
function ModelRow({ model, previewed, onPreview, onRename, onDelete }: {
  model: Model;
  previewed: boolean;
  onPreview: () => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { ui } = portal;
  const [name, setName] = useState<string>();
  const size = portal.format.number(model.size / (1024 * 1024), { maximumFractionDigits: 1 });
  // A name refused stays in the field, to be put right.
  const save = async () => {
    if (await onRename(name!)) setName(undefined);
  };
  return (
    <li className="flex gap-3 py-3" data-model={model.id}>
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#0b1220]">
        {model.portrait && <img src={portal.api.url(`/models/${model.id}/portrait?v=${encodeURIComponent(model.portrait)}`)} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          {name === undefined ? (
            <p className="truncate text-sm font-medium text-fg">{model.name}</p>
          ) : (
            <input
              autoFocus
              value={name}
              aria-label={t("Rename")}
              className={ui.classes.inputSmall}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  // The field's, not the dialog's around it.
                  e.stopPropagation();
                  setName(undefined);
                }
              }}
            />
          )}
          <p className="text-xs text-fg-subtle">{t("VRM {spec} · {size} MB", { spec: model.spec, size })}</p>
        </div>
        <Licence model={model} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={ui.classes.ghost} aria-pressed={previewed} onClick={onPreview}>
            {t("Preview")}
          </button>
          <button type="button" className={ui.classes.ghost} onClick={() => setName(model.name)}>
            {t("Rename")}
          </button>
          <button type="button" className={ui.classes.ghost} onClick={onDelete}>
            {t("Delete")}
          </button>
        </div>
      </div>
    </li>
  );
}

const link = (href: string) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="break-all text-accent hover:underline">
    {href}
  </a>
);

/**
 * What a model says of its licence, as its VRM version says it: who made it, under what licence, who may use it as an
 * avatar, whether for money, whether it must be credited and passed on, and anything else it points to. A VRM 0.x
 * model names a licence rather than linking one, says nothing of credit, and allows passing it on by its licence: any
 * named one but Redistribution_Prohibited and Other, which says nothing of it.
 */
function Licence({ model }: { model: Model }) {
  const allowed = (yes: boolean | undefined) => (yes === undefined ? undefined : yes ? t("Allowed") : t("Not allowed"));
  const who = { onlyAuthor: msg("Only the author"), onlySeparatelyLicensedPerson: msg("People the author has licensed"), everyone: msg("Everyone") };
  let rows: [string, ReactNode][];
  if (model.spec === "1.0") {
    const l = model.licence;
    const commercial = { personalNonProfit: msg("Personal, non-profit"), personalProfit: msg("Personal, for profit"), corporation: msg("Companies too") };
    rows = [
      [msg("Authors"), l.authors?.join(", ")],
      [msg("Licence"), l.licenseUrl && link(l.licenseUrl)],
      [msg("Use as an avatar"), l.avatarPermission && t(who[l.avatarPermission])],
      [msg("Commercial use"), l.commercialUsage && t(commercial[l.commercialUsage])],
      [msg("Credit"), l.creditNotation && (l.creditNotation === "required" ? t("Required") : t("Not required"))],
      [msg("Redistribution"), allowed(l.allowRedistribution)],
    ];
    if (l.otherLicenseUrl) rows.push([msg("Other conditions"), link(l.otherLicenseUrl)]);
  } else {
    const l = model.licence;
    const users = { OnlyAuthor: who.onlyAuthor, ExplicitlyLicensedPerson: who.onlySeparatelyLicensedPerson, Everyone: who.everyone };
    rows = [
      [msg("Authors"), l.author],
      [msg("Licence"), l.licenseName],
      [msg("Use as an avatar"), l.allowedUserName && t(users[l.allowedUserName])],
      [msg("Commercial use"), allowed(l.commercialUssageName && l.commercialUssageName === "Allow")],
      [msg("Credit"), undefined],
      [msg("Redistribution"), allowed(l.licenseName === undefined || l.licenseName === "Other" ? undefined : l.licenseName !== "Redistribution_Prohibited")],
    ];
    for (const other of [l.otherLicenseUrl, l.otherPermissionUrl]) if (other) rows.push([msg("Other conditions"), link(other)]);
  }
  return (
    <div className="text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([label, value], i) => (
          <div key={i} className="contents">
            <dt className="text-fg-subtle">{t(label)}</dt>
            <dd className={value ? "min-w-0 text-fg-muted" : "text-fg-faint"}>{value || t("Not stated")}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-fg-faint">{t("What the model says of its own licence. It is the author's, not this extension's.")}</p>
    </div>
  );
}

/**
 * The model drawn live, in a dark square as the Avatar dialog's preview is, in a state chosen with the buttons under
 * it and with the dialog's made-up voice: syllables rising and falling inside slower phrases. What is drawn while the
 * model is not says why: still loading, a model that cannot be drawn, or a browser without WebGL 2.
 */
function Preview({ model }: { model: Model }) {
  const [state, setState] = useState<AvatarMode>("output");
  const [shown, setShown] = useState<Shown>("loading");
  const levels = useRef<AvatarLevels>({ input: 0, output: 0 });
  useEffect(() => {
    let frame = 0;
    const tick = (ms: number) => {
      const syllable = Math.max(0, Math.sin(ms * 0.012));
      const phrase = 0.55 + 0.45 * Math.sin(ms * 0.0019);
      const value = Math.min(1, syllable * phrase * 0.85 + Math.random() * 0.08);
      levels.current = { input: state === "input" ? value : 0, output: state === "output" ? value : 0 };
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);
  const why =
    shown === "failed" ? t("This model could not be drawn. Voice mode shows the orb for it.")
    : shown === "unsupported" ? t("WebGL 2 is not available in this browser, so voice mode shows the orb.")
    : t("Loading the model…");
  return (
    <div className="w-[220px] max-w-full">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-[#0b1220]">
        <div className="relative aspect-square w-[58%]" data-testid="flair-avatar-preview">
          <Avatar
            model={model}
            mode={state}
            levels={levels}
            onShown={setShown}
            orb={<p className="absolute inset-0 grid place-items-center text-center text-xs text-[#acc9ee]">{why}</p>}
          />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label={t("Preview state")}>
        {STATES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={state === value}
            onClick={() => setState(value)}
            className={`truncate rounded-lg border px-1 py-1 text-[11px] transition ${state === value ? "border-accent/50 bg-accent/10 text-accent" : "border-line text-fg-muted hover:text-fg"}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
