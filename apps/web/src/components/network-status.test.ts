import { describe, expect, it } from "vitest";

import { nextNetworkStatus } from "./network-status.js";

describe("network status", () => {
  it("stays offline through repeated offline events", () => {
    expect(nextNetworkStatus("online", "offline")).toBe("offline");
    expect(nextNetworkStatus("offline", "offline")).toBe("offline");
  });

  it("announces only a real offline-to-online recovery", () => {
    expect(nextNetworkStatus("online", "online")).toBe("online");
    expect(nextNetworkStatus("offline", "online")).toBe("restored");
    expect(nextNetworkStatus("restored", "settled")).toBe("online");
  });

  it("returns to offline if the connection drops during recovery", () => {
    expect(nextNetworkStatus("restored", "offline")).toBe("offline");
  });
});
