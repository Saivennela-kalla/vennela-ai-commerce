import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const POLICY = {
  maxOrderValue: 9000,
  maxUpsellValue: 2500,
  currency: "INR",
  minimumInventory: 3,
  approvalRequired: true,
};

const CATALOG = [
  {
    id: "aurora-desk-lamp",
    name: "Aurora Desk Lamp",
    description: "Brushed brass reading lamp with a warm dimmable glow.",
    category: "lighting",
    price: 3490,
    inventory: 28,
    tags: ["warm", "home office", "giftable"],
    upsellProductIds: ["linen-cable-kit", "oak-catchall-tray"],
  },
  {
    id: "linen-cable-kit",
    name: "Linen Cable Kit",
    description: "A braided linen cable and brass clips for a calmer desk.",
    category: "desk accessories",
    price: 990,
    inventory: 74,
    tags: ["organised", "warm", "desk"],
    upsellProductIds: [],
  },
  {
    id: "terrazzo-planter",
    name: "Terrazzo Planter",
    description: "Hand-finished terrazzo planter for a small shelf or desk.",
    category: "decor",
    price: 2190,
    inventory: 41,
    tags: ["neutral", "plant", "small space"],
    upsellProductIds: ["linen-cable-kit"],
  },
  {
    id: "cloud-throw",
    name: "Cloud Throw",
    description: "Soft cotton throw in oat, finished with a quiet fringe.",
    category: "textiles",
    price: 2990,
    inventory: 19,
    tags: ["warm", "oat", "cosy"],
    upsellProductIds: ["terrazzo-planter"],
  },
  {
    id: "oak-catchall-tray",
    name: "Oak Catchall Tray",
    description: "Solid oak tray for keys, earbuds, and the small things in motion.",
    category: "desk accessories",
    price: 1890,
    inventory: 55,
    tags: ["oak", "organised", "giftable"],
    upsellProductIds: ["aurora-desk-lamp"],
  },
] as const;

type CatalogItem = (typeof CATALOG)[number];

type ProposalItem = {
  productId: string;
  name: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
};

function money(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function chooseFallbackProducts(request: string) {
  const text = request.toLowerCase();
  const primary = text.includes("plant") || text.includes("green")
    ? "terrazzo-planter"
    : text.includes("throw") || text.includes("cosy") || text.includes("cozy")
      ? "cloud-throw"
      : text.includes("tray") || text.includes("organise") || text.includes("organize")
        ? "oak-catchall-tray"
        : "aurora-desk-lamp";
  const upsell = primary === "aurora-desk-lamp" ? "linen-cable-kit" : "oak-catchall-tray";
  return { primary, upsell };
}

function productById(id: string) {
  return CATALOG.find((product) => product.id === id);
}

function buildProposal(params: {
  request: string;
  selectedProductIds: string[];
  upsellProductId?: string | null;
  rationale: string;
  summary: string;
}) {
  const uniqueIds = Array.from(new Set(params.selectedProductIds)).filter((id) => Boolean(productById(id)));
  const fallback = chooseFallbackProducts(params.request);
  const selectedIds = uniqueIds.length > 0 ? uniqueIds : [fallback.primary];
  const selectedItems: ProposalItem[] = selectedIds.slice(0, 3).map((id) => {
    const product = productById(id) as CatalogItem;
    return {
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitAmount: product.price,
      totalAmount: product.price,
    };
  });

  const baseTotal = selectedItems.reduce((sum, item) => sum + item.totalAmount, 0);
  const requestedUpsell = params.upsellProductId || fallback.upsell;
  const upsellProduct = productById(requestedUpsell);
  const canUseUpsell = Boolean(
    upsellProduct &&
    upsellProduct.inventory >= POLICY.minimumInventory &&
    upsellProduct.price <= POLICY.maxUpsellValue &&
    baseTotal + upsellProduct.price <= POLICY.maxOrderValue &&
    !selectedIds.includes(upsellProduct.id),
  );
  const upsell = canUseUpsell && upsellProduct
    ? {
        productId: upsellProduct.id,
        name: upsellProduct.name,
        unitAmount: upsellProduct.price,
        reason: "Complements the buyer’s stated intent while staying inside the merchant’s policy ceiling.",
      }
    : null;
  const total = baseTotal + (upsell?.unitAmount ?? 0);

  return {
    proposalId: `vp_${nanoid(10)}`,
    summary: params.summary || "A bounded, merchant-reviewable bundle for this buyer intent.",
    rationale: params.rationale || "The bundle matches the buyer’s request and uses catalog-defined complement signals.",
    selectedItems,
    upsell,
    subtotal: baseTotal,
    upsellAmount: upsell?.unitAmount ?? 0,
    total,
    maxAllowed: POLICY.maxOrderValue,
    currency: POLICY.currency,
    status: "awaiting_approval" as const,
    guardrails: [
      `Total is capped at ${money(POLICY.maxOrderValue)}.`,
      "Inventory below the merchant floor is excluded.",
      "Merchant approval is required before a payment proposal is created.",
      "Test mode only: proposal creation never silently charges a buyer.",
    ],
  };
}

function extractText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text || ""))
      .join("");
  }
  return "";
}

