import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ObservatoryLogo } from "@/components/observatory-logo";
import { motion, useInView } from "framer-motion";
import {  RiBarChartBoxLine, RiShieldLine, RiTeamLine, RiArrowRightUpLine, RiMicLine, RiFileTextLine, RiFlashlightLine, RiArrowRightLine, RiArrowRightSLine, RiUploadLine, RiBrainLine  } from "@remixicon/react";

interface LandingPageProps {
  onNavigate: (view: "login" | "register") => void;
}

/** Animated flowing wave lines with traveling spark/pulse effect */
function WaveBackground() {
  const waves = Array.from({ length: 18 }, (_, i) => {
    const yBase = 150 + i * 22;
    const amplitude = 60 + Math.sin(i * 0.7) * 30;
    const phase = i * 25;
    const opacity = 0.18 + (i / 18) * 0.32;
    const hue = 170 + (i / 18) * 160; // teal → rose
    const saturation = 80 + Math.sin(i * 0.5) * 15;
    const color = `hsl(${hue}, ${saturation}%, 55%)`;
    const brightColor = `hsl(${hue}, ${Math.min(saturation + 15, 100)}%, 75%)`;

    const d = `M-100,${yBase} C200,${yBase - amplitude + phase * 0.1} 400,${yBase + amplitude - phase * 0.05} 600,${yBase} C800,${yBase - amplitude * 0.7} 1000,${yBase + amplitude * 0.5} 1200,${yBase} C1400,${yBase - amplitude * 0.3} 1600,${yBase + amplitude * 0.8} 2000,${yBase}`;

    const sparkDelay = i * 0.15;
    const sparkDuration = 3.5 + (i % 3) * 0.5;
    const gradId = `spark-${i}`;

    return (
      <g key={i}>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity={opacity * 0.6} />
          <stop offset="0%" stopColor={brightColor} stopOpacity={Math.min(opacity + 0.5, 1)}>
            <animate attributeName="offset" values="-0.15;1.15" dur={`${sparkDuration}s`} begin={`${sparkDelay}s`} repeatCount="indefinite" />
          </stop>
          <stop offset="0%" stopColor={color} stopOpacity={opacity * 0.6}>
            <animate attributeName="offset" values="-0.05;1.25" dur={`${sparkDuration}s`} begin={`${sparkDelay}s`} repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor={color} stopOpacity={opacity * 0.6} />
        </linearGradient>

        <path
          d={d}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="8"
          opacity={opacity * 0.4}
          className="wave-line-glow"
          style={{
            animationDelay: `${i * 0.3}s`,
            animationDuration: `${8 + i * 0.5}s`,
          }}
          filter="url(#wave-blur)"
        />
        <path
          d={d}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="1.5"
          opacity={1}
          className="wave-line"
          style={{
            animationDelay: `${i * 0.3}s`,
            animationDuration: `${8 + i * 0.5}s`,
          }}
        />
      </g>
    );
  });

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          <filter id="wave-blur">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {waves}
      </svg>
    </div>
  );
}

/** Glowing gradient orb for ambient lighting */
function GlowOrb({ className }: { className?: string }) {
  return (
    <div
      className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
    />
  );
}

const FEATURES = [
  {
    icon: RiMicLine,
    title: "Auto Transcription",
    description: "Upload recordings and get accurate transcripts powered by AssemblyAI in minutes.",
  },
  {
    icon: RiBrainLine,
    title: "AI Analysis",
    description: "Claude analyzes every call for sentiment, compliance, and coaching opportunities.",
  },
  {
    icon: RiBarChartBoxLine,
    title: "Performance Dashboards",
    description: "Real-time metrics, trend analysis, and team performance tracking.",
  },
  {
    icon: RiShieldLine,
    title: "Compliance Monitoring",
    description: "Custom evaluation criteria, required phrase detection, and automated flagging.",
  },
  {
    icon: RiTeamLine,
    title: "Team Coaching",
    description: "AI-generated coaching plans, review queues, and effectiveness tracking.",
  },
  {
    icon: RiArrowRightUpLine,
    title: "Proactive Insights",
    description: "Weekly digests and trend detection that surfaces issues before they escalate.",
  },
];

const STEPS = [
  { step: "1", icon: RiMicLine, title: "Upload", desc: "Upload call recordings in any audio format" },
  { step: "2", icon: RiFileTextLine, title: "Transcribe", desc: "Automatic transcription with speaker detection" },
  { step: "3", icon: RiBrainLine, title: "Analyze", desc: "AI scores performance, compliance, and sentiment" },
  { step: "4", icon: RiFlashlightLine, title: "Act", desc: "Get coaching insights and track improvements" },
];

