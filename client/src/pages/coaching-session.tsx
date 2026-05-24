import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Employee } from "@shared/schema";
import { AgentSystem, CallList, OrreryCard, OrreryKpi, OrreryTag, useOrreryTheme } from "@/components/orrery";
import { agentsToCoachingSystems } from "@/lib/orrery-adapters";
import { RiArrowLeftLine, RiArrowRightSLine, RiCheckLine, RiHomeLine, RiTimeLine } from "@remixicon/react";

interface CoachingSession {
  id: string;
  employeeId: string;
  employeeName?: string;
  callId?: string;
  assignedBy: string;
  category: string;
  title: string;
  notes?: string;
  actionPlan?: Array<{ task: string; completed: boolean }>;
  status: "pending" | "in_progress" | "completed" | "dismissed";
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
}

interface Effectiveness {
  message?: string;
  data?: {
    preScore: number;
    postScore: number;
    delta: number;
    callsBefore: number;
    callsAfter: number;
  } | null;
}

/**
 * Coaching session detail page — `/coaching/:id`.
 *
 * Sprint 2 action A1+A2: displays the full session with action plan editor,
 * reference calls, effectiveness metrics, and an orrery-chrome header showing
 * the employee's AgentSystem mini-orrery.
 */
export default function CoachingSessionPage() {
  const params = useParams();
  const sessionId = params?.id;
  const t = useOrreryTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sessions } = useQuery<CoachingSession[]>({
    queryKey: ["/api/coaching"],
  });

  const session = useMemo(() => sessions?.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: effectiveness } = useQuery<Effectiveness>({
    queryKey: ["/api/coaching", sessionId, "effectiveness"],
    enabled: !!sessionId,
  });

  const employee = useMemo(() => employees?.find((e) => e.id === session?.employeeId) ?? null, [employees, session]);

  // Build a single-agent CoachingAgent for the orrery header.
  const agentData = useMemo(() => {
    if (!employee || !sessions) return null;
    const agents = agentsToCoachingSystems([employee], [], sessions, []);
    return agents[0] ?? null;
  }, [employee, sessions]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/coaching/${sessionId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
      toast({ title: "Session updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleTask = (index: number) => {
    if (!session?.actionPlan) return;
    const updated = session.actionPlan.map((item, i) => (i === index ? { ...item, completed: !item.completed } : item));
    updateMutation.mutate({ actionPlan: updated });
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="coaching-session-page">
        <OrreryCard t={t}>
          <div className="p-8 text-center">
            <OrreryTag t={t}>◇ SESSION NOT FOUND</OrreryTag>
            <p className="mt-2 text-muted-foreground text-sm">
              This coaching session may have been deleted or you don't have access.
            </p>
            <Link href="/coaching">
              <Button variant="outline" className="mt-4">
                <RiArrowLeftLine className="w-4 h-4 mr-2" /> Back to coaching
              </Button>
            </Link>
          </div>
        </OrreryCard>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  };

  const completedTasks = session.actionPlan?.filter((t) => t.completed).length ?? 0;
  const totalTasks = session.actionPlan?.length ?? 0;
  const eff = effectiveness?.data;

  return (
    <div className="min-h-screen" data-testid="coaching-session-page">
      <header className="dashboard-header px-6 py-4">
        <nav className="flex items-center text-sm text-muted-foreground mb-2">
          <Link href="/" className="hover:text-foreground transition-colors">
            <RiHomeLine className="w-4 h-4" />
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <Link href="/coaching" className="hover:text-foreground transition-colors">
            Coaching
          </Link>
          <RiArrowRightSLine className="w-3 h-3 mx-2" />
          <span className="text-foreground font-medium">Session</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <OrreryTag t={t}>
              ◇ {session.category?.toUpperCase() || "GENERAL"} · {session.status.toUpperCase().replace("_", " ")}
            </OrreryTag>
            <h2
              className="text-2xl font-semibold mt-1"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: "italic",
                color: t.ink,
                letterSpacing: "-0.02em",
              }}
            >
              {session.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={statusColor[session.status] || ""}>{session.status.replace("_", " ")}</Badge>
            {session.status !== "completed" && session.status !== "dismissed" && (
              <Button
                size="sm"
                onClick={() => updateMutation.mutate({ status: "completed" })}
                disabled={updateMutation.isPending}
              >
                <RiCheckLine className="w-4 h-4 mr-1" /> Mark complete
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Orrery header — agent mini-orrery + KPIs (A2) */}
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
          {agentData && (
            <OrreryCard
              t={t}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
            >
              <AgentSystem t={t} agent={agentData} />
              <div className="mt-2 text-sm font-medium text-center" style={{ color: t.ink }}>
                {employee?.name}
              </div>
              <div className="text-xs text-muted-foreground">{employee?.role || "Team member"}</div>
            </OrreryCard>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <OrreryKpi t={t} label="Progress" value={`${completedTasks}/${totalTasks}`} accentRamp="bright" />
            <OrreryKpi t={t} label="Pre-score" value={eff?.preScore?.toFixed(1) ?? "—"} accentRamp="cold" />
            <OrreryKpi
              t={t}
              label="Post-score"
              value={eff?.postScore?.toFixed(1) ?? "—"}
              accentRamp={eff && eff.delta > 0 ? "warm" : "cool"}
            />
            <OrreryKpi
              t={t}
              label="Delta"
              value={eff ? `${eff.delta > 0 ? "+" : ""}${eff.delta.toFixed(1)}` : "—"}
              accentRamp={eff && eff.delta > 0 ? "green" : "amber"}
            />
          </div>
        </div>

        {/* Action plan */}
        {session.actionPlan && session.actionPlan.length > 0 && (
          <OrreryCard t={t}>
            <OrreryTag t={t}>◇ ACTION PLAN</OrreryTag>
            <div className="mt-3 space-y-2">
              {session.actionPlan.map((item, i) => (
                <label
                  key={i}
                  className="flex items-start gap-3 p-2 rounded-md hover:bg-accent/20 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={item.completed}
                    onCheckedChange={() => toggleTask(i)}
                    disabled={session.status === "completed" || session.status === "dismissed"}
                    className="mt-0.5"
                  />
                  <span
                    className={`text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
                  >
                    {item.task}
                  </span>
                </label>
              ))}
            </div>
          </OrreryCard>
        )}

        {/* Notes */}
        {session.notes && (
          <OrreryCard t={t}>
            <OrreryTag t={t}>◇ COACHING NOTES</OrreryTag>
            <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{session.notes}</p>
          </OrreryCard>
        )}

        {/* Metadata */}
        <OrreryCard t={t}>
          <OrreryTag t={t}>◇ SESSION INFO</OrreryTag>
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            {session.createdAt && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Created</div>
                <div className="mt-1">{new Date(session.createdAt).toLocaleDateString()}</div>
              </div>
            )}
            {session.dueDate && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Due</div>
                <div className="mt-1 flex items-center gap-1">
                  <RiTimeLine className="w-3.5 h-3.5" />
                  {new Date(session.dueDate).toLocaleDateString()}
                </div>
              </div>
            )}
            {session.completedAt && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Completed</div>
                <div className="mt-1">{new Date(session.completedAt).toLocaleDateString()}</div>
              </div>
            )}
            {session.employeeName && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Employee</div>
                <div className="mt-1">{session.employeeName}</div>
              </div>
            )}
          </div>
        </OrreryCard>

        {/* Reference call — if session was created from a specific call */}
        {session.callId && (
          <section>
            <OrreryTag t={t}>◇ REFERENCE CALL</OrreryTag>
            <div className="mt-3">
              <CallList
                mode="compact"
                limit={1}
                filterFn={(c) => c.id === session.callId}
                emptyTitle="Reference call not found."
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
