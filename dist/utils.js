export function rootFolderId(folderId) {
    return folderId && folderId !== 'root' ? folderId : null;
}
export function toIso(date) {
    return date ? date.toISOString() : null;
}
export function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : '';
}