const PLANS = [
  { name: "Free", price: "$0", period: "/mo", calls: "50 calls/mo · 2 seats", highlight: false, contactSales: false },
  { name: "Starter", price: "$79", period: "/mo", calls: "300 calls/mo · 5 seats · +$49/mo for Clinical Docs", highlight: false, contactSales: false },
  { name: "Professional", price: "$199", period: "/mo", calls: "1,000 calls/mo · 10 seats · Clinical docs included", highlight: true, contactSales: false },
  { name: "Enterprise", price: "Custom", period: "", calls: "High-volume calls · SSO · SCIM · Clinical docs · Dedicated support", highlight: false, contactSales: true },
];

/** Fade-up animation wrapper — triggers when element enters viewport */
function FadeUp({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="min-h-screen landing-page">
      {/* ── Hero Section ─────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col overflow-hidden landing-hero">
        <WaveBackground />

        {/* Ambient glow */}
        <GlowOrb className="w-96 h-96 bg-teal-500/10 dark:bg-teal-500/5 top-20 -right-20" />
        <GlowOrb className="w-80 h-80 bg-rose-500/10 dark:bg-rose-500/5 bottom-20 right-1/4" />
        <GlowOrb className="w-64 h-64 bg-blue-500/8 dark:bg-blue-500/5 top-1/3 left-10" />

        {/* Nav */}
        <header className="relative z-10 w-full">
          <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ObservatoryLogo variant="icon" height={32} hoverable className="landing-text" />
            </div>
            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm landing-text-muted hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm landing-text-muted hover:text-foreground transition-colors">How it Works</a>
              <a href="#pricing" className="text-sm landing-text-muted hover:text-foreground transition-colors">Pricing</a>
            </nav>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => onNavigate("login")}
                className="landing-text-muted hover:text-foreground"
              >
                Sign In
              </Button>
              <Button
                onClick={() => onNavigate("register")}
                className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/20"
              >
                Start Free Trial
              </Button>
            </div>
          </div>
        </header>

        {/* Hero content — brand-first composition */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto px-6 w-full">
            <div className="max-w-3xl">
              {/* Brand as hero-level signal */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <ObservatoryLogo variant="full" height={56} hoverable className="landing-text mb-8 block md:hidden" />
                <ObservatoryLogo variant="full" height={72} hoverable className="landing-text mb-8 hidden md:block" />
              </motion.div>

              <motion.h1
                className="text-3xl md:text-5xl font-bold mb-6 leading-[1.15] tracking-tight landing-text"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                Know every call.{" "}
                <span className="bg-gradient-to-r from-teal-400 via-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  Coach every rep.
                </span>
              </motion.h1>

              <motion.p
                className="text-lg landing-text-muted max-w-xl mb-10 leading-relaxed"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                AI-powered transcription, scoring, and coaching for every customer
                call — HIPAA-compliant and ready in minutes.
              </motion.p>

              <motion.div
                className="flex flex-wrap gap-4"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
              >
                <Button
                  size="lg"
                  onClick={() => onNavigate("register")}
                  className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/25 px-8 h-12 text-base"
                >
                  Start Free Trial
                  <RiArrowRightLine className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => onNavigate("login")}
                  className="landing-outline-btn h-12 text-base px-8"
                >
                  Sign In
                </Button>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          className="relative z-10 pb-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
          <div className="inline-flex flex-col items-center gap-2 landing-text-muted text-xs tracking-widest uppercase">
            <span>Scroll</span>
            <div className="w-px h-8 bg-gradient-to-b from-current to-transparent" />
          </div>
        </motion.div>
      </section>

      {/* ── Features ─────────────────────────────────── */}
      <section id="features" className="relative py-24 landing-section">
        <div className="max-w-7xl mx-auto px-6">
          <FadeUp>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Features</p>
              <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
                Everything you need for call quality
              </h2>
              <p className="landing-text-muted max-w-2xl mx-auto">
                From automated transcription to AI-powered coaching, Observatory gives your team
                the tools to deliver consistently excellent customer experiences.
              </p>
            </div>
          </FadeUp>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
            {FEATURES.map((feature, i) => (
              <FadeUp key={feature.title} delay={i * 0.07}>
                <div className="group flex gap-4 items-start">
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500/15 to-blue-500/15 dark:from-teal-500/10 dark:to-blue-500/10 flex items-center justify-center mt-0.5">
                    <feature.icon className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base landing-text mb-1">{feature.title}</h3>
                    <p className="text-sm landing-text-muted leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────── */}
      <section id="how-it-works" className="relative py-24 landing-section-alt">
        <div className="max-w-7xl mx-auto px-6">
          <FadeUp>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Process</p>
              <h2 className="text-3xl md:text-4xl font-bold landing-text">How it works</h2>
            </div>
          </FadeUp>

          <div className="grid md:grid-cols-4 gap-8">
            {STEPS.map((item, i) => (
              <FadeUp key={item.step} delay={i * 0.1}>
                <div className="relative text-center">
                  {/* Connector line */}
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-px bg-gradient-to-r from-teal-500/30 to-transparent" />
                  )}

                  <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500/10 to-blue-500/10 dark:from-teal-500/10 dark:to-blue-500/10 border border-teal-500/20 mb-4">
                    <span className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-400 bg-clip-text text-transparent">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="font-semibold landing-text mb-1">{item.title}</h3>
                  <p className="text-sm landing-text-muted">{item.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────── */}
      <section id="pricing" className="relative py-24 landing-section">
        <div className="max-w-7xl mx-auto px-6">
          <FadeUp>
            <div className="text-center mb-16">
              <p className="text-sm font-semibold text-teal-500 dark:text-teal-400 tracking-widest uppercase mb-3">Pricing</p>
              <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
                Simple, transparent pricing
              </h2>
              <p className="landing-text-muted">No credit card required. Start analyzing calls today.</p>
            </div>
          </FadeUp>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {PLANS.map((plan, i) => (
              <FadeUp key={plan.name} delay={i * 0.08}>
                <div
                  className={`relative p-8 rounded-2xl text-center transition-all duration-300 hover:-translate-y-1 ${
                    plan.highlight
                      ? "bg-gradient-to-b from-teal-500/10 to-blue-500/5 dark:from-teal-500/10 dark:to-blue-500/5 border-2 border-teal-500/30 shadow-xl shadow-teal-500/10"
                      : "landing-card"
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-teal-500 to-blue-500 text-white text-xs font-semibold rounded-full">
                      Most Popular
                    </div>
                  )}
                  <h3 className="font-semibold text-lg landing-text mb-2">{plan.name}</h3>
                  <div className="mb-4">
                    <span className="text-4xl font-bold landing-text">{plan.price}</span>
                    {plan.period && <span className="landing-text-muted">{plan.period}</span>}
                  </div>
                  <p className="text-sm landing-text-muted mb-6">{plan.calls}</p>
                  {plan.contactSales ? (
                    <Button
                      className="w-full landing-outline-btn"
                      variant="outline"
                      asChild
                    >
                      <a href="mailto:sales@observatory-qa.com">
                        Contact Sales
                        <RiArrowRightSLine className="w-4 h-4 ml-1" />
                      </a>
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${
                        plan.highlight
                          ? "bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0"
                          : "landing-outline-btn"
                      }`}
                      variant={plan.highlight ? "default" : "outline"}
                      onClick={() => onNavigate("register")}
                    >
                      {plan.highlight ? "Start Free Trial" : "Get Started"}
                      <RiArrowRightSLine className="w-4 h-4 ml-1" />
                    </Button>
                  )}
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-500/5 via-blue-500/5 to-purple-500/5 dark:from-teal-500/5 dark:via-blue-500/3 dark:to-purple-500/5" />
        <GlowOrb className="w-96 h-96 bg-teal-500/10 dark:bg-teal-500/5 -top-20 left-1/4" />
        <GlowOrb className="w-80 h-80 bg-blue-500/10 dark:bg-blue-500/5 -bottom-20 right-1/4" />

        <FadeUp>
          <div className="relative max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-3xl md:text-4xl font-bold landing-text mb-4">
              Ready to improve your team's call quality?
            </h2>
            <p className="landing-text-muted mb-10 max-w-xl mx-auto text-lg">
              Set up your organization in under 2 minutes. Start with a 14-day free trial — no credit card required.
            </p>
            <Button
              size="lg"
              onClick={() => onNavigate("register")}
              className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white border-0 shadow-lg shadow-teal-500/25 px-10 h-13 text-base"
            >
              Start Your 14-Day Free Trial
              <RiArrowRightLine className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-sm landing-text-muted mt-4">No credit card required. 14-day free trial on Starter &amp; Professional plans.</p>
          </div>
        </FadeUp>
      </section>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="py-8 landing-footer">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ObservatoryLogo variant="full" height={24} className="landing-text" />
          </div>
          <p className="text-xs landing-text-muted text-center">
            HIPAA-compliant call analysis platform. Your data is encrypted at rest and in transit.
          </p>
          <div className="flex gap-6">
            <a href="#features" className="text-xs landing-text-muted hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="text-xs landing-text-muted hover:text-foreground transition-colors">Pricing</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
