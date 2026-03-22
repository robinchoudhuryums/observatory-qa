import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {  RiMoneyDollarCircleLine, RiArrowRightUpLine, RiTeamLine, RiSubtractLine  } from "@remixicon/react";

type RevenueMetrics = {
  totalEstimated: number;
  totalActual: number;
  conversionRate: number;
  avgDealValue: number;
};

type RevenueRecord = {
  id: string;
  callId: string;
  estimatedRevenue?: number;
  actualRevenue?: number;
  revenueType?: string;
  conversionStatus: string;
  callFileName?: string;
  callCategory?: string;
  employeeName?: string;
  callDate?: string;
};

type EmployeeRevenue = {
  employeeId: string;
  employeeName: string;
  totalEstimated: number;
  totalActual: number;
  callCount: number;
  converted: number;
};

type RevenueTrend = {
  weekStart: string;
  estimated: number;
  actual: number;
  count: number;
  converted: number;
};

const conversionColors: Record<string, string> = {
  converted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  lost: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  unknown: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function RevenuePage() {
  const { data: metrics } = useQuery<RevenueMetrics>({
    queryKey: ["/api/revenue/metrics"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: records = [] } = useQuery<RevenueRecord[]>({
    queryKey: ["/api/revenue"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: byEmployee = [] } = useQuery<EmployeeRevenue[]>({
    queryKey: ["/api/revenue/by-employee"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: trend = [] } = useQuery<RevenueTrend[]>({
    queryKey: ["/api/revenue/trend"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <RiMoneyDollarCircleLine className="w-6 h-6 text-green-600" />
          Revenue Tracking
        </h1>
        <p className="text-muted-foreground">Track call conversion and revenue impact</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Estimated Revenue</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {metrics ? formatCurrency(metrics.totalEstimated) : "$0"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">From all tracked calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Actual Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {metrics ? formatCurrency(metrics.totalActual) : "$0"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Confirmed collections</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Conversion Rate</CardDescription>
            <CardTitle className="text-2xl">
              {metrics ? `${(metrics.conversionRate * 100).toFixed(1)}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Of tracked calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Deal Value</CardDescription>
            <CardTitle className="text-2xl">
              {metrics ? formatCurrency(metrics.avgDealValue) : "$0"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Per converted call</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      {trend.some(w => w.count > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <RiArrowRightUpLine className="w-5 h-5" style={{ color: "hsl(var(--brand-from))" }} />
              Revenue Trend — Last 12 Weeks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={trend.map(w => ({
                ...w,
                label: new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 8 }}
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                />
                <Legend />
                <Bar dataKey="estimated" name="Estimated" fill="hsl(var(--brand-from))" opacity={0.4} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="calls">
        <TabsList>
          <TabsTrigger value="calls">By Call</TabsTrigger>
          <TabsTrigger value="employees">By Employee</TabsTrigger>
        </TabsList>

        <TabsContent value="calls" className="space-y-3">
          {records.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No revenue data yet. Revenue tracking is added when managers tag calls with conversion outcomes.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Call</th>
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Estimated</th>
                        <th className="pb-2 font-medium">Actual</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map(r => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2">{r.callFileName || r.callId.slice(0, 8)}</td>
                          <td className="py-2">{r.employeeName || "—"}</td>
                          <td className="py-2">{r.estimatedRevenue != null ? formatCurrency(r.estimatedRevenue) : "—"}</td>
                          <td className="py-2 font-medium">{r.actualRevenue != null ? formatCurrency(r.actualRevenue) : "—"}</td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${conversionColors[r.conversionStatus]}`}>
                              {r.conversionStatus}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {r.callDate ? new Date(r.callDate).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="employees" className="space-y-3">
          {byEmployee.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No employee revenue data yet.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {byEmployee.map(emp => (
                    <div key={emp.employeeId} className="flex items-center gap-4 p-3 rounded-lg border">
                      <div className="flex-1">
                        <p className="font-medium">{emp.employeeName}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{emp.callCount} calls tracked</span>
                          <span>{emp.converted} converted</span>
                          <span>
                            {emp.callCount > 0 ? `${((emp.converted / emp.callCount) * 100).toFixed(0)}%` : "—"} rate
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-600">{formatCurrency(emp.totalActual)}</p>
                        <p className="text-xs text-muted-foreground">
                          Est. {formatCurrency(emp.totalEstimated)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
