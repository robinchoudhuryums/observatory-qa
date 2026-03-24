import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn, safeStorage } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import {
  RiCheckboxCircleFill, RiCheckboxBlankCircleLine, RiArrowRightLine,
  RiArrowDownSLine, RiCloseLine, RiRocketLine,
} from "@remixicon/react";

const STORAGE_KEY = "observatory-onboarding-v2";
const DISMISSED_KEY = "observatory-onboarding-dismissed";

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  href: string;
  plans: Array<"free" | "pro" | "enterprise" | "clinical" | "all">;
}

const ALL_STEPS: ChecklistStep[] = [
  {
    id: "upload_first_call",
    label: "Upload your first call",
    description: "Process a recording to get AI transcription and performance analysis.",
    href: "/upload",
    plans: ["all"],
  },
  {
    id: "add_employee",
    label: "Add an employee",
    description: "Create your team roster so calls can be assigned to agents.",
    href: "/employees",
    plans: ["all"],
  },
  {
    id: "review_analysis",
    label: "Review a call analysis",
    description: "Explore the AI-generated scores, sentiment, and coaching insights.",
    href: "/transcripts",
    plans: ["all"],
  },
  {
    id: "invite_teammate",
    label: "Invite a team member",
    description: "Add a manager or viewer to collaborate on QA reviews.",
    href: "/admin",
    plans: ["all"],
  },
  {
    id: "add_reference_doc",
    label: "Upload a reference document",
    description: "Ground AI analysis in your own SOPs, scripts, and guidelines.",
    href: "/onboarding",
    plans: ["pro", "enterprise", "clinical"],
  },
  {
    id: "customize_template",
    label: "Customize a prompt template",
    description: "Tailor evaluation criteria for each call category your team handles.",
    href: "/admin/templates",
    plans: ["pro", "enterprise"],
  },
  {
    id: "upload_clinical_encounter",
    label: "Upload a clinical encounter",
    description: "Process a patient encounter recording to generate a structured clinical note.",
    href: "/clinical/upload",
    plans: ["clinical", "enterprise"],
  },
  {
    id: "attest_clinical_note",
    label: "Attest a clinical note",
    description: "Review and sign off on an AI-generated SOAP or procedure note.",
    href: "/clinical",
    plans: ["clinical", "enterprise"],
  },
  {
    id: "configure_sso",
    label: "Configure SSO",
    description: "Enable SAML single sign-on for your organization.",
    href: "/admin/settings",
    plans: ["enterprise"],
  },
];

function loadCompleted(): Record<string, boolean> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCompleted(completed: Record<string, boolean>) {
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
}

interface OnboardingChecklistProps {
  /** Auto-mark "upload_first_call" complete when the org has calls */
  hasCallsData?: boolean;
  /** Auto-mark "add_employee" complete when the org has employees */
  hasEmployeesData?: boolean;
}

export default function OnboardingChecklist({
  hasCallsData = false,
  hasEmployeesData = false,
}: OnboardingChecklistProps) {
  const { planTier, isLoading } = useSubscription();
  const [completed, setCompleted] = useState<Record<string, boolean>>(loadCompleted);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(() => safeStorage.getItem(DISMISSED_KEY) === "true");

  // Auto-mark steps from server-side data
  useEffect(() => {
    setCompleted(prev => {
      const next = { ...prev };
      let changed = false;
      if (hasCallsData && !prev.upload_first_call) { next.upload_first_call = true; changed = true; }
      if (hasCallsData && !prev.review_analysis) { next.review_analysis = true; changed = true; }
      if (hasEmployeesData && !prev.add_employee) { next.add_employee = true; changed = true; }
      if (changed) saveCompleted(next);
      return changed ? next : prev;
    });
  }, [hasCallsData, hasEmployeesData]);

  const steps = useMemo(() => {
    if (isLoading) return [];
    return ALL_STEPS.filter(s =>
      s.plans.includes("all") || s.plans.includes(planTier as any)
    );
  }, [planTier, isLoading]);

  const completedCount = steps.filter(s => completed[s.id]).length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allDone = completedCount === totalCount && totalCount > 0;

  const markComplete = (id: string) => {
    setCompleted(prev => {
      const next = { ...prev, [id]: true };
      saveCompleted(next);
      return next;
    });
  };

  const handleDismiss = () => {
    safeStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  if (dismissed || isLoading) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, hsla(var(--brand-from), 0.2), hsla(var(--brand-to), 0.15))" }}
          >
            <RiRocketLine className="w-4 h-4" style={{ color: "hsl(var(--brand-from))" }} />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              {allDone ? "Setup complete!" : "Get started"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {allDone ? "You've completed all setup steps." : `${completedCount} of ${totalCount} steps done`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 hidden sm:block">
            <Progress value={progressPct} className="h-1.5" />
          </div>
          <span className="text-xs font-medium text-muted-foreground w-8 text-right">{progressPct}%</span>
          <RiArrowDownSLine
            className={cn("w-4 h-4 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-1"
            aria-label="Dismiss checklist"
          >
            <RiCloseLine className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="border-t border-border divide-y divide-border">
          {steps.map((step) => {
            const done = !!completed[step.id];
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 transition-colors",
                  done ? "bg-muted/20" : "hover:bg-muted/30"
                )}
              >
                <button
                  type="button"
                  onClick={() => markComplete(step.id)}
                  className="shrink-0"
                  aria-label={done ? "Mark incomplete" : "Mark complete"}
                >
                  {done ? (
                    <RiCheckboxCircleFill className="w-5 h-5 text-green-500" />
                  ) : (
                    <RiCheckboxBlankCircleLine className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-medium", done && "line-through text-muted-foreground")}>
                    {step.label}
                  </p>
                  {!done && (
                    <p className="text-xs text-muted-foreground truncate">{step.description}</p>
                  )}
                </div>
                {!done && (
                  <Link href={step.href}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0">
                      Go <RiArrowRightLine className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}

          {allDone && (
            <div className="px-5 py-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                All set! Dismiss this checklist or keep it for reference.
              </p>
              <Button size="sm" variant="outline" onClick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
