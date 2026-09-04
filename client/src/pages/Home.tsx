import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  Copy,
  Eye,
  FileText,
  Gauge,
  GitBranch,
  History,
  Info,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  MoreHorizontal,
  Package,
  PanelLeft,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  TriangleAlert,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const formatCurrency = (amount: number) =>
  `₹${amount.toLocaleString("en-IN")}`;

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type View = "overview" | "buyer-lab" | "catalog" | "audit";

type AuditEvent = {
  id: string;
  type: string;
  title: string;
  detail: string;
  actor: string;
  timestamp: number;
};

type Proposal = {
  proposalId: string;
  summary: string;
  rationale: string;
  selectedItems: Array<{ productId: string; name: string; quantity: number; unitAmount: number; totalAmount: number }>;
  upsell: { productId: string; name: string; unitAmount: number; reason: string } | null;
  subtotal: number;
  upsellAmount: number;
  total: number;
  maxAllowed: number;
  currency: string;
  status: string;
  guardrails: string[];
};

type ProposalResult = { proposal: Proposal; auditEvents: AuditEvent[] };

type PaymentResult = {
  status: "created" | "failed";
  testMode: boolean;
  orderId?: string;
  amount?: number;
  currency?: string;
  failureCode?: string;
  message: string;
  recovery?: string;
  auditEvents: AuditEvent[];
};

const navItems: Array<{ id: View; label: string; icon: typeof Gauge; hint: string }> = [
  { id: "overview", label: "Growth overview", icon: Gauge, hint: "Revenue signals" },
  { id: "buyer-lab", label: "AI buyer lab", icon: MessageSquareText, hint: "Proposal studio" },
  { id: "catalog", label: "Agent catalog", icon: Code2, hint: "Machine-readable" },
  { id: "audit", label: "Decision trail", icon: History, hint: "Every action" },
];

const fallbackEvents: AuditEvent[] = [
  {
    id: "seed-intent",
    type: "intent.signal.detected",
    title: "High-intent signal detected",
    detail: "AI buyers are asking for warm, low-clutter home-office setups.",
    actor: "Demand signals",
    timestamp: Date.now() - 1000 * 60 * 8,
  },
  {
    id: "seed-bounds",
    type: "policy.bounds.updated",
    title: "Policy bounds confirmed",
    detail: "Order cap held at ₹9,000. Inventory floor held at 3 units.",
    actor: "Merchant policy",
    timestamp: Date.now() - 1000 * 60 * 6,
  },
  {
    id: "seed-ready",
    type: "opportunity.ready",
    title: "Opportunity is ready for review",
    detail: "Warm desk starter set has 86% recommendation confidence.",
    actor: "Vennela agent",
    timestamp: Date.now() - 1000 * 60 * 3,
  },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <div className="font-display text-[1.45rem] leading-none tracking-[-0.045em] text-ink">vennela</div>
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-ink/45">merchant intelligence</div>
      </div>
    </div>
  );
}

function SectionEyebrow({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "orange" }) {
  return (
    <div className={cn("section-eyebrow", tone === "orange" && "text-coral")}>{children}</div>
  );
}

function StatusDot({ tone = "green" }: { tone?: "green" | "orange" | "red" | "ink" }) {
  return <span className={cn("status-dot", `status-dot-${tone}`)} aria-hidden="true" />;
}

