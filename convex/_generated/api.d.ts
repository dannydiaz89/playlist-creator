/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_screening from "../lib/screening.js";
import type * as lib_surveyCode from "../lib/surveyCode.js";
import type * as settings from "../settings.js";
import type * as songs from "../songs.js";
import type * as submissions from "../submissions.js";
import type * as surveys from "../surveys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/screening": typeof lib_screening;
  "lib/surveyCode": typeof lib_surveyCode;
  settings: typeof settings;
  songs: typeof songs;
  submissions: typeof submissions;
  surveys: typeof surveys;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
