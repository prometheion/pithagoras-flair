import type { ReactNode } from "react";
import type { Model } from "./model";
import { msg, portal, t } from "./portal";

/**
 * What a model says of its licence, as its VRM version says it: three badges for what most people ask first (may it be
 * used for money, must its author be credited, may it be passed on), and the whole of it folded under them (who made
 * it, under what licence, who may use it as an avatar, and anything else it points to). The badges and the details
 * read the same fields.
 *
 * A VRM 0.x model names a licence rather than linking one, says nothing of credit, and allows passing it on by its
 * licence: any named one but Redistribution_Prohibited and Other, which says nothing of it.
 */

/** How a badge is drawn: what it allows, what it allows only in part, what it does not allow, and what it does not say. */
type Tone = "ok" | "warn" | "danger" | "none";
const TONES: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok ring-ok/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  none: "bg-fg/5 text-fg-faint ring-line",
};

/** The three badges' words and tones, each a text to be translated. */
function badges(model: Model): [string, Tone][] {
  if (model.spec === "1.0") {
    const { commercialUsage, creditNotation, allowRedistribution } = model.licence;
    return [
      commercialUsage === "corporation" ? [msg("Commercial use allowed"), "ok"]
      : commercialUsage === "personalProfit" ? [msg("Commercial use by individuals only"), "warn"]
      : commercialUsage === "personalNonProfit" ? [msg("No commercial use"), "danger"]
      : [msg("Commercial use not stated"), "none"],
      creditNotation === "required" ? [msg("Credit required"), "warn"]
      : creditNotation === "unnecessary" ? [msg("No credit needed"), "ok"]
      : [msg("Credit not stated"), "none"],
      allowRedistribution === true ? [msg("Redistribution allowed"), "ok"]
      : allowRedistribution === false ? [msg("No redistribution"), "danger"]
      : [msg("Redistribution not stated"), "none"],
    ];
  }
  const { commercialUssageName, licenseName } = model.licence;
  return [
    commercialUssageName === "Allow" ? [msg("Commercial use allowed"), "ok"]
    : commercialUssageName === "Disallow" ? [msg("No commercial use"), "danger"]
    : [msg("Commercial use not stated"), "none"],
    [msg("Credit not stated"), "none"],
    licenseName === undefined || licenseName === "Other" ? [msg("Redistribution not stated"), "none"]
    : licenseName === "Redistribution_Prohibited" ? [msg("No redistribution"), "danger"]
    : [msg("Redistribution allowed"), "ok"],
  ];
}

const link = (href: string) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="break-all text-accent hover:underline">
    {href}
  </a>
);

/** The licence in one line, for the folded details: a VRM 1.0 model's address without its scheme, a VRM 0.x model's name. */
function named(model: Model): string {
  if (model.spec === "0.x") return model.licence.licenseName ?? t("Not stated");
  const { licenseUrl } = model.licence;
  if (!licenseUrl) return t("Not stated");
  const { host, pathname } = new URL(licenseUrl);
  return `${host}${pathname === "/" ? "" : pathname}`;
}

/** Every field of the licence, as a table: "Not stated" for what the model does not say. */
function Details({ model }: { model: Model }) {
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

/** The badges, each saying its meaning in words, so the colour is never the only sign, and the details folded under them. */
export function Licence({ model }: { model: Model }) {
  const { ui } = portal;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5" aria-label={t("Licence")}>
        {badges(model).map(([text, tone]) => (
          <li key={text} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${TONES[tone]}`}>
            {t(text)}
          </li>
        ))}
      </ul>
      <ui.DetailsGroup title={t("Licence details")} summary={named(model)}>
        <Details model={model} />
      </ui.DetailsGroup>
    </div>
  );
}
