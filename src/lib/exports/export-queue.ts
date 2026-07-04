import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { exportQueue } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import logger from "../logger.js";
import {
  EXPORT_STALE_TIMEOUT_MINUTES,
  EXPORT_STATUS_COMPLETE,
  EXPORT_STATUS_FAILED,
  EXPORT_STATUS_PENDING,
  EXPORT_STATUS_RUNNING,
} from "../constants.js";
import { exportJob } from "../types.js";
import { writeExportCsv } from "./export-csv.js";
import { sendExportFailedEmail, sendExportReadyEmail } from "./export-mail.js";

export async function processExportQueue(): Promise<void> {
  try {
    await failStaleJobs();

    if (await isJobRunning()) {
      logger.info("Export already running, skipping");
      return;
    }

    const job = await claimNextJob();

    if (!job) {
      return;
    }

    await runExport(job);
  } finally {
    await closeDb();
  }
}

async function failStaleJobs(): Promise<void> {
  const db = await getDb();

  const staleJobs = await db.select({ id: exportQueue.id, email: exportQueue.email })
    .from(exportQueue)
    .where(and(
      eq(exportQueue.status, EXPORT_STATUS_RUNNING),
      sql`${exportQueue.startedAt} < NOW() - INTERVAL ${EXPORT_STALE_TIMEOUT_MINUTES} MINUTE`
    ));

  for (const job of staleJobs) {
    await db.update(exportQueue)
      .set({ status: EXPORT_STATUS_FAILED, processedAt: new Date() })
      .where(eq(exportQueue.id, job.id));

    logger.warn(`Export job ${job.id} timed out`, { id: job.id });
    await sendFailedEmailSafely(job.email);
  }
}

async function isJobRunning(): Promise<boolean> {
  const db = await getDb();

  const rows = await db.select({ id: exportQueue.id })
    .from(exportQueue)
    .where(eq(exportQueue.status, EXPORT_STATUS_RUNNING))
    .limit(1);

  return rows.length > 0;
}

async function claimNextJob(): Promise<exportJob | null> {
  const db = await getDb();

  const pending = await db.select()
    .from(exportQueue)
    .where(eq(exportQueue.status, EXPORT_STATUS_PENDING))
    .orderBy(exportQueue.createdAt)
    .limit(1);

  if (!pending.length) {
    return null;
  }

  const row = pending[0];

  const result = await db.update(exportQueue)
    .set({ status: EXPORT_STATUS_RUNNING, startedAt: new Date() })
    .where(and(eq(exportQueue.id, row.id), eq(exportQueue.status, EXPORT_STATUS_PENDING)));

  if (result[0].affectedRows !== 1) {
    // Claimed by another process between the select and the update above.
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    state: row.state,
    zip: row.zip,
    delimiter: row.delimiter,
    enclosure: row.enclosure,
  };
}

async function runExport(job: exportJob): Promise<void> {
  const db = await getDb();
  const fileName = `${randomUUID()}.csv`;
  const filePath = `${process.env.EXPORT_DIR}/${fileName}`;

  try {
    await mkdir(process.env.EXPORT_DIR!, { recursive: true });
    await writeExportCsv(job, filePath);

    await db.update(exportQueue)
      .set({ status: EXPORT_STATUS_COMPLETE, fileName, processedAt: new Date() })
      .where(eq(exportQueue.id, job.id));

    logger.info(`Export job ${job.id} complete`, { id: job.id, fileName });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(`Export job ${job.id} failed`, { id: job.id, reason });

    await db.update(exportQueue)
      .set({ status: EXPORT_STATUS_FAILED, processedAt: new Date() })
      .where(eq(exportQueue.id, job.id));

    await sendFailedEmailSafely(job.email);
    return;
  }

  await sendReadyEmailSafely(job.email, fileName);
}

async function sendReadyEmailSafely(email: string, fileName: string): Promise<void> {
  try {
    await sendExportReadyEmail(email, fileName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Failed to send export ready email", { email, reason });
  }
}

async function sendFailedEmailSafely(email: string): Promise<void> {
  try {
    await sendExportFailedEmail(email);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Failed to send export failure email", { email, reason });
  }
}
