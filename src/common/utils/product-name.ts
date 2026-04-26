function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function stripProductPageFileArtifacts(value: string): string {
  return safeDecodeURIComponent(value)
    .replace(/[?#].*$/g, '')
    .replace(/\.(?:html?|php|aspx?)$/i, '')
    .replace(/(?:[-_\s]+)\d{5,}$/g, '')
    .trim();
}

export function sanitizeProductNameCandidate(value: string): string {
  return stripProductPageFileArtifacts(value)
    .replace(/\s+/g, ' ')
    .replace(/[|:>-]+$/g, '')
    .trim();
}

export function humanizeProductUrlSegment(value: string): string {
  return stripProductPageFileArtifacts(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
