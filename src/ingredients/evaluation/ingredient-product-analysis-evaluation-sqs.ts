import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import {
  INGREDIENT_PRODUCT_ANALYSIS_EVALUATION_SQS_WAIT_TIMEOUT_MS,
  INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
} from '../ingredient-analysis-runtime.constants';

export async function waitForEvaluationMessage(input: {
  client: SQSClient;
  queueUrl: string;
  jobId: string;
}): Promise<{ receiptHandle: string; body: string }> {
  const deadline =
    Date.now() + INGREDIENT_PRODUCT_ANALYSIS_EVALUATION_SQS_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await input.client.send(
      new ReceiveMessageCommand({
        QueueUrl: input.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 5,
        VisibilityTimeout:
          INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );

    for (const message of response.Messages ?? []) {
      const body = message.Body ?? '';
      const receiptHandle = message.ReceiptHandle;
      if (receiptHandle && messageJobId(body) === input.jobId) {
        return { receiptHandle, body };
      }
      await releaseUnrelatedMessage(input.client, input.queueUrl, message);
    }
  }
  throw new Error(
    'Timed out waiting for ingredient analysis evaluation SQS message.',
  );
}

export async function deleteEvaluationMessage(
  client: SQSClient,
  queueUrl: string,
  receiptHandle: string,
): Promise<void> {
  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  } catch {
    return;
  }
}

export function isPrivatePayload(body: string, jobId: string): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    return keys.length === 1 && keys[0] === 'job_id' && parsed.job_id === jobId;
  } catch {
    return false;
  }
}

async function releaseUnrelatedMessage(
  client: SQSClient,
  queueUrl: string,
  message: Message,
): Promise<void> {
  if (!message.ReceiptHandle) return;
  await client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle,
      VisibilityTimeout: 0,
    }),
  );
}

function messageJobId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { job_id?: unknown };
    return typeof parsed.job_id === 'string' ? parsed.job_id : null;
  } catch {
    return null;
  }
}
