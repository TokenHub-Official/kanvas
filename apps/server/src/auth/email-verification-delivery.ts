import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import nodemailer from "nodemailer";

import type { EmailVerificationDeliveryConfig } from "../config.js";

export interface VerificationEmail {
  readonly recipient: string;
  readonly displayName: string;
  readonly verificationUrl: string;
}

export interface EmailVerificationDelivery {
  send(message: VerificationEmail): Promise<void>;
}

export const emailVerificationTokenLifetimeSeconds = 3_600;
const smtpConnectionTimeoutMs = 10_000;
const smtpGreetingTimeoutMs = 10_000;
const smtpSocketTimeoutMs = 30_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function requireLocalVerificationUrl(value: string, baseUrl: string): string {
  const url = new URL(value);
  if (url.origin !== new URL(baseUrl).origin) {
    throw new Error("Email verification URL must use the Kanvas origin.");
  }
  return url.toString();
}

function messageText(displayName: string, verificationUrl: string): string {
  return [
    `${displayName}，你好：`,
    "",
    "请验证这个邮箱地址，以完成 Kanvas 账号创建：",
    verificationUrl,
    "链接将在 1 小时后失效。",
    "",
    "如果不是你发起的操作，可以忽略这封邮件。",
    "",
    `Hello ${displayName},`,
    "Verify this email address to finish creating your Kanvas account:",
    verificationUrl,
    "This link expires in one hour.",
    "",
    "If you did not request this account, you can ignore this email.",
  ].join("\n");
}

function messageHtml(displayName: string, verificationUrl: string): string {
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(verificationUrl);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    '<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#17171d;line-height:1.5">',
    `<p>${safeName}，你好：</p>`,
    "<p>请验证这个邮箱地址，以完成 Kanvas 账号创建。</p>",
    `<p><a href="${safeUrl}">验证邮箱并继续</a></p>`,
    "<p>链接将在 1 小时后失效。</p>",
    "<p>如果不是你发起的操作，可以忽略这封邮件。</p>",
    '<hr style="border:0;border-top:1px solid #e6e6e6;margin:24px 0">',
    `<p>Hello ${safeName},</p>`,
    "<p>Verify this email address to finish creating your Kanvas account.</p>",
    `<p><a href="${safeUrl}">Verify email and continue</a></p>`,
    "<p>This link expires in one hour.</p>",
    "<p>If you did not request this account, you can ignore this email.</p>",
    "</body>",
    "</html>",
  ].join("");
}

export function createEmailVerificationDelivery(
  config: EmailVerificationDeliveryConfig,
  baseUrl: string,
): EmailVerificationDelivery {
  if (config.kind === "development_outbox") {
    return Object.freeze({
      async send(message: VerificationEmail): Promise<void> {
        const verificationUrl = requireLocalVerificationUrl(
          message.verificationUrl,
          baseUrl,
        );
        await mkdir(dirname(config.file), { recursive: true, mode: 0o700 });
        await appendFile(
          config.file,
          `${JSON.stringify({
            sentAt: new Date().toISOString(),
            recipient: message.recipient,
            displayName: message.displayName,
            verificationUrl,
          })}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        await chmod(config.file, 0o600);
      },
    });
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    connectionTimeout: smtpConnectionTimeoutMs,
    greetingTimeout: smtpGreetingTimeoutMs,
    socketTimeout: smtpSocketTimeoutMs,
    ...(config.authentication
      ? {
          auth: {
            user: config.authentication.user,
            pass: config.authentication.password,
          },
        }
      : {}),
  });

  return Object.freeze({
    async send(message: VerificationEmail): Promise<void> {
      const verificationUrl = requireLocalVerificationUrl(
        message.verificationUrl,
        baseUrl,
      );
      await transporter.sendMail({
        disableFileAccess: true,
        disableUrlAccess: true,
        from: {
          name: config.fromName,
          address: config.fromAddress,
        },
        to: message.recipient,
        subject: "验证你的 Kanvas 邮箱 / Verify your Kanvas email",
        text: messageText(message.displayName, verificationUrl),
        html: messageHtml(message.displayName, verificationUrl),
      });
    },
  });
}
