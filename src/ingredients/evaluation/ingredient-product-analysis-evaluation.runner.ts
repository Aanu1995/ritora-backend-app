import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { DEFAULT_LANGUAGE } from '../../common/i18n/i18n';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  IngredientProductAnalysisJob,
  IngredientProductAnalysisJobStatus,
} from '../entities/ingredient-product-analysis-job.entity';
import {
  INGREDIENT_ANALYSIS_AI_MAX_OUTPUT_TOKENS,
  INGREDIENT_ANALYSIS_AI_REQUEST_TIMEOUT_MS,
  INGREDIENT_ANALYSIS_AI_STRUCTURED_OUTPUT_ATTEMPTS,
  INGREDIENT_PRODUCT_ANALYSIS_EVALUATION_SQS_WAIT_TIMEOUT_MS,
  INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES,
  INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
  INGREDIENT_TRANSLATION_AI_MAX_BATCH_OUTPUT_TOKENS,
  INGREDIENT_TRANSLATION_AI_REQUEST_TIMEOUT_MS,
} from '../ingredient-analysis-runtime.constants';
import {
  IngredientProductAnalysisSnapshot,
  IngredientProductAnalysisSnapshotStatus,
} from '../entities/ingredient-product-analysis-snapshot.entity';
import { IngredientProductAnalysisQueueService } from '../ingredient-product-analysis-queue.service';
import { IngredientProductAnalysisSnapshotService } from '../ingredient-product-analysis-snapshot.service';
import { IngredientProductAnalysisWorkerService } from '../ingredient-product-analysis-worker.service';
import type { AnalysisResult } from '../ingredients.types';
import {
  ingredientAnalysisAssertions,
  normalizeEvaluationIngredientName,
} from './product-check-evaluation-assertions';
import {
  createEvaluationRuntime,
  type ProductCheckEvaluationRuntime,
} from './product-check-evaluation-runtime';
import type {
  EvaluationCaseStatus,
  EvaluationCheck,
} from './product-check-evaluation.types';
import {
  INGREDIENT_ANALYSIS_REAL_LIFE_CASES,
  type IngredientAnalysisRealLifeCase,
} from './product-check-real-life-cases';
import {
  EvaluationInventoryRepository,
  EvaluationJobRepository,
  EvaluationSnapshotRepository,
  evaluationInventoryProduct,
} from './ingredient-product-analysis-evaluation-repositories';
import {
  deleteEvaluationMessage,
  isPrivatePayload,
  waitForEvaluationMessage,
} from './ingredient-product-analysis-evaluation-sqs';
import {
  buildIngredientProductAnalysisEvaluationGate,
  isHttpsUrl,
  isSafeIngredientAnalysisEvaluationQueueUrl,
  queueName,
  readIngredientAnalysisEvaluationModel,
  sanitizeForReport,
  type IngredientProductAnalysisEvaluationGate,
} from './ingredient-product-analysis-evaluation-reporting';

export {
  buildIngredientProductAnalysisEvaluationGate,
  isSafeIngredientAnalysisEvaluationQueueUrl,
} from './ingredient-product-analysis-evaluation-reporting';

const SNAPSHOT_EXPECTED_ACTIVE_NAMES = [
  'Glycerin',
  'Ceramides',
  'Hyaluronic acid',
] as const;

export type IngredientProductAnalysisEvaluationCaseResult = {
  kind: 'ingredient_analysis_live_ai' | 'sqs_worker_snapshot';
  id: string;
  title: string;
  status: EvaluationCaseStatus;
  checks: EvaluationCheck[];
  output?: AnalysisResult;
};

export type IngredientProductAnalysisEvaluationReport = {
  reportType: 'ingredient_product_analysis_launch_evaluation';
  generatedAt: string;
  model: string;
  queue: {
    driver: string | null;
    queueName: string | null;
    region: string | null;
    safeQueueName: boolean;
  };
  runtime: {
    aiRequestTimeoutMs: number;
    aiMaxOutputTokens: number;
    structuredOutputAttempts: number;
    translationRequestTimeoutMs: number;
    translationMaxBatchOutputTokens: number;
    sqsEvaluationWaitTimeoutMs: number;
    sqsVisibilityTimeoutSeconds: number;
    jobLockTimeoutMinutes: number;
  };
  databaseSafety: {
    usedRealTypeOrmConnection: false;
    mutatedApplicationDatabase: false;
    cleanup: 'not_required_in_memory_repositories_only';
  };
  totalCases: number;
  passedCases: number;
  failedCases: number;
  cases: IngredientProductAnalysisEvaluationCaseResult[];
  gate: IngredientProductAnalysisEvaluationGate;
};

