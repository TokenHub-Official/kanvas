import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  mediumtext,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const id = (name: string) =>
  char(name, {
    length: 26,
  });

const timestamp = (name: string) =>
  datetime(name, {
    mode: "date",
    fsp: 3,
  });

export const authUserTable = mysqlTable(
  "auth_user",
  {
    id: id("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").notNull(),
    image: mediumtext("image"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [uniqueIndex("uq_auth_user_email").on(table.email)],
);

export const authSessionTable = mysqlTable(
  "auth_session",
  {
    id: id("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    userId: id("user_id")
      .notNull()
      .references(() => authUserTable.id, {
        onDelete: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("uq_auth_session_token").on(table.token),
    index("ix_auth_session_user").on(table.userId, table.expiresAt, table.id),
  ],
);

export const authAccountTable = mysqlTable(
  "auth_account",
  {
    id: id("id").primaryKey(),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 80 }).notNull(),
    userId: id("user_id")
      .notNull()
      .references(() => authUserTable.id, {
        onDelete: "cascade",
      }),
    accessToken: mediumtext("access_token"),
    refreshToken: mediumtext("refresh_token"),
    idToken: mediumtext("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: mediumtext("scope"),
    password: mediumtext("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_auth_account_provider_subject").on(
      table.providerId,
      table.accountId,
    ),
    index("ix_auth_account_user").on(table.userId, table.id),
  ],
);

export const authVerificationTable = mysqlTable(
  "auth_verification",
  {
    id: id("id").primaryKey(),
    identifier: varchar("identifier", { length: 320 }).notNull(),
    value: mediumtext("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ix_auth_verification_identifier").on(
      table.identifier,
      table.expiresAt,
      table.id,
    ),
  ],
);

export const authRateLimitTable = mysqlTable(
  "auth_rate_limit",
  {
    id: id("id").primaryKey(),
    key: varchar("key", { length: 255 }).notNull(),
    count: bigint("count", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    lastRequest: bigint("last_request", {
      mode: "number",
      unsigned: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_auth_rate_limit_key").on(table.key),
    index("ix_auth_rate_limit_last_request").on(table.lastRequest, table.id),
  ],
);

/**
 * Better Auth resolves logical model names from these keys. Physical table
 * names stay under the auth_* namespace so Authentication infrastructure
 * cannot be confused with Kanvas Principal or Membership authority.
 */
export const betterAuthSchema = Object.freeze({
  user: authUserTable,
  session: authSessionTable,
  account: authAccountTable,
  verification: authVerificationTable,
  rateLimit: authRateLimitTable,
});
