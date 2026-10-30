/**
 * True when `path` falls under one of the path prefixes of a scoped refresh (no scope = everything). A hook that is switched off has
 * no path (null): it is never "in" a scope, and with no scope it is left to do nothing, as before.
 */
export const inScope = (path, scope) => !scope || (typeof path === "string" && scope.some((s) => path === s || path.startsWith(`${s}/`) || path.startsWith(`${s}?`)));