export async function evaluateIngredientProductAnalysisLaunch(
  input: {
    configService?: ConfigService;
    cases?: readonly IngredientAnalysisRealLifeCase[];
    generatedAt?: Date;
    allowSharedSqs?: boolean;
  } = {},
): Promise<IngredientProductAnalysisEvaluationReport> {
  const configService = input.configService ?? new ConfigService();
  const runtime = createEvaluationRuntime(configService);
  const cases: IngredientProductAnalysisEvaluationCaseResult[] = [];

  for (const evaluationCase of input.cases ??
    INGREDIENT_ANALYSIS_REAL_LIFE_CASES) {
    cases.push(await evaluateLiveAiCase(runtime, evaluationCase));
  }

  cases.push(
    await evaluateSqsWorkerSnapshotCase({
      configService,
      runtime,
      allowSharedSqs: input.allowSharedSqs ?? false,
    }),
  );

  const passedCases = cases.filter(
    (result) => result.status === 'passed',
  ).length;
  const failedCases = cases.length - passedCases;
  const sqsCase = cases.find((result) => result.kind === 'sqs_worker_snapshot');
  const sqsExercised = Boolean(
    sqsCase &&
    [
      'sqs_dispatch_count',
      'sqs_message_received',
      'job_completed',
      'sqs_message_deleted',
    ].every((id) => checkPassed(sqsCase.checks, id)),
  );
  const cleanupCompleted = cases
    .filter((result) => result.kind === 'sqs_worker_snapshot')
    .every((result) => checkPassed(result.checks, 'sqs_message_deleted'));

  return sanitizeForReport({
    reportType: 'ingredient_product_analysis_launch_evaluation',
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    model: readIngredientAnalysisEvaluationModel(configService),
    queue: {
      driver:
        configService.get<string>('INGREDIENT_ANALYSIS_QUEUE_DRIVER')?.trim() ||
        null,
      queueName: queueName(
        configService.get<string>('INGREDIENT_ANALYSIS_SQS_QUEUE_URL') ?? '',
      ),
      region: configService.get<string>('AWS_REGION')?.trim() || null,
      safeQueueName: isSafeIngredientAnalysisEvaluationQueueUrl(
        configService.get<string>('INGREDIENT_ANALYSIS_SQS_QUEUE_URL') ?? '',
      ),
    },
    runtime: {
      aiRequestTimeoutMs: INGREDIENT_ANALYSIS_AI_REQUEST_TIMEOUT_MS,
      aiMaxOutputTokens: INGREDIENT_ANALYSIS_AI_MAX_OUTPUT_TOKENS,
      structuredOutputAttempts:
        INGREDIENT_ANALYSIS_AI_STRUCTURED_OUTPUT_ATTEMPTS,
      translationRequestTimeoutMs: INGREDIENT_TRANSLATION_AI_REQUEST_TIMEOUT_MS,
      translationMaxBatchOutputTokens:
        INGREDIENT_TRANSLATION_AI_MAX_BATCH_OUTPUT_TOKENS,
      sqsEvaluationWaitTimeoutMs:
        INGREDIENT_PRODUCT_ANALYSIS_EVALUATION_SQS_WAIT_TIMEOUT_MS,
      sqsVisibilityTimeoutSeconds:
        INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      jobLockTimeoutMinutes: INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES,
    },
    databaseSafety: {
      usedRealTypeOrmConnection: false,
      mutatedApplicationDatabase: false,
      cleanup: 'not_required_in_memory_repositories_only',
    },
    totalCases: cases.length,
    passedCases,
    failedCases,
    cases,
    gate: buildIngredientProductAnalysisEvaluationGate({
      failedCases,
      sqsExercised,
      cleanupCompleted,
    }),
  });
}

async function evaluateLiveAiCase(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: IngredientAnalysisRealLifeCase,
): Promise<IngredientProductAnalysisEvaluationCaseResult> {
  const output = await runtime.analysisService.analyze({
    products: evaluationCase.products,
    skinProfile: null,
    language: DEFAULT_LANGUAGE,
    withExplanations: true,
    focusProductId: evaluationCase.focusProductId,
  });
  const checks = ingredientAnalysisAssertions(evaluationCase, output);

  return {
    kind: 'ingredient_analysis_live_ai',
    id: evaluationCase.id,
    title: evaluationCase.title,
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    checks,
    output,
  };
}

