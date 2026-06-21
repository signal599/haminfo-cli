import logger from './logger.js';

interface RevalidateSuccess {
  revalidated: true;
  now: number;
}

interface RevalidateError {
  message: string;
}

export async function revalidateCache(): Promise<void> {
  const url = process.env.REVALIDATE_URL!;
  let response: Response;

  try {
    response = await fetch(url, { method: 'POST' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('Revalidate request failed', { url, reason });
    return;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    logger.error('Revalidate response was not valid JSON', {
      url,
      status: response.status,
    });
    return;
  }

  if (response.ok && isRevalidateSuccess(data)) {
    logger.info('Revalidate succeeded', {
      url,
      status: response.status,
      now: data.now,
      timestamp: new Date(data.now).toISOString(),
    });
    return;
  }

  const message = isRevalidateError(data) ? data.message : JSON.stringify(data);
  logger.error('Revalidate failed', {
    url,
    status: response.status,
    message,
  });
}

function isRevalidateSuccess(data: unknown): data is RevalidateSuccess {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).revalidated === true &&
    typeof (data as Record<string, unknown>).now === 'number'
  );
}

function isRevalidateError(data: unknown): data is RevalidateError {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).message === 'string'
  );
}
