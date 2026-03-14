import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AudioWaveform, BarChart3, Shield, Users, TrendingUp,
  Mic, Brain, FileText, Zap, ArrowRight,
} from "lucide-react";

interface LandingPageProps {
  onNavigate: (view: "login" | "register") => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
              <AudioWaveform className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl text-foreground">Observatory</span>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => onNavigate("login")}>Sign In</Button>
            <Button onClick={() => onNavigate("register")}>Get Started</Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="max-w-6xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Shield className="w-4 h-4" />
            HIPAA-Compliant
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 leading-tight">
            AI-Powered Call Quality Analysis
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Automatically transcribe, analyze, and score every customer call.
            Get actionable coaching insights, compliance monitoring, and performance
            tracking — all in one platform.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={() => onNavigate("register")}>
              Start Free Trial
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => onNavigate("login")}>
              Sign In
            </Button>
          </div>
        </section>

        {/* Features Grid */}
        <section className="max-w-6xl mx-auto px-6 pb-20">
          <h2 className="text-2xl font-bold text-center text-foreground mb-10">
            Everything you need for call quality management
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Mic,
                title: "Auto Transcription",
                description: "Upload call recordings and get accurate transcripts powered by AssemblyAI in minutes.",
              },
              {
                icon: Brain,
                title: "AI Analysis",
                description: "Claude analyzes every call for sentiment, compliance, performance scores, and coaching opportunities.",
              },
              {
                icon: BarChart3,
                title: "Performance Dashboards",
                description: "Real-time metrics, trend analysis, and team performance tracking with interactive charts.",
              },
              {
                icon: Shield,
                title: "Compliance Monitoring",
                description: "Custom evaluation criteria, required phrase detection, and automated compliance flagging.",
              },
              {
                icon: Users,
                title: "Team Management",
                description: "Employee profiles, coaching sessions, action plans, and performance comparison reports.",
              },
              {
                icon: TrendingUp,
                title: "Actionable Insights",
                description: "AI-generated coaching suggestions, trend detection, and agent-specific improvement plans.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="border-border hover:border-primary/30 transition-colors">
                <CardContent className="pt-6">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="bg-muted/50 border-y border-border py-16">
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-center text-foreground mb-10">How it works</h2>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { step: "1", icon: Mic, title: "Upload", desc: "Upload call recordings in any audio format" },
                { step: "2", icon: FileText, title: "Transcribe", desc: "Automatic transcription with speaker detection" },
                { step: "3", icon: Brain, title: "Analyze", desc: "AI scores performance, compliance, and sentiment" },
                { step: "4", icon: Zap, title: "Act", desc: "Get coaching insights and track improvements" },
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center mx-auto mb-3">
                    {item.step}
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Ready to improve your team's call quality?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Set up your organization in under 2 minutes. No credit card required for the free trial.
          </p>
          <Button size="lg" onClick={() => onNavigate("register")}>
            Create Your Organization
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-muted-foreground">
          HIPAA-compliant call analysis platform. Your data is encrypted and secure.
        </div>
      </footer>
    </div>
  );
}
