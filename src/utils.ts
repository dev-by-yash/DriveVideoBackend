export function rootFolderId(folderId?: string | null) {
  return folderId && folderId !== 'root' ? folderId : null;
}

export function toIso(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

export function safeTrim(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
