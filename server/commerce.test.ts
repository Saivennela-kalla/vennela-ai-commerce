import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("commerce payment boundary", () => {
  it("blocks a payment proposal until the merchant approves it", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(
      caller.commerce.createPaymentProposal({
        proposalId: "vp_test_approval",
        amount: 3490,
        approved: false,
      }),
    ).rejects.toThrow("Merchant approval is required");
  });

  it("rejects an amount over the merchant policy ceiling", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(
      caller.commerce.createPaymentProposal({
        proposalId: "vp_test_bounds",
        amount: 9001,
        approved: true,
      }),
    ).rejects.toThrow("policy ceiling");
  });

  it("returns an explicit recovery state when test-mode creation times out", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.commerce.createPaymentProposal({
      proposalId: "vp_test_failure",
      amount: 4480,
      approved: true,
      simulateFailure: true,
    });

    expect(result.status).toBe("failed");
    expect(result.testMode).toBe(true);
    expect(result.failureCode).toBe("razorpay_test_timeout");
    expect(result.recovery).toContain("Retry the same bounded proposal");
    expect(result.auditEvents).toHaveLength(2);
  });

  it("creates only a test-mode proposal after approval", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.commerce.createPaymentProposal({
      proposalId: "vp_test_success",
      amount: 4480,
      approved: true,
    });

    expect(result.status).toBe("created");
    expect(result.testMode).toBe(true);
    expect(result.orderId).toMatch(/^order_vennela_/);
    expect(result.message).toContain("test mode");
  });
});
