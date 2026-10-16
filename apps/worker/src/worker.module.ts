import { type DynamicModule, Module } from "@nestjs/common";
import type { ApplicationRuntime } from "@kanvas/application";

import { WorkflowTopologyQueueAdapter } from "./queue/workflow-topology.queue-adapter.js";
import { APPLICATION_RUNTIME } from "./tokens.js";

@Module({})
export class WorkerModule {
  public static register(runtime: ApplicationRuntime): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        {
          provide: APPLICATION_RUNTIME,
          useValue: runtime,
        },
        WorkflowTopologyQueueAdapter,
      ],
      exports: [WorkflowTopologyQueueAdapter],
    };
  }
}