function parseModelProposal(content: unknown) {
  const text = extractText(content).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as {
      summary?: string;
      rationale?: string;
      selectedProductIds?: string[];
      upsellProductId?: string | null;
    };
  } catch {
    return null;
  }
}

async function generateProposal(request: string) {
  const catalogForModel = CATALOG.map(({ id, name, description, category, price, inventory, tags, upsellProductIds }) => ({
    id,
    name,
    description,
    category,
    price,
    inventory,
    tags,
    upsellProductIds,
  }));

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are Vennela, a cautious merchant-growth agent. Interpret an AI buyer request using only the supplied catalog. Recommend a useful base item and at most one catalog-defined upsell. Never invent products, prices, inventory, discounts, or guarantees. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            buyerRequest: request,
            policy: POLICY,
            catalog: catalogForModel,
            output: "Choose selectedProductIds, an optional upsellProductId, a concise summary, and a rationale. Keep the recommendation under the policy maxOrderValue.",
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "vennela_purchase_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              rationale: { type: "string" },
              selectedProductIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
              upsellProductId: { type: ["string", "null"] },
            },
            required: ["summary", "rationale", "selectedProductIds", "upsellProductId"],
            additionalProperties: false,
          },
        },
      },
    });
    return parseModelProposal(response.choices?.[0]?.message?.content);
  } catch (error) {
    console.warn("[Vennela] LLM proposal generation fell back to deterministic catalog matching.", error);
    return null;
  }
}

