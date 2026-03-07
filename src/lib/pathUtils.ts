export function normalizeImportedPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^"+|"+$/g, "");
  if (!/^file:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") return trimmed;
    const decodedPath = decodeURIComponent(url.pathname);
    const windowsPath = /^\/[A-Za-z]:/.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
    return windowsPath.replace(/\//g, "\\");
  } catch {
    return trimmed;
  }
}

export function normalizePathForCompare(input: string | null | undefined): string {
  if (!input) return "";
  return input.trim().replace(/\\/g, "/").toLowerCase();
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
