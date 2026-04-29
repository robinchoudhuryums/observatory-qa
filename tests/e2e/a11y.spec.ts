/**
 * Accessibility audit using axe-core via @axe-core/playwright.
 *
 * Visits a small set of public + authenticated pages and asserts there are
 * no `critical` or `serious` violations against WCAG 2.1 AA + best practices.
 * `moderate` and `minor` violations are logged as console output but don't
 * fail the build — those are tracked in CLAUDE.md's UI/UX backlog and fixed
 * incrementally.
 *
 * Why critical/serious only: WCAG-AA technically gates many `moderate`
 * findings (color contrast on disabled controls, decorative icon role, etc.)
 * that often require design conversation. Failing the suite on those would
 * make the gate noisy. Critical/serious are the bugs that block users.
 *
 * Why not waitForLoadState("networkidle"): the dashboard/transcripts pages
 * fire periodic polling and websocket heartbeats that prevent the network
 * from ever idling, so `networkidle` reliably hits the 60s test timeout.
 * `domcontentloaded` plus an explicit settle delay is enough — axe runs
 * against the rendered DOM, not the network state.
 *
 * To run locally: `npm run test:e2e -- a11y.spec.ts` (requires dev server).
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { adminTest } from "./fixtures";

interface ViolationSummary {
  id: string;
  impact: string | null | undefined;
  description: string;
  helpUrl: string;
  nodeCount: number;
  exampleSelector?: string;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  // Brief settle for client-side route transitions / data fetches to render.
  await page.waitForTimeout(500);
}

async function runAxe(page: Page): Promise<ViolationSummary[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    helpUrl: v.helpUrl,
    nodeCount: v.nodes.length,
    exampleSelector: v.nodes[0]?.target?.[0]?.toString(),
  }));
}

function assertNoCriticalOrSerious(violations: ViolationSummary[], page: string): void {
  const blocking = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const moderate = violations.filter((v) => v.impact === "moderate" || v.impact === "minor");

  if (moderate.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[a11y] ${page} — ${moderate.length} moderate/minor violation(s) (not blocking):`,
      moderate.map((v) => `${v.id} (${v.impact}, ${v.nodeCount} nodes)`).join(", "),
    );
  }

  if (blocking.length > 0) {
    const detail = blocking
      .map(
        (v) =>
          `\n  • [${v.impact}] ${v.id} (${v.nodeCount} nodes): ${v.description}\n    e.g. ${v.exampleSelector}\n    ${v.helpUrl}`,
      )
      .join("");
    expect(blocking, `${page} has ${blocking.length} critical/serious a11y violation(s):${detail}`).toEqual([]);
  }
}

// ─── Public (unauthenticated) pages ─────────────────────────────────────────

test.describe("a11y — public pages", () => {
  test("landing page has no critical/serious violations", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "landing");
  });

  test("auth (login) page has no critical/serious violations", async ({ page }) => {
    await page.goto("/auth");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "auth");
  });

  test("auth registration form (toggle to register) has no critical/serious violations", async ({ page }) => {
    await page.goto("/auth");
    await settle(page);
    // Toggle to registration form. The button text varies; try common selectors.
    const registerToggle = page
      .getByRole("button", { name: /register|sign up|create.*account/i })
      .or(page.getByRole("link", { name: /register|sign up/i }));
    if (await registerToggle.first().isVisible().catch(() => false)) {
      await registerToggle.first().click();
      await page.waitForTimeout(300);
    }
    assertNoCriticalOrSerious(await runAxe(page), "auth (register tab)");
  });

  test("404 page has no critical/serious violations", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-9f7e2c");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "404");
  });
});

// ─── Authenticated pages (admin fixture) ────────────────────────────────────

adminTest.describe("a11y — authenticated pages", () => {
  adminTest("dashboard has no critical/serious violations", async ({ page }) => {
    await page.goto("/dashboard");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "dashboard");
  });

  adminTest("settings page has no critical/serious violations", async ({ page }) => {
    await page.goto("/settings");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "settings");
  });

  adminTest("transcripts page has no critical/serious violations", async ({ page }) => {
    await page.goto("/transcripts");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "transcripts");
  });

  adminTest("admin page has no critical/serious violations", async ({ page }) => {
    await page.goto("/admin");
    await settle(page);
    assertNoCriticalOrSerious(await runAxe(page), "admin");
  });
});