export default function Home() {
  const { data: snapshot, isLoading: snapshotLoading } = trpc.commerce.snapshot.useQuery();
  const { data: catalog } = trpc.commerce.catalog.useQuery();
  const interpretIntent = trpc.commerce.interpretIntent.useMutation();
  const createPaymentProposal = trpc.commerce.createPaymentProposal.useMutation();

  const [activeView, setActiveView] = useState<View>("overview");
  const [buyerRequest, setBuyerRequest] = useState("I need a warm, calm desk setup for my new apartment. Nothing too loud.");
  const [proposalResult, setProposalResult] = useState<ProposalResult | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [merchantApproved, setMerchantApproved] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(fallbackEvents);
  const [copied, setCopied] = useState(false);

  const selectedOpportunity = snapshot?.opportunities?.[0];
  const allEvents = useMemo(
    () => [...auditEvents].sort((a, b) => b.timestamp - a.timestamp),
    [auditEvents],
  );

  const runInterpretation = (event?: FormEvent) => {
    event?.preventDefault();
    if (buyerRequest.trim().length < 5) return;
    setPaymentResult(null);
    setMerchantApproved(false);
    interpretIntent.mutate(
      { buyerRequest: buyerRequest.trim() },
      {
        onSuccess: (result) => {
          setProposalResult(result);
          setAuditEvents((current) => [...current, ...result.auditEvents]);
        },
      },
    );
  };

  const runPaymentProposal = (simulateFailure = false) => {
    if (!proposalResult || !merchantApproved) return;
    createPaymentProposal.mutate(
      {
        proposalId: proposalResult.proposal.proposalId,
        amount: proposalResult.proposal.total,
        approved: merchantApproved,
        simulateFailure,
        merchantNote: "Approved in Vennela merchant workspace",
      },
      {
        onSuccess: (result) => {
          setPaymentResult(result);
          setAuditEvents((current) => [...current, ...result.auditEvents]);
        },
      },
    );
  };

  const loadOpportunity = () => {
    setBuyerRequest("I need a warm, calm desk setup for my new apartment. Nothing too loud.");
    setActiveView("buyer-lab");
    setProposalResult(null);
    setPaymentResult(null);
    setMerchantApproved(false);
  };

  const catalogJson = JSON.stringify(catalog?.items || [], null, 2);

  if (snapshotLoading) {
    return (
      <div className="min-h-screen bg-shell px-6 py-10 text-ink">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-8 w-40 rounded-full bg-ink/10" />
          <div className="h-32 rounded-[28px] bg-ink/10" />
          <div className="grid gap-5 md:grid-cols-3"><div className="h-40 rounded-3xl bg-ink/10" /><div className="h-40 rounded-3xl bg-ink/10" /><div className="h-40 rounded-3xl bg-ink/10" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-shell text-ink">
      <div className="grain" aria-hidden="true" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-[255px] shrink-0 flex-col border-r border-ink/10 bg-[#f5f2eb]/80 px-5 py-6 lg:flex">
          <BrandMark />
          <div className="mt-9 rounded-2xl border border-ink/10 bg-white/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/45">
                <Store className="h-3.5 w-3.5" /> Workspace
              </div>
              <MoreHorizontal className="h-4 w-4 text-ink/35" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-xs font-bold text-white">AR</div>
              <div>
                <div className="text-sm font-semibold">Aster & Row</div>
                <div className="mt-0.5 text-[11px] text-ink/48">Merchant workspace</div>
              </div>
            </div>
          </div>

          <nav className="mt-7 space-y-1" aria-label="Workspace navigation">
            <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-ink/35">Workspace</div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={cn("nav-item", active && "nav-item-active")}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-[17px] w-[17px]" />
                  <span className="flex-1 text-left">
                    <span className="block text-[13px] font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] text-ink/40">{item.hint}</span>
                  </span>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-coral" />}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-4">
            <div className="rounded-2xl bg-ink p-4 text-white shadow-[0_14px_32px_rgba(28,30,28,0.14)]">
              <div className="flex items-center justify-between">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10"><ShieldCheck className="h-4 w-4 text-mint" /></div>
                <Badge className="border-0 bg-mint/15 px-2 py-1 text-[10px] font-semibold text-mint">Guardrails live</Badge>
              </div>
              <div className="mt-4 text-sm font-semibold">Money actions stay yours.</div>
              <p className="mt-1 text-[11px] leading-5 text-white/52">Every proposal is bounded, explainable, and paused for your approval.</p>
              <div className="mt-4 border-t border-white/10 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">Policy ceiling <span className="ml-1 text-white/80">₹9,000</span></div>
            </div>
            <div className="flex items-center gap-2 px-2 text-[11px] text-ink/42"><CircleDollarSign className="h-3.5 w-3.5" /> Razorpay test mode <StatusDot tone="green" /></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-ink/10 bg-shell/85 px-5 py-4 backdrop-blur-xl md:px-8 lg:px-10">
            <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-ink/10 bg-white/50 lg:hidden" aria-label="Open navigation"><PanelLeft className="h-4 w-4" /></button>
                <div className="lg:hidden"><BrandMark /></div>
                <div className="hidden items-center gap-2 text-xs text-ink/45 md:flex"><span>Workspace</span><ChevronRight className="h-3.5 w-3.5" /><span className="font-semibold text-ink">{navItems.find((item) => item.id === activeView)?.label}</span></div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="hidden items-center gap-2 rounded-full border border-ink/10 bg-white/60 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/50 sm:flex"><span className="status-dot status-dot-orange" /> Test environment</div>
                <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-ink/10 bg-white/60 text-ink/55 transition hover:bg-white" aria-label="View documentation"><FileText className="h-4 w-4" /></button>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e1d8cc] text-[11px] font-bold">AR</div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9 lg:px-10">
            <div className="mb-7 flex items-end justify-between gap-5">
              <div>
                <SectionEyebrow tone="orange"><Sparkles className="mr-1.5 inline h-3.5 w-3.5" /> Revenue intelligence / 04 Sep 2026</SectionEyebrow>
                <h1 className="mt-3 font-display text-[2.55rem] leading-[0.98] tracking-[-0.055em] text-ink md:text-[3.55rem]">Turn intent into <span className="text-coral">momentum.</span></h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/55">Vennela helps Aster & Row respond to AI-buyer intent with merchant-approved, policy-safe revenue moves.</p>
              </div>
              <div className="hidden items-center gap-2 md:flex"><div className="h-2 w-2 rounded-full bg-mint shadow-[0_0_0_5px_rgba(92,197,153,0.13)]" /><span className="text-xs font-semibold text-ink/50">Agent is monitoring demand</span></div>
            </div>

            <div className="mb-7 flex gap-2 overflow-x-auto border-b border-ink/10 pb-2 lg:hidden">
              {navItems.map((item) => <button key={item.id} onClick={() => setActiveView(item.id)} className={cn("whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold", activeView === item.id ? "bg-ink text-white" : "bg-white/50 text-ink/55")}>{item.label}</button>)}
            </div>

            {activeView === "overview" && (
              <OverviewView snapshot={snapshot} selectedOpportunity={selectedOpportunity} onLoadOpportunity={loadOpportunity} allEvents={allEvents} />
            )}
            {activeView === "buyer-lab" && (
              <BuyerLabView
                buyerRequest={buyerRequest}
                setBuyerRequest={setBuyerRequest}
                runInterpretation={runInterpretation}
                interpretPending={interpretIntent.isPending}
                proposalResult={proposalResult}
                merchantApproved={merchantApproved}
                setMerchantApproved={setMerchantApproved}
                paymentResult={paymentResult}
                paymentPending={createPaymentProposal.isPending}
                runPaymentProposal={runPaymentProposal}
              />
            )}
            {activeView === "catalog" && (
              <CatalogView catalog={catalog} catalogJson={catalogJson} copied={copied} onCopy={() => { navigator.clipboard?.writeText(catalogJson); setCopied(true); setTimeout(() => setCopied(false), 1400); }} />
            )}
            {activeView === "audit" && <AuditView events={allEvents} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function OverviewView({ snapshot, selectedOpportunity, onLoadOpportunity, allEvents }: { snapshot: any; selectedOpportunity: any; onLoadOpportunity: () => void; allEvents: AuditEvent[] }) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Revenue influenced" value={formatCurrency(snapshot?.revenueInfluenced || 0)} delta={`+${snapshot?.revenueInfluencedDelta || 0}%`} icon={CircleDollarSign} accent="coral" />
        <MetricCard label="Open opportunities" value={String(snapshot?.openOpportunities || 0)} delta="3 ready now" icon={Zap} accent="mint" />
        <MetricCard label="Approval rate" value={`${snapshot?.approvalRate || 0}%`} delta="last 30 days" icon={ClipboardCheck} accent="lavender" />
        <MetricCard label="Policy ceiling" value={formatCurrency(snapshot?.policy?.maxOrderValue || 9000)} delta="per proposal" icon={LockKeyhole} accent="sand" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="soft-panel overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-ink/10 p-6 md:p-7">
            <div><SectionEyebrow>Priority opportunity</SectionEyebrow><h2 className="mt-2 font-display text-[2rem] leading-none tracking-[-0.045em]">Warm desk starter set</h2><p className="mt-2 max-w-xl text-sm leading-6 text-ink/52">A clear, low-friction upsell moment surfaced from recent AI-buyer conversations.</p></div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-coral/10 text-coral"><ArrowUpRight className="h-5 w-5" /></div>
          </div>
          <div className="grid gap-6 p-6 md:grid-cols-[1.15fr_0.85fr] md:p-7">
            <div>
              <div className="rounded-2xl bg-[#f6f1e8] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink/55"><Bot className="h-4 w-4 text-coral" /> Agent signal</div>
                <p className="mt-3 text-[15px] leading-6 text-ink/75">“{selectedOpportunity?.signal || "AI buyers are showing intent around calmer desk setups."}”</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2"><span className="chip"><StatusDot tone="green" /> 86% confidence</span><span className="chip"><Package className="h-3.5 w-3.5" /> 28 + 74 units available</span><span className="chip"><ShieldCheck className="h-3.5 w-3.5" /> bounded</span></div>
              <Button onClick={onLoadOpportunity} className="mt-6 rounded-xl bg-ink px-5 text-white shadow-[0_8px_20px_rgba(28,30,28,0.14)] hover:bg-ink/90">Open buyer lab <ArrowUpRight className="ml-2 h-4 w-4" /></Button>
            </div>
            <div className="flex flex-col justify-between rounded-2xl border border-ink/10 bg-white/50 p-5">
              <div><div className="flex items-center justify-between text-xs text-ink/45"><span>Expected basket</span><span className="font-semibold text-ink">{formatCurrency(selectedOpportunity?.value || 2190)}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full w-[72%] rounded-full bg-coral" /></div><div className="mt-2 flex justify-between text-[10px] text-ink/40"><span>single item</span><span>bundled value</span></div></div>
              <div className="mt-8 border-t border-ink/10 pt-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40">Recommended move</div><div className="mt-2 text-sm font-semibold leading-5 text-ink">Offer Aurora Desk Lamp with Linen Cable Kit.</div><div className="mt-2 flex items-center gap-1.5 text-xs text-ink/48"><ArrowDownRight className="h-3.5 w-3.5 text-mint-dark" /> Complements intent without crossing policy</div></div>
            </div>
          </div>
        </div>

        <div className="soft-panel p-6 md:p-7">
          <div className="flex items-center justify-between"><div><SectionEyebrow>Agent run ledger</SectionEyebrow><h2 className="mt-2 font-display text-[1.8rem] leading-none tracking-[-0.045em]">Live decision trail</h2></div><button onClick={() => window.location.hash = "audit"} className="text-xs font-semibold text-coral hover:underline">View all</button></div>
          <div className="mt-6 space-y-5">{allEvents.slice(0, 4).map((event, index) => <TimelineEvent key={`${event.id}-${index}`} event={event} compact />)}</div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="soft-panel p-6"><div className="flex items-center gap-3"><div className="icon-bubble icon-bubble-coral"><MessageSquareText className="h-4 w-4" /></div><div><div className="text-sm font-semibold">AI buyer ready</div><div className="text-xs text-ink/45">Conversational purchase flow</div></div></div><div className="mt-5 text-2xl font-display tracking-[-0.04em]">12 <span className="text-sm font-sans text-ink/45">active intents</span></div><div className="mt-3 text-xs leading-5 text-ink/50">Each request can become a structured proposal, never an invisible charge.</div></div>
        <div className="soft-panel p-6"><div className="flex items-center gap-3"><div className="icon-bubble icon-bubble-mint"><Layers3 className="h-4 w-4" /></div><div><div className="text-sm font-semibold">Catalog coverage</div><div className="text-xs text-ink/45">Structured for machine reading</div></div></div><div className="mt-5 text-2xl font-display tracking-[-0.04em]">100% <span className="text-sm font-sans text-ink/45">indexed</span></div><div className="mt-3 text-xs leading-5 text-ink/50">Prices, stock, tags, and complement edges are explicit and reviewable.</div></div>
        <div className="soft-panel p-6"><div className="flex items-center gap-3"><div className="icon-bubble icon-bubble-lavender"><ShieldCheck className="h-4 w-4" /></div><div><div className="text-sm font-semibold">Approval integrity</div><div className="text-xs text-ink/45">No silent money movement</div></div></div><div className="mt-5 text-2xl font-display tracking-[-0.04em]">0 <span className="text-sm font-sans text-ink/45">unbounded actions</span></div><div className="mt-3 text-xs leading-5 text-ink/50">The merchant remains the decision-maker at the payment boundary.</div></div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, delta, icon: Icon, accent }: { label: string; value: string; delta: string; icon: typeof CircleDollarSign; accent: string }) {
  return <div className="soft-panel metric-card"><div className={cn("icon-bubble", `icon-bubble-${accent}`)}><Icon className="h-[17px] w-[17px]" /></div><div className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40">{label}</div><div className="mt-2 font-display text-[1.9rem] tracking-[-0.045em]">{value}</div><div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-ink/45"><ArrowUpRight className="h-3.5 w-3.5 text-mint-dark" /> {delta}</div></div>;
}

function BuyerLabView({ buyerRequest, setBuyerRequest, runInterpretation, interpretPending, proposalResult, merchantApproved, setMerchantApproved, paymentResult, paymentPending, runPaymentProposal }: { buyerRequest: string; setBuyerRequest: (value: string) => void; runInterpretation: (event?: FormEvent) => void; interpretPending: boolean; proposalResult: ProposalResult | null; merchantApproved: boolean; setMerchantApproved: (value: boolean) => void; paymentResult: PaymentResult | null; paymentPending: boolean; runPaymentProposal: (simulateFailure?: boolean) => void }) {
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><SectionEyebrow tone="orange"><MessageSquareText className="mr-1.5 inline h-3.5 w-3.5" /> AI buyer lab</SectionEyebrow><h2 className="mt-3 font-display text-[2.4rem] leading-none tracking-[-0.05em]">A better checkout conversation.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/52">Interpret buyer intent, propose a useful basket, then pause at the exact moment a merchant should decide.</p></div><div className="flex items-center gap-2 rounded-full bg-mint/12 px-3 py-2 text-[11px] font-semibold text-mint-dark"><StatusDot tone="green" /> No silent charges</div></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(330px,0.85fr)_minmax(0,1.15fr)]">
      <div className="soft-panel flex min-h-[600px] flex-col overflow-hidden">
        <div className="border-b border-ink/10 bg-[#fbfaf7] px-6 py-5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white"><Bot className="h-4 w-4" /></div><div><div className="text-sm font-semibold">Vennela buyer companion</div><div className="mt-0.5 text-[11px] text-ink/45">Shopping with Aster & Row</div></div><span className="ml-auto status-dot status-dot-green" /></div></div>
        <div className="flex-1 space-y-5 p-6"><div className="max-w-[88%] rounded-2xl rounded-tl-md bg-[#f0ede6] p-4 text-sm leading-6 text-ink/72">Hi, I can help shape a thoughtful basket from the merchant’s live catalog. Tell me what kind of space or moment you’re shopping for.</div><div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-ink p-4 text-sm leading-6 text-white/85">{buyerRequest}</div>{proposalResult && <div className="max-w-[92%] rounded-2xl rounded-tl-md border border-mint/25 bg-mint/10 p-4 text-sm leading-6 text-ink/70"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-mint-dark"><Sparkles className="h-3.5 w-3.5" /> Proposal ready for merchant review</div>{proposalResult.proposal.summary}</div>}</div>
        <form onSubmit={runInterpretation} className="border-t border-ink/10 bg-[#fbfaf7] p-5"><label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40" htmlFor="buyer-request">Buyer request</label><div className="flex gap-2"><Input id="buyer-request" value={buyerRequest} onChange={(event) => setBuyerRequest(event.target.value)} className="h-11 rounded-xl border-ink/10 bg-white text-sm shadow-none focus-visible:ring-coral" placeholder="Ask for a product or a feeling…" /><Button type="submit" disabled={interpretPending} className="h-11 w-11 shrink-0 rounded-xl bg-coral p-0 text-white hover:bg-coral/90">{interpretPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div><div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink/40"><Info className="h-3 w-3" /> The agent can suggest, but cannot approve or charge.</div></form>
      </div>
      <div className="space-y-6">
        <div className="soft-panel overflow-hidden">
          <div className="flex items-start justify-between gap-5 border-b border-ink/10 p-6"><div><SectionEyebrow>Structured proposal</SectionEyebrow><h3 className="mt-2 font-display text-[1.8rem] leading-none tracking-[-0.045em]">Merchant review gate</h3></div><Badge className={cn("border-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]", proposalResult ? "bg-orange/15 text-orange-dark" : "bg-ink/8 text-ink/45")}>{proposalResult ? "Awaiting approval" : "No proposal"}</Badge></div>
          {!proposalResult ? <EmptyProposal /> : <div className="p-6">
            <div className="rounded-2xl bg-[#f6f1e8] p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40">Recommended basket</div><div className="mt-2 text-sm font-semibold leading-5">{proposalResult.proposal.summary}</div></div><div className="text-right"><div className="font-display text-2xl tracking-[-0.04em]">{formatCurrency(proposalResult.proposal.total)}</div><div className="text-[10px] text-ink/40">max {formatCurrency(proposalResult.proposal.maxAllowed)}</div></div></div><div className="mt-4 space-y-2 border-t border-ink/10 pt-4">{proposalResult.proposal.selectedItems.map((item) => <div key={item.productId} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-ink/65"><Package className="h-3.5 w-3.5 text-ink/35" /> {item.name}</span><span className="font-semibold">{formatCurrency(item.totalAmount)}</span></div>)}{proposalResult.proposal.upsell && <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-coral"><ArrowUpRight className="h-3.5 w-3.5" /> Add-on · {proposalResult.proposal.upsell.name}</span><span className="font-semibold text-coral">{formatCurrency(proposalResult.proposal.upsell.unitAmount)}</span></div>}</div></div>
            <div className="mt-5 grid gap-4 md:grid-cols-2"><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40">Why this basket</div><p className="mt-2 text-xs leading-5 text-ink/60">{proposalResult.proposal.rationale}</p></div><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink/40">Guardrails applied</div><div className="mt-2 space-y-1.5">{proposalResult.proposal.guardrails.slice(0, 3).map((guardrail) => <div key={guardrail} className="flex gap-2 text-[11px] leading-4 text-ink/55"><Check className="mt-0.5 h-3 w-3 shrink-0 text-mint-dark" />{guardrail}</div>)}</div></div></div>
            <div className="mt-6 rounded-2xl border border-orange/25 bg-orange/8 p-4"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={merchantApproved} onChange={(event) => setMerchantApproved(event.target.checked)} className="mt-1 h-4 w-4 accent-coral" /><span><span className="block text-sm font-semibold text-ink">I approve this bounded proposal</span><span className="mt-1 block text-xs leading-5 text-ink/55">I understand that Vennela will create a Razorpay test-mode payment proposal for {formatCurrency(proposalResult.proposal.total)} only. No buyer is charged at this step.</span></span></label></div>
            <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!merchantApproved || paymentPending} onClick={() => runPaymentProposal(false)} className="rounded-xl bg-ink px-4 text-white hover:bg-ink/90">{paymentPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />} Create test-mode proposal</Button><Button disabled={!merchantApproved || paymentPending} onClick={() => runPaymentProposal(true)} variant="outline" className="rounded-xl border-orange/30 bg-orange/5 text-orange-dark hover:bg-orange/10">Simulate safe timeout <TriangleAlert className="ml-2 h-4 w-4" /></Button></div>
          </div>}
        </div>
        {paymentResult && <PaymentState result={paymentResult} pending={paymentPending} onRetry={() => runPaymentProposal(false)} />}
      </div>
    </div>
  </div>;
}

function EmptyProposal() { return <div className="flex min-h-[335px] flex-col items-center justify-center p-8 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink/5 text-ink/35"><ClipboardCheck className="h-6 w-6" /></div><div className="mt-5 text-sm font-semibold">Your proposal will land here</div><p className="mt-2 max-w-xs text-xs leading-5 text-ink/48">Send a buyer request and Vennela will show the exact items, rationale, policy bounds, and approval step.</p></div>; }

function PaymentState({ result, pending, onRetry }: { result: PaymentResult; pending: boolean; onRetry: () => void }) {
  const failed = result.status === "failed";
  return <div className={cn("rounded-3xl border p-6", failed ? "border-orange/25 bg-orange/8" : "border-mint/25 bg-mint/10")}><div className="flex items-start gap-3"><div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", failed ? "bg-orange/15 text-orange-dark" : "bg-mint/20 text-mint-dark")}>{failed ? <TriangleAlert className="h-5 w-5" /> : <Check className="h-5 w-5" />}</div><div><div className="text-sm font-semibold">{failed ? "Failure handled gracefully" : "Test-mode proposal created"}</div><p className="mt-1 text-xs leading-5 text-ink/60">{result.message}</p></div></div>{failed ? <><div className="mt-4 rounded-2xl border border-orange/15 bg-white/45 p-4 text-xs leading-5 text-ink/60"><span className="font-semibold text-ink">Recovery path:</span> {result.recovery}</div><Button disabled={pending} onClick={onRetry} className="mt-4 rounded-xl bg-ink text-white hover:bg-ink/90"><RefreshCw className="mr-2 h-4 w-4" /> Retry same bounded proposal</Button></> : <div className="mt-4 grid gap-3 sm:grid-cols-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink/40">Order reference</div><div className="mt-1 font-mono text-xs">{result.orderId}</div></div><div><div className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink/40">Mode</div><div className="mt-1 flex items-center gap-1.5 text-xs font-semibold"><StatusDot tone="green" /> Razorpay test</div></div><div><div className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink/40">Charge status</div><div className="mt-1 text-xs font-semibold">Not charged</div></div></div>}</div>;
}

function CatalogView({ catalog, catalogJson, copied, onCopy }: { catalog: any; catalogJson: string; copied: boolean; onCopy: () => void }) {
  return <div className="space-y-6"><div><SectionEyebrow tone="orange"><Code2 className="mr-1.5 inline h-3.5 w-3.5" /> Agent-readable catalog</SectionEyebrow><h2 className="mt-3 font-display text-[2.4rem] leading-none tracking-[-0.05em]">Make the shelf legible to machines.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/52">Products are exposed with explicit identifiers, integer prices, inventory floors, semantic tags, and allowed complement edges for safe recommendations.</p></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"><div className="soft-panel overflow-hidden"><div className="flex items-center justify-between border-b border-ink/10 p-6"><div><SectionEyebrow>Live inventory surface</SectionEyebrow><h3 className="mt-2 font-display text-[1.7rem] tracking-[-0.04em]">{catalog?.merchant || "Aster & Row"}</h3></div><Badge className="border-0 bg-mint/15 text-[10px] text-mint-dark">{catalog?.items?.length || 0} SKUs indexed</Badge></div><div className="divide-y divide-ink/8">{catalog?.items?.map((item: any) => <div key={item.id} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex items-center gap-2 text-sm font-semibold"><span className="h-7 w-7 rounded-lg bg-[#eee8dc]" />{item.name}</div><div className="mt-1 pl-9 text-xs text-ink/45">{item.description}</div><div className="mt-3 flex flex-wrap gap-1.5 pl-9">{item.tags.map((tag: string) => <span key={tag} className="rounded-full bg-ink/5 px-2 py-1 text-[10px] font-medium text-ink/48">#{tag}</span>)}</div></div><div className="flex items-center justify-between gap-4 sm:block sm:text-right"><div className="font-display text-xl tracking-[-0.04em]">{formatCurrency(item.price)}</div><div className="mt-1 text-[10px] text-ink/42">{item.inventory} in stock</div></div></div>)}</div></div><div className="code-panel"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55"><span className="h-2 w-2 rounded-full bg-mint" /> catalog.json</div><button onClick={onCopy} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[10px] font-semibold text-white/60 hover:bg-white/15 hover:text-white">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy JSON"}</button></div><pre className="max-h-[590px] overflow-auto p-5 text-[11px] leading-5 text-[#d7e4dc]">{catalogJson}</pre></div></div></div>;
}

function AuditView({ events }: { events: AuditEvent[] }) { return <div className="space-y-6"><div><SectionEyebrow tone="orange"><History className="mr-1.5 inline h-3.5 w-3.5" /> Immutable-style decision trail</SectionEyebrow><h2 className="mt-3 font-display text-[2.4rem] leading-none tracking-[-0.05em]">Nothing important disappears.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/52">Every agent decision is represented as an event: what happened, why it happened, who acted, and what state followed.</p></div><div className="soft-panel p-6 md:p-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-5"><div className="flex items-center gap-2 text-xs font-semibold text-ink/55"><LockKeyhole className="h-4 w-4 text-mint-dark" /> Append-only event stream</div><div className="font-mono text-[10px] text-ink/35">VENNELA / AUDIT / LIVE</div></div><div className="max-w-3xl">{events.map((event, index) => <TimelineEvent key={`${event.id}-${index}`} event={event} />)}</div></div></div>; }

function TimelineEvent({ event, compact = false }: { event: AuditEvent; compact?: boolean }) { return <div className={cn("relative flex gap-4", !compact && "pb-8 last:pb-0")}>{!compact && <div className="absolute left-[9px] top-6 h-[calc(100%-14px)] w-px bg-ink/10 last:hidden" />}{compact ? <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-coral" /> : <div className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-coral/30 bg-coral/10"><span className="h-1.5 w-1.5 rounded-full bg-coral" /></div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>{event.title}</div><div className="font-mono text-[10px] text-ink/35">{formatTime(event.timestamp)}</div></div><p className={cn("mt-1 leading-5 text-ink/50", compact ? "text-[11px]" : "text-xs")}>{event.detail}</p>{!compact && <div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-ink/5 px-2 py-1 font-mono text-[10px] text-ink/43">{event.type}</span><span className="text-[10px] text-ink/38">by {event.actor}</span></div>}</div></div>; }
