import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn<(message: unknown) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: smtp.createTransport,
  },
}));

import { createEmailVerificationDelivery } from "../src/auth/email-verification-delivery.js";

const directories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("email verification delivery", () => {
  it("uses a reusable standard SMTP transport without weakening TLS", async () => {
    smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail });
    const delivery = createEmailVerificationDelivery(
      {
        kind: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        requireTls: true,
        fromAddress: "kanvas@example.com",
        fromName: "Kanvas",
        authentication: {
          user: "kanvas",
          password: "test-only-secret",
        },
      },
      "https://kanvas.example.com",
    );

    await delivery.send({
      recipient: "member@example.com",
      displayName: "<Member>",
      verificationUrl:
        "https://kanvas.example.com/api/auth/verify-email?token=opaque",
    });

    expect(smtp.createTransport).toHaveBeenCalledTimes(1);
    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: { user: "kanvas", pass: "test-only-secret" },
    });
    const message = smtp.sendMail.mock.calls[0]?.[0] as
      | {
          readonly disableFileAccess?: boolean;
          readonly disableUrlAccess?: boolean;
          readonly from?: unknown;
          readonly html?: string;
          readonly subject?: string;
          readonly to?: string;
        }
      | undefined;
    expect(message).toMatchObject({
      disableFileAccess: true,
      disableUrlAccess: true,
      from: { name: "Kanvas", address: "kanvas@example.com" },
      to: "member@example.com",
      subject: "验证你的 Kanvas 邮箱 / Verify your Kanvas email",
    });
    expect(message?.html).toContain("&lt;Member&gt;");
  });

  it("writes a private development outbox record without logging the token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kanvas-email-outbox-"));
    directories.push(directory);
    const file = join(directory, "nested", "outbox.jsonl");
    const delivery = createEmailVerificationDelivery(
      {
        kind: "development_outbox",
        file,
        fromAddress: "kanvas@localhost.invalid",
        fromName: "Kanvas",
      },
      "http://127.0.0.1:3000",
    );

    await delivery.send({
      recipient: "member@example.com",
      displayName: "Member",
      verificationUrl:
        "http://127.0.0.1:3000/api/auth/verify-email?token=opaque&callbackURL=%2F",
    });

    const record = JSON.parse((await readFile(file, "utf8")).trim()) as {
      readonly recipient: string;
      readonly verificationUrl: string;
    };
    expect(record).toMatchObject({
      recipient: "member@example.com",
      verificationUrl:
        "http://127.0.0.1:3000/api/auth/verify-email?token=opaque&callbackURL=%2F",
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("rejects a verification URL that leaves the configured Kanvas origin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kanvas-email-outbox-"));
    directories.push(directory);
    const delivery = createEmailVerificationDelivery(
      {
        kind: "development_outbox",
        file: join(directory, "outbox.jsonl"),
        fromAddress: "kanvas@localhost.invalid",
        fromName: "Kanvas",
      },
      "http://127.0.0.1:3000",
    );

    await expect(
      delivery.send({
        recipient: "member@example.com",
        displayName: "Member",
        verificationUrl:
          "https://attacker.example/collect?token=verification-secret",
      }),
    ).rejects.toThrow(/Kanvas origin/u);
  });
});
