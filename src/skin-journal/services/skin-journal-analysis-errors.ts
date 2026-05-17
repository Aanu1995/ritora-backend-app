import {
  AnalysisFailureCode,
  AnalysisFailureCodeValue,
} from '../skin-journal.constants';

export class SkinJournalAnalysisError extends Error {
  constructor(
    readonly code: AnalysisFailureCode,
    message: string,
    readonly retryable: boolean,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = 'SkinJournalAnalysisError';
  }
}

export interface ClassifiedAnalysisFailure {
  code: AnalysisFailureCode;
  message: string;
  retryable: boolean;
}

export function classifyAnalysisFailure(
  error: unknown,
): ClassifiedAnalysisFailure {
  if (error instanceof SkinJournalAnalysisError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (isAnalysisFailureLike(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      code: AnalysisFailureCodeValue.Unknown,
      message: error.message,
      retryable: true,
    };
  }

  return {
    code: AnalysisFailureCodeValue.Unknown,
    message: 'Analysis failed',
    retryable: true,
  };
}

export function isProviderTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function isAnalysisFailureLike(error: unknown): error is {
  code: AnalysisFailureCode;
  message: string;
  retryable: boolean;
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'retryable' in error &&
    isAnalysisFailureCode((error as { code: unknown }).code) &&
    typeof (error as { message: unknown }).message === 'string' &&
    typeof (error as { retryable: unknown }).retryable === 'boolean'
  );
}

function isAnalysisFailureCode(value: unknown): value is AnalysisFailureCode {
  return (
    typeof value === 'string' &&
    (Object.values(AnalysisFailureCodeValue) as string[]).includes(value)
  );
}
