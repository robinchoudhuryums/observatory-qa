import { adminTest as test, expect } from "./fixtures";

test.describe("Transcripts page", () => {
  test("list mode renders the orrery CallList", async ({ page }) => {
    await page.goto("/transcripts");
    await expect(page.locator("[data-testid='transcripts-page']")).toBeVisible({ timeout: 15000 });
    // Either the call list or an empty state should be visible.
    const list = page.locator("[data-testid='call-list']");
    const empty = page.locator("text=No calls in this org yet");
    await expect(list.or(empty)).toBeVisible({ timeout: 15000 });
  });

  test("detail mode falls through cleanly on a missing call id", async ({ page }) => {
    await page.goto("/transcripts/does-not-exist");
    await expect(page.locator("[data-testid='transcript-detail-page']")).toBeVisible({ timeout: 15000 });
    // TranscriptViewer renders its own "Call not found" state.
  });
});
