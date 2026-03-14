import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load metrics</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric-card rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="w-12 h-12 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const totalCalls = metrics?.totalCalls ?? 0;
  const metricCards = [
    {
      title: "Total Calls",
      value: totalCalls,
      change: `${totalCalls} analyzed`,
      icon: Phone,
      iconStyle: { background: "linear-gradient(135deg, hsla(var(--brand-from), 0.2), hsla(var(--brand-to), 0.1))" },
      iconColorStyle: { color: "hsl(var(--brand-from))" },
      glowClass: "metric-glow-brand",
    },
    {
      title: "Avg Sentiment",
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      change: "Avg across calls",
      icon: Heart,
      iconStyle: { background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(34, 197, 94, 0.1))" },
      iconColorStyle: { color: "rgb(16, 185, 129)" },
      glowClass: "metric-glow-green",
    },
    {
      title: "Transcription Time",
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      change: "Avg per call",
      icon: Clock,
      iconStyle: { background: "linear-gradient(135deg, hsla(var(--brand-to), 0.2), hsla(var(--brand-to), 0.1))" },
      iconColorStyle: { color: "hsl(var(--brand-to))" },
      glowClass: "metric-glow-brand-alt",
    },
    {
      title: "Team Score",
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      change: "Avg performance",
      icon: Star,
      iconStyle: { background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.1))" },
      iconColorStyle: { color: "rgb(168, 85, 247)" },
      glowClass: "metric-glow-purple",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className={`metric-card rounded-xl p-6 ${metric.glowClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm font-medium">{metric.title}</p>
                <p className="text-3xl font-bold text-foreground mt-1" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {metric.value}
                </p>
                <p className="text-xs mt-1.5 text-muted-foreground">
                  {metric.change}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={metric.iconStyle}>
                <Icon className="w-5 h-5" style={metric.iconColorStyle} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
