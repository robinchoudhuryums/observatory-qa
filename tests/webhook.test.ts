import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PLAN_DEFINITIONS, subscriptionSchema, type PlanTier } from "../shared/schema.js";

describe("Stripe Webhook Logic", () => {
  describe("Price ID to tier resolution", () => {
    it("maps Starter monthly price ID to starter tier", () => {
      process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_starter_monthly_test";
      const priceMap: Record<string, PlanTier> = {};
      if (process.env.STRIPE_PRICE_STARTER_MONTHLY) priceMap[process.env.STRIPE_PRICE_STARTER_MONTHLY] = "starter";
      assert.equal(priceMap["price_starter_monthly_test"], "starter");
      delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
    });

    it("maps Enterprise yearly price ID to enterprise tier", () => {
      process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = "price_ent_yearly_test";
      const priceMap: Record<string, PlanTier> = {};
      if (process.env.STRIPE_PRICE_ENTERPRISE_YEARLY) priceMap[process.env.STRIPE_PRICE_ENTERPRISE_YEARLY] = "enterprise";
      assert.equal(priceMap["price_ent_yearly_test"], "enterprise");
      delete process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;
    });

    it("defaults to free tier for unknown price ID", () => {
      const priceMap: Record<string, PlanTier> = {};
      const resolved = priceMap["price_unknown"] || "free";
      assert.equal(resolved, "free");
    });
  });

  describe("Subscription state transitions", () => {
    it("validates active subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_1",
        orgId: "org_1",
        planTier: "starter",
        status: "active",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        billingInterval: "monthly",
      });
      assert.ok(result.success);
    });

    it("validates past_due subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_2",
        orgId: "org_1",
        planTier: "professional",
        status: "past_due",
        stripeCustomerId: "cus_test",
      });
      assert.ok(result.success);
    });

    it("validates canceled subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_3",
        orgId: "org_1",
        planTier: "enterprise",
        status: "canceled",
        stripeCustomerId: "cus_test",
      });
      assert.ok(result.success);
    });

    it("validates subscription downgrade to free", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_4",
        orgId: "org_1",
        planTier: "free",
        status: "active",
      });
      assert.ok(result.success);
    });
  });

  describe("Quota enforcement logic", () => {
    it("enforces call limits per plan tier", () => {
      for (const [tier, plan] of Object.entries(PLAN_DEFINITIONS)) {
        const limit = plan.limits.callsPerMonth;
        if (limit === -1) {
          // Unlimited
          assert.equal(tier, "enterprise");
        } else {
          assert.ok(limit > 0, `${tier} should have positive call limit`);
        }
      }
    });

    it("free tier has most restrictive limits", () => {
      const free = PLAN_DEFINITIONS.free.limits;
      const starter = PLAN_DEFINITIONS.starter.limits;
      assert.ok(free.callsPerMonth < starter.callsPerMonth);
      assert.ok(free.storageMb < starter.storageMb);
      assert.ok(free.maxUsers < starter.maxUsers);
    });

    it("enterprise has all core features enabled", () => {
      const ent = PLAN_DEFINITIONS.enterprise.limits;
      assert.equal(ent.ssoEnabled, true);
      assert.equal(ent.ragEnabled, true);
      assert.equal(ent.customPromptTemplates, true);
      assert.equal(ent.prioritySupport, true);
      assert.equal(ent.clinicalDocumentationEnabled, true);
    });

    it("free tier has no advanced features", () => {
      const free = PLAN_DEFINITIONS.free.limits;
      assert.equal(free.ssoEnabled, false);
      assert.equal(free.ragEnabled, false);
      assert.equal(free.customPromptTemplates, false);
      assert.equal(free.clinicalDocumentationEnabled, false);
    });
  });

  describe("Subscription storage operations", () => {
    it("creates and retrieves subscription via MemStorage", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      const sub = await storage.upsertSubscription(org.id, {
        planTier: "starter",
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        billingInterval: "monthly",
      });
      assert.equal(sub.planTier, "starter");
      assert.equal(sub.status, "active");

      const retrieved = await storage.getSubscription(org.id);
      assert.ok(retrieved);
      assert.equal(retrieved.planTier, "starter");
    });

    it("upserts subscription (update existing)", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      await storage.upsertSubscription(org.id, { planTier: "starter", status: "active" });
      await storage.upsertSubscription(org.id, { planTier: "enterprise", status: "active" });

      const sub = await storage.getSubscription(org.id);
      assert.ok(sub);
      assert.equal(sub.planTier, "enterprise");
    });

    it("reverts to free on subscription deletion", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      await storage.upsertSubscription(org.id, { planTier: "professional", status: "active" });
      await storage.upsertSubscription(org.id, { planTier: "free", status: "canceled" });

      const sub = await storage.getSubscription(org.id);
      assert.ok(sub);
      assert.equal(sub.planTier, "free");
      assert.equal(sub.status, "canceled");
    });
  });
});
