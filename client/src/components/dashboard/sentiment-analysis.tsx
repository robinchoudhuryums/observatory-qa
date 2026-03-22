import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";
import type { SentimentDistribution } from "@shared/schema";
import {  RiAlertLine, RiRefreshLine  } from "@remixicon/react";

export default function SentimentAnalysis() {
  const queryClient = useQueryClient();
  const { data: sentimentData, isLoading, error } = useQuery<SentimentDistribution>({
    queryKey: ["/api/dashboard/sentiment"],
  });

  if (error) {
    return (
      <div className="modern-card rounded-xl p-6 text-center">
        <p className="text-sm text-muted-foreground">No sentiment data yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">Sentiment analysis will appear after calls are processed.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="modern-card rounded-xl p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-72 bg-muted rounded mb-4"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const positive = sentimentData?.positive ?? 0;
  const neutral = sentimentData?.neutral ?? 0;
  const negative = sentimentData?.negative ?? 0;
  const total = positive + neutral + negative;

  const chartData = [
    { name: "Positive", value: positive, color: "hsl(158, 64%, 52%)" },
    { name: "Neutral", value: neutral, color: "hsl(45, 93%, 58%)" },
    { name: "Negative", value: negative, color: "hsl(0, 84%, 60%)" },
  ];

  const pct = (val: number) => total > 0 ? Math.round((val / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="modern-card rounded-xl p-6"
      data-testid="sentiment-analysis"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Sentiment Analysis</h3>
      </div>

      <div className="chart-container mb-4" role="img" aria-label={`Sentiment distribution: ${pct(positive)}% positive, ${pct(neutral)}% neutral, ${pct(negative)}% negative out of ${total} calls`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
              animationDuration={1000}
              animationEasing="ease-out"
              label={({ name, value }) => total > 0 ? `${name}: ${Math.round((value / total) * 100)}%` : ""}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} calls (${total > 0 ? Math.round((value / total) * 100) : 0}%)`, name]}
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 8 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 sentiment-positive rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-positive">
            {pct(positive)}%
          </p>
          <p className="text-sm font-medium">Positive ({positive})</p>
        </div>
        <div className="text-center p-3 sentiment-neutral rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-neutral">
            {pct(neutral)}%
          </p>
          <p className="text-sm font-medium">Neutral ({neutral})</p>
        </div>
        <div className="text-center p-3 sentiment-negative rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-negative">
            {pct(negative)}%
          </p>
          <p className="text-sm font-medium">Negative ({negative})</p>
        </div>
      </div>
    </motion.div>
  );
}
