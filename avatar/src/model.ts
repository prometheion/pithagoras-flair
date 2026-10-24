import type { ClipGesture } from "./gestures";
import type { ModelSettings } from "./model-settings";

/**
 * A model as the server half keeps it and the page is told of it, shared by both halves (types only). The server
 * writes one as a file beside the model's own (`models/<id>.json` in the extension's data folder), and `GET /models`
 * lists them.
 */
export type Model = {
  /** The sha256 of the file, in hex: the same file is the same model. */
  id: string;
  name: string;
  /** Its size in bytes. */
  size: number;
  /** When it was added, ISO. */
  added: string;
  /** When its portrait was made, ISO; none until the Settings page has made one. */
  portrait?: string;
  /**
   * What its portrait was drawn with (`portraitStamp` in stage.ts): the version of the drawing and the settings that
   * show at rest. The Settings page makes the portrait again when it differs from what it would draw now.
   */
  portraitStamp?: string;
  /** What is set on it on the Settings page (model-settings.ts): only the values that differ from the defaults. */
  settings?: Partial<ModelSettings>;
  /**
   * The gesture clips uploaded for it on the Settings page, each a VRM Animation played in place of the gesture's own
   * motion (gestures.ts): none for a gesture that has its own.
   */
  clips?: Partial<Record<ClipGesture, ClipFile>>;
} & ModelSpec;

/** A gesture clip as the model's record keeps it: the uploaded file's name, its size in bytes and its sha256 in hex. */
export type ClipFile = { name: string; size: number; sha256: string };

/** The VRM version a model is made in, and what it says of its own licence under the names that version gives them. */
export type ModelSpec = { spec: "1.0"; licence: Vrm1Licence } | { spec: "0.x"; licence: Vrm0Licence };

/** What a VRM 1.0 model says of its licence (`VRMC_vrm.meta`): only these fields, and only values of the spec's own sets. */
export interface Vrm1Licence {
  authors?: string[];
  licenseUrl?: string;
  avatarPermission?: "onlyAuthor" | "onlySeparatelyLicensedPerson" | "everyone";
  commercialUsage?: "personalNonProfit" | "personalProfit" | "corporation";
  creditNotation?: "required" | "unnecessary";
  allowRedistribution?: boolean;
  otherLicenseUrl?: string;
}

/** What a VRM 0.x model says of its licence (`VRM.meta`), kept as `Vrm1Licence` is. */
export interface Vrm0Licence {
  author?: string;
  licenseName?: "Redistribution_Prohibited" | "CC0" | "CC_BY" | "CC_BY_NC" | "CC_BY_SA" | "CC_BY_NC_SA" | "CC_BY_ND" | "CC_BY_NC_ND" | "Other";
  allowedUserName?: "OnlyAuthor" | "ExplicitlyLicensedPerson" | "Everyone";
  commercialUssageName?: "Disallow" | "Allow";
  otherLicenseUrl?: string;
  otherPermissionUrl?: string;
}
