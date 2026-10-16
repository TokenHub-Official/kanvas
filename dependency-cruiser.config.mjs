const fixturePrefix = "(?:architecture-fixtures/)?";
const applicationSource = `(^|/)${fixturePrefix}packages/application/`;
const contractsSource = `(^|/)${fixturePrefix}packages/contracts/`;
const databaseSource = "(^|/)packages/database/";
const storageSource = `(^|/)${fixturePrefix}packages/storage/`;
const webSource = `(^|/)${fixturePrefix}apps/web/`;

export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "packages-and-tools-do-not-import-apps",
      severity: "error",
      from: {
        path: `^(?:architecture-fixtures/)?(?:packages|tools)/`,
      },
      to: {
        path: "(^|/)apps/",
      },
    },
    {
      name: "mastra-isolated-to-agent-runtime",
      severity: "error",
      from: {
        pathNot: "^(?:architecture-fixtures/)?packages/agent-runtime/",
      },
      to: {
        path: "node_modules/@mastra/",
      },
    },
    {
      name: "core-packages-do-not-import-agent-runtime",
      severity: "error",
      from: {
        path: `^(?:architecture-fixtures/)?packages/(?:application|contracts|database|image-atomic-core|recovery|secrets|storage)/`,
      },
      to: {
        path: "(^|/)packages/agent-runtime/",
      },
    },
    {
      name: "application-is-framework-free",
      severity: "error",
      from: {
        path: applicationSource,
      },
      to: {
        path: `(${databaseSource}|node_modules/(?:@nestjs|react|drizzle-orm|bullmq|ioredis|mysql2))`,
      },
    },
    {
      name: "storage-is-framework-free",
      severity: "error",
      from: {
        path: storageSource,
      },
      to: {
        path: "(?:node_modules/(?:@nestjs|react|fastify|express|hono|koa)|architecture-fixtures/frameworks/)",
      },
    },
    {
      name: "web-does-not-reach-server-core",
      severity: "error",
      from: {
        path: webSource,
      },
      to: {
        path: `(${applicationSource}|${databaseSource}|(^|/)apps/(?:server|worker)/)`,
      },
    },
    {
      name: "contracts-are-leaf-authority",
      severity: "error",
      from: {
        path: contractsSource,
      },
      to: {
        path: `(${applicationSource}|${databaseSource}|(^|/)apps/)`,
      },
    },
    {
      name: "server-does-not-import-other-apps",
      severity: "error",
      from: {
        path: `^(?:architecture-fixtures/)?apps/server/`,
      },
      to: {
        path: "(^|/)apps/(?:web|worker)/",
      },
    },
    {
      name: "worker-does-not-import-other-apps",
      severity: "error",
      from: {
        path: `^(?:architecture-fixtures/)?apps/worker/`,
      },
      to: {
        path: "(^|/)apps/(?:web|server)/",
      },
    },
    {
      name: "no-product-code-to-scenarios",
      severity: "error",
      from: {
        path: "^(?:architecture-fixtures/)?(?:apps|packages)/",
      },
      to: {
        path: "(^|/)scenario-packs/",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: "(^|/)(coverage|dist|generated|node_modules)/",
    includeOnly: "^(apps|packages|tools|architecture-fixtures|scenario-packs)/",
    moduleSystems: ["es6", "cjs"],
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
  },
};
