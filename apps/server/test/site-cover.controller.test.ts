import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { expect, it } from "vitest";
import { SiteCoverController } from "../src/http/site-cover.controller.js";
import { InstanceAdministratorGuard } from "../src/http/instance-administrator.guard.js";
it("protects every cover library and upload route with the active administrator guard", () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, SiteCoverController)).toContain(
    InstanceAdministratorGuard,
  );
});