async function evaluateSqsWorkerSnapshotCase(input: {
  configService: ConfigService;
  runtime: ProductCheckEvaluationRuntime;
  allowSharedSqs: boolean;
}): Promise<IngredientProductAnalysisEvaluationCaseResult> {
  const checks: EvaluationCheck[] = [];
  const queueUrl =
    input.configService
      .get<string>('INGREDIENT_ANALYSIS_SQS_QUEUE_URL')
      ?.trim() ?? '';
  const region = input.configService.get<string>('AWS_REGION')?.trim() ?? '';
  const driver =
    input.configService
      .get<string>('INGREDIENT_ANALYSIS_QUEUE_DRIVER')
      ?.trim() ?? '';
  const safeQueue = isSafeIngredientAnalysisEvaluationQueueUrl(queueUrl);

  checks.push(
    check('queue_driver_sqs', 'sqs', driver, (value) => value === 'sqs'),
  );
  checks.push(check('sqs_queue_url', 'https SQS URL', queueUrl, isHttpsUrl));
  checks.push(check('aws_region', 'configured', region, Boolean));
  checks.push(
    check(
      'safe_evaluation_queue_name',
      true,
      safeQueue || input.allowSharedSqs,
      Boolean,
    ),
  );

  if (!checks.every((item) => item.passed)) {
    return sqsCaseResult(checks);
  }

  const runId = ulid().toLowerCase();
  const userId = `eval-user-${runId}`;
  const productId = `eval-product-${runId}`;
  const product = evaluationInventoryProduct(userId, productId);
  const inventoryRepository = new EvaluationInventoryRepository([product]);
  const jobRepository = new EvaluationJobRepository();
  const snapshotRepository = new EvaluationSnapshotRepository();
  const sqsClient = new SQSClient({ region });
  let evaluationQueueUrl = queueUrl;
  let temporaryQueueUrl: string | null = null;

  if (!input.allowSharedSqs) {
    try {
      temporaryQueueUrl = await createTemporaryEvaluationQueue({
        client: sqsClient,
        runId,
      });
      evaluationQueueUrl = temporaryQueueUrl;
      checks.push(
        check(
          'dedicated_evaluation_queue_created',
          true,
          Boolean(temporaryQueueUrl),
          Boolean,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          'dedicated_evaluation_queue_created',
          true,
          error instanceof Error ? error.message : String(error),
          () => false,
        ),
      );
      sqsClient.destroy();
      return sqsCaseResult(checks);
    }
  }

  const evaluationConfigService = queueConfigService(
    input.configService,
    evaluationQueueUrl,
  );
  const queue = new IngredientProductAnalysisQueueService(
    jobRepository as unknown as Repository<IngredientProductAnalysisJob>,
    inventoryRepository as unknown as Repository<InventoryProduct>,
    evaluationConfigService,
  );
  const snapshotService = new IngredientProductAnalysisSnapshotService(
    snapshotRepository as unknown as Repository<IngredientProductAnalysisSnapshot>,
    inventoryRepository as unknown as Repository<InventoryProduct>,
    input.runtime.analysisService,
  );
  let receiptHandle: string | null = null;
  let deleted = false;

  try {
    const job = await queue.enqueueForProduct(userId, productId);
    checks.push(check('job_enqueued', true, Boolean(job), Boolean));
    if (!job) return sqsCaseResult(checks);

    const dispatched = await queue.dispatchDueJobs(1);
    checks.push(
      check('sqs_dispatch_count', 1, dispatched, (value) => value === 1),
    );

    const received = await waitForEvaluationMessage({
      client: sqsClient,
      queueUrl: evaluationQueueUrl,
      jobId: job.id,
    });
    receiptHandle = received.receiptHandle;
    checks.push(
      check('sqs_message_received', true, Boolean(received), Boolean),
    );
    checks.push(
      check(
        'sqs_payload_private',
        true,
        isPrivatePayload(received.body, job.id),
        Boolean,
      ),
    );

    const scopedQueue = Object.create(
      queue,
    ) as IngredientProductAnalysisQueueService;
    const messages = [{ jobId: job.id, receiptHandle }];
    scopedQueue.receiveMessages = () => Promise.resolve(messages.splice(0, 1));
    scopedQueue.deleteMessage = async (handle: string) => {
      await queue.deleteMessage(handle);
      deleted = true;
    };

    const worker = new IngredientProductAnalysisWorkerService(
      {
        get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
      } as ConfigService,
      scopedQueue,
      snapshotService,
    );
    await worker.pollOnce();
    worker.onModuleDestroy();

    const storedJob = jobRepository.get(job.id);
    const snapshot = snapshotRepository.get(
      userId,
      productId,
      DEFAULT_LANGUAGE,
      false,
    );
    checks.push(
      check(
        'job_completed',
        IngredientProductAnalysisJobStatus.Completed,
        storedJob?.status ?? null,
        (value) => value === IngredientProductAnalysisJobStatus.Completed,
      ),
    );
    checks.push(
      check(
        'snapshot_ready',
        IngredientProductAnalysisSnapshotStatus.Ready,
        snapshot?.status ?? null,
        (value) => value === IngredientProductAnalysisSnapshotStatus.Ready,
      ),
    );
    checks.push(
      check(
        'snapshot_actives',
        ['Glycerin', 'Ceramides', 'Hyaluronic acid'],
        snapshot?.result?.actives.map((active) => active.displayName) ?? [],
        (values) => activeNamesInclude(values, SNAPSHOT_EXPECTED_ACTIVE_NAMES),
      ),
    );
    checks.push(check('sqs_message_deleted', true, deleted, Boolean));
  } catch (error) {
    checks.push(
      check(
        'sqs_worker_exception',
        'no exception',
        error instanceof Error ? error.message : String(error),
        () => false,
      ),
    );
  } finally {
    if (receiptHandle && !deleted) {
      await deleteEvaluationMessage(
        sqsClient,
        evaluationQueueUrl,
        receiptHandle,
      );
    }
    if (temporaryQueueUrl) {
      await deleteTemporaryEvaluationQueue(
        sqsClient,
        temporaryQueueUrl,
        checks,
      );
    }
    queue.onModuleDestroy();
    sqsClient.destroy();
  }

  return sqsCaseResult(checks);
}

