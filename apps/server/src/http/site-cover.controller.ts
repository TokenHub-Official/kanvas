import {
  Body,
  Controller,
  Headers,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AllocateSiteCoverSchema,
  allocateSiteCoverRoute,
  commitSiteCoverRoute,
  listSiteCoversRoute,
  uploadSiteCoverRoute,
  type AllocateSiteCover,
} from "@kanvas/contracts/api";
import type { FastifyRequest } from "fastify";
import { SiteCoverService } from "../storage/site-cover.service.js";
import { ContractRoute } from "./contract-route.decorator.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { InstanceAdministratorContextStore } from "./instance-administrator-context.js";
import { InstanceAdministratorGuard } from "./instance-administrator.guard.js";
import { mapSiteToolError } from "./site-tools.controller.js";
@Controller()
@UseGuards(InstanceAdministratorGuard)
export class SiteCoverController {
  constructor(
    private readonly covers: SiteCoverService,
    private readonly contexts: InstanceAdministratorContextStore,
  ) {}
  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      return mapSiteToolError(error);
    }
  }
  @ContractRoute(allocateSiteCoverRoute)
  allocate(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ContractBodyPipe(AllocateSiteCoverSchema))
    body: AllocateSiteCover,
  ) {
    return this.run(() =>
      this.covers.allocate(
        this.contexts.require(request).scope,
        key ?? "",
        body,
      ),
    );
  }
  @ContractRoute(uploadSiteCoverRoute)
  upload(
    @Req() request: FastifyRequest,
    @Param("uploadSessionId") id: string,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.covers.upload(this.contexts.require(request).scope, id, body),
    );
  }
  @ContractRoute(commitSiteCoverRoute)
  commit(@Req() request: FastifyRequest, @Param("uploadSessionId") id: string) {
    return this.run(() =>
      this.covers.commit(this.contexts.require(request).scope, id),
    );
  }
  @ContractRoute(listSiteCoversRoute)
  list(@Req() request: FastifyRequest) {
    return this.run(() =>
      this.covers.list(this.contexts.require(request).scope),
    );
  }
}
