import { Transform, type TransformFnParams } from 'class-transformer';

function isBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length === 0;
}

function originalValue(params: TransformFnParams): unknown {
  const key = String(params.key);
  if (
    params.obj &&
    typeof params.obj === 'object' &&
    Object.prototype.hasOwnProperty.call(params.obj, key)
  ) {
    return (params.obj as Record<string, unknown>)[key];
  }
  return params.value as unknown;
}

function transformedValue(params: TransformFnParams): unknown {
  return params.value as unknown;
}

export function EmptyStringToNull() {
  return Transform((params) =>
    isBlankString(originalValue(params)) ? null : transformedValue(params),
  );
}

export function EmptyStringToUndefined() {
  return Transform((params) =>
    isBlankString(originalValue(params)) ? undefined : transformedValue(params),
  );
}

export function EmptyStringToDefault<T>(defaultValue: T) {
  return Transform((params) =>
    isBlankString(originalValue(params))
      ? defaultValue
      : transformedValue(params),
  );
}