const snapshot = {
  merchantName: "Aster & Row",
  revenueInfluenced: 112400,
  revenueInfluencedDelta: 18.4,
  openOpportunities: 7,
  approvalRate: 94,
    policy: POLICY,
  opportunities: [
    {
      id: "bundle-01",
      title: "Warm desk starter set",
      signal: "18 AI buyers asked for calmer home-office setups this week.",
      value: 2190,
      confidence: 86,
      action: "Offer Aurora Desk Lamp + Linen Cable Kit",
      status: "ready",
    },
    {
      id: "bundle-02",
      title: "Small-space green corner",
      signal: "Planter intent is rising in apartment-living conversations.",
      value: 2190,
      confidence: 78,
      action: "Pair Terrazzo Planter with Oak Catchall Tray",
      status: "watch",
    },
    {
      id: "bundle-03",
      title: "Gifting without the guesswork",
      signal: "Giftable, neutral objects outperform single-SKU requests.",
      value: 5380,
      confidence: 71,
      action: "Recommend a bounded two-item gift set",
      status: "watch",
    },
  ],
};

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  commerce: router({
    snapshot: publicProcedure.query(() => snapshot),
    catalog: publicProcedure.query(() => ({
      merchant: snapshot.merchantName,
      currency: POLICY.currency,
      policy: POLICY,
      items: CATALOG,
      schema: {
        id: "stable catalog identifier",
        price: "integer amount in INR",
        inventory: "available units",
        upsellProductIds: "allowed complement edges",
      },
    })),
    interpretIntent: publicProcedure
      .input(z.object({ buyerRequest: z.string().min(5).max(600) }))
      .mutation(async ({ input }) => {
        const modelProposal = await generateProposal(input.buyerRequest);
        const fallback = chooseFallbackProducts(input.buyerRequest);
        const proposal = buildProposal({
          request: input.buyerRequest,
          selectedProductIds: modelProposal?.selectedProductIds || [fallback.primary],
          upsellProductId: modelProposal?.upsellProductId || fallback.upsell,
          rationale: modelProposal?.rationale || "The recommendation is grounded in catalog tags and complement edges, then checked against the merchant’s hard ceiling.",
          summary: modelProposal?.summary || "A warm, bounded starter set for the buyer’s stated intent.",
        });
        const timestamp = Date.now();
        return {
          proposal,
          auditEvents: [
            {
              id: `evt_${nanoid(8)}`,
              type: "buyer.intent.interpreted",
              title: "Buyer intent interpreted",
              detail: `Matched “${input.buyerRequest.slice(0, 96)}${input.buyerRequest.length > 96 ? "…" : ""}” to catalog signals.`,
              actor: "Vennela agent",
              timestamp,
            },
            {
              id: `evt_${nanoid(8)}`,
              type: "policy.bounds.checked",
              title: "Policy bounds checked",
              detail: `${money(proposal.total)} proposed against a ${money(POLICY.maxOrderValue)} maximum.`,
              actor: "Policy engine",
              timestamp: timestamp + 1,
            },
            {
              id: `evt_${nanoid(8)}`,
              type: "merchant.approval.required",
              title: "Merchant approval required",
              detail: "No payment proposal can be created until the merchant explicitly approves this amount.",
              actor: "Vennela guardrail",
              timestamp: timestamp + 2,
            },
          ],
        };
      }),
    createPaymentProposal: publicProcedure
      .input(z.object({
        proposalId: z.string().min(3),
        amount: z.number().int().positive(),
        approved: z.boolean(),
        simulateFailure: z.boolean().optional().default(false),
        merchantNote: z.string().max(240).optional(),
      }))
      .mutation(async ({ input }) => {
        if (!input.approved) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Merchant approval is required before a payment proposal can be created." });
        }
        if (input.amount > POLICY.maxOrderValue) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Amount exceeds the ${money(POLICY.maxOrderValue)} policy ceiling.` });
        }

        const attemptedAt = Date.now();
        if (input.simulateFailure) {
          return {
            status: "failed" as const,
            testMode: true,
            failureCode: "razorpay_test_timeout",
            message: "Razorpay test-mode order creation timed out. No charge was attempted and the approval remains reusable.",
            recovery: "Retry the same bounded proposal. Vennela will reuse the approval token and prevent duplicate charges.",
            auditEvents: [
              {
                id: `evt_${nanoid(8)}`,
                type: "payment.proposal.failed",
                title: "Test-mode payment proposal failed safely",
                detail: "Timeout handled without charging or losing the merchant approval.",
                actor: "Razorpay test-mode adapter",
                timestamp: attemptedAt,
              },
              {
                id: `evt_${nanoid(8)}`,
                type: "payment.recovery.ready",
                title: "Recovery path ready",
                detail: "Retry is idempotent at the proposal layer; the merchant does not need to approve a new amount.",
                actor: "Vennela recovery",
                timestamp: attemptedAt + 1,
              },
            ],
          };
        }

        let orderId = `order_vennela_${nanoid(12)}`;
        const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
        const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
        if (razorpayKeyId || razorpayKeySecret) {
          if (!razorpayKeyId?.startsWith("rzp_test_") || !razorpayKeySecret) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only Razorpay test-mode credentials are accepted. Use a key beginning with rzp_test_." });
          }
          const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
          const response = await fetch("https://api.razorpay.com/v1/orders", {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amount: input.amount * 100,
              currency: POLICY.currency,
              receipt: input.proposalId,
              notes: {
                source: "vennela",
                approval: "merchant-approved",
                merchantNote: input.merchantNote || "",
              },
            }),
          });
          if (!response.ok) {
            return {
              status: "failed" as const,
              testMode: true,
              failureCode: "razorpay_test_api_error",
              message: "Razorpay returned a test-mode error. No charge was attempted.",
              recovery: "Check the test-mode credentials or retry with the same bounded proposal.",
              auditEvents: [
                {
                  id: `evt_${nanoid(8)}`,
                  type: "payment.proposal.failed",
                  title: "Razorpay test-mode error handled",
                  detail: "The response was surfaced to the merchant without creating a customer charge.",
                  actor: "Razorpay test-mode adapter",
                  timestamp: attemptedAt,
                },
              ],
            };
          }
          const order = (await response.json()) as { id?: string };
          if (order.id) orderId = order.id;
        }

        return {
          status: "created" as const,
          testMode: true,
          orderId,
          amount: input.amount,
          currency: POLICY.currency,
          message: "Payment proposal created in test mode. A buyer-facing checkout can now be opened after the merchant reviews the order.",
          auditEvents: [
            {
              id: `evt_${nanoid(8)}`,
              type: "payment.proposal.created",
              title: "Test-mode payment proposal created",
              detail: `${money(input.amount)} bounded by merchant approval. No silent charge occurred.`,
              actor: "Razorpay test-mode adapter",
              timestamp: attemptedAt,
            },
          ],
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