async function createTemporaryEvaluationQueue(input: {
  client: SQSClient;
  runId: string;
}): Promise<string> {
  const response = await input.client.send(
    new CreateQueueCommand({
      QueueName: `ritora-eval-ingredient-analysis-${input.runId}`,
      Attributes: {
        MessageRetentionPeriod: '300',
        ReceiveMessageWaitTimeSeconds: '5',
        VisibilityTimeout:
          INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS.toString(),
      },
    }),
  );
  if (!response.QueueUrl) {
    throw new Error('SQS did not return a URL for the evaluation queue.');
  }
  return response.QueueUrl;
}

async function deleteTemporaryEvaluationQueue(
  client: SQSClient,
  queueUrl: string,
  checks: EvaluationCheck[],
): Promise<void> {
  try {
    await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    checks.push(check('temporary_queue_deleted', true, true, Boolean));
  } catch (error) {
    checks.push(
      check(
        'temporary_queue_deleted',
        true,
        error instanceof Error ? error.message : String(error),
        () => false,
      ),
    );
  }
}

function queueConfigService(
  configService: ConfigService,
  queueUrl: string,
): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'INGREDIENT_ANALYSIS_QUEUE_DRIVER') return 'sqs';
      if (key === 'INGREDIENT_ANALYSIS_SQS_QUEUE_URL') return queueUrl;
      return configService.get(key);
    },
    getOrThrow: (key: string) => {
      if (key === 'INGREDIENT_ANALYSIS_QUEUE_DRIVER') return 'sqs';
      if (key === 'INGREDIENT_ANALYSIS_SQS_QUEUE_URL') return queueUrl;
      return configService.getOrThrow(key);
    },
  } as ConfigService;
}

function sqsCaseResult(
  checks: EvaluationCheck[],
): IngredientProductAnalysisEvaluationCaseResult {
  return {
    kind: 'sqs_worker_snapshot',
    id: 'sqs_worker_snapshot_pipeline',
    title:
      'Shelf save queues ingredient analysis through real SQS and stores a snapshot',
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    checks,
  };
}

function check<T>(
  id: string,
  expected: unknown,
  actual: T,
  predicate: (actual: T) => boolean,
): EvaluationCheck {
  return { id, expected, actual, passed: predicate(actual) };
}

function checkPassed(checks: readonly EvaluationCheck[], id: string): boolean {
  return checks.some((check) => check.id === id && check.passed);
}

function activeNamesInclude(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const normalizedActual = actual.map(normalizeEvaluationIngredientName);
  return expected
    .map(normalizeEvaluationIngredientName)
    .every((name) => normalizedActual.includes(name));
}
