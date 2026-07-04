import nodemailer from "nodemailer";
import logger from "../logger.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendExportReadyEmail(to: string, fileName: string): Promise<void> {
  const url = `${process.env.EXPORT_PUBLIC_URL}/${fileName}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your ham radio license export is ready",
    text: `Your export is ready for download:\n\n${url}`,
  });

  logger.info("Export ready email sent", { to, fileName });
}

export async function sendExportFailedEmail(to: string): Promise<void> {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your ham radio license export failed",
    text: "Sorry, an error occurred processing your export request. Please try again.",
  });

  logger.info("Export failed email sent", { to });
}
