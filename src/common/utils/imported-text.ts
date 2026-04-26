import { decode } from 'he';

type HtmlToTextOptions = {
  preserveLineBreaks?: boolean;
};

function normalizeLineBreakPlaceholders(value: string): string {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|section|article|h[1-6])\s*>/gi, '\n');
}

export function decodeHtmlEntities(value: string): string {
  return decode(value).replace(/\u00a0/g, ' ');
}

export function htmlFragmentToText(
  value: string,
  options: HtmlToTextOptions = {},
): string {
  const withDecodedEntities = decodeHtmlEntities(value);
  const withNormalizedBreaks =
    normalizeLineBreakPlaceholders(withDecodedEntities);
  const withoutTags = withNormalizedBreaks.replace(/<[^>]+>/g, ' ');

  if (options.preserveLineBreaks) {
    return withoutTags
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n+ */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return withoutTags.replace(/\s+/g, ' ').trim();
}

export function normalizeImportedText(value: string): string {
  return htmlFragmentToText(value);
}

export function normalizeImportedTextToNull(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeImportedText(value);
  return normalized.length > 0 ? normalized : null;
}

export function normalizeImportedTextList(
  values: Array<string | null | undefined> | null | undefined,
): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeImportedTextToNull(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
