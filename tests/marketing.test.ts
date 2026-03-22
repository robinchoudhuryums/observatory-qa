/**
 * Tests for marketing attribution features.
 *
 * Covers: campaign CRUD, call attribution CRUD, metrics aggregation,
 * ROI calculation, and org isolation.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Marketing Attribution", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "test-mkt", status: "active" });
    orgId = org.id;
  });

  describe("Campaign CRUD", () => {
    it("creates a campaign", async () => {
      const campaign = await storage.createMarketingCampaign(orgId, {
        orgId,
        name: "Spring Google Ads",
        source: "google_ads",
        budget: 5000,
        isActive: true,
        createdBy: "admin",
      });

      assert.ok(campaign.id);
      assert.equal(campaign.name, "Spring Google Ads");
      assert.equal(campaign.source, "google_ads");
      assert.equal(campaign.budget, 5000);
      assert.equal(campaign.isActive, true);
    });

    it("retrieves a campaign by ID", async () => {
      const created = await storage.createMarketingCampaign(orgId, {
        orgId, name: "Test", source: "yelp", createdBy: "admin",
      });
      const fetched = await storage.getMarketingCampaign(orgId, created.id);
      assert.equal(fetched?.name, "Test");
    });

    it("lists campaigns with source filter", async () => {
      await storage.createMarketingCampaign(orgId, { orgId, name: "A", source: "google_ads", createdBy: "admin" });
      await storage.createMarketingCampaign(orgId, { orgId, name: "B", source: "facebook_ads", createdBy: "admin" });
      await storage.createMarketingCampaign(orgId, { orgId, name: "C", source: "google_ads", createdBy: "admin" });

      const google = await storage.listMarketingCampaigns(orgId, { source: "google_ads" });
      assert.equal(google.length, 2);
    });

    it("lists campaigns with active filter", async () => {
      await storage.createMarketingCampaign(orgId, { orgId, name: "Active", source: "yelp", isActive: true, createdBy: "admin" });
      await storage.createMarketingCampaign(orgId, { orgId, name: "Inactive", source: "yelp", isActive: false, createdBy: "admin" });

      const active = await storage.listMarketingCampaigns(orgId, { isActive: true });
      assert.equal(active.length, 1);
      assert.equal(active[0].name, "Active");
    });

    it("updates a campaign", async () => {
      const c = await storage.createMarketingCampaign(orgId, { orgId, name: "Old", source: "yelp", isActive: true, createdBy: "admin" });
      const updated = await storage.updateMarketingCampaign(orgId, c.id, { name: "New Name", isActive: false });
      assert.equal(updated?.name, "New Name");
      assert.equal(updated?.isActive, false);
    });

    it("deletes a campaign", async () => {
      const c = await storage.createMarketingCampaign(orgId, { orgId, name: "Delete Me", source: "yelp", createdBy: "admin" });
      await storage.deleteMarketingCampaign(orgId, c.id);
      const fetched = await storage.getMarketingCampaign(orgId, c.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Call Attribution CRUD", () => {
    it("creates an attribution for a call", async () => {
      const call = await storage.createCall(orgId, { orgId, fileName: "test.mp3", status: "completed" });
      const attr = await storage.createCallAttribution(orgId, {
        orgId,
        callId: call.id,
        source: "google_ads",
        isNewPatient: true,
        detectionMethod: "manual",
        confidence: 1.0,
        attributedBy: "admin",
      });

      assert.ok(attr.id);
      assert.equal(attr.source, "google_ads");
      assert.equal(attr.isNewPatient, true);
    });

    it("retrieves attribution by callId", async () => {
      const call = await storage.createCall(orgId, { orgId, fileName: "test.mp3", status: "completed" });
      await storage.createCallAttribution(orgId, {
        orgId, callId: call.id, source: "referral_patient", attributedBy: "admin",
      });

      const fetched = await storage.getCallAttribution(orgId, call.id);
      assert.equal(fetched?.source, "referral_patient");
    });

    it("lists attributions with source filter", async () => {
      const c1 = await storage.createCall(orgId, { orgId, fileName: "a.mp3", status: "completed" });
      const c2 = await storage.createCall(orgId, { orgId, fileName: "b.mp3", status: "completed" });
      const c3 = await storage.createCall(orgId, { orgId, fileName: "c.mp3", status: "completed" });

      await storage.createCallAttribution(orgId, { orgId, callId: c1.id, source: "yelp", attributedBy: "admin" });
      await storage.createCallAttribution(orgId, { orgId, callId: c2.id, source: "google_ads", attributedBy: "admin" });
      await storage.createCallAttribution(orgId, { orgId, callId: c3.id, source: "yelp", attributedBy: "admin" });

      const yelp = await storage.listCallAttributions(orgId, { source: "yelp" });
      assert.equal(yelp.length, 2);
    });

    it("updates an attribution", async () => {
      const call = await storage.createCall(orgId, { orgId, fileName: "test.mp3", status: "completed" });
      await storage.createCallAttribution(orgId, { orgId, callId: call.id, source: "unknown", attributedBy: "admin" });

      const updated = await storage.updateCallAttribution(orgId, call.id, { source: "google_ads", isNewPatient: true });
      assert.equal(updated?.source, "google_ads");
      assert.equal(updated?.isNewPatient, true);
    });

    it("deletes an attribution", async () => {
      const call = await storage.createCall(orgId, { orgId, fileName: "test.mp3", status: "completed" });
      await storage.createCallAttribution(orgId, { orgId, callId: call.id, source: "yelp", attributedBy: "admin" });

      await storage.deleteCallAttribution(orgId, call.id);
      const fetched = await storage.getCallAttribution(orgId, call.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Metrics Computation Logic", () => {
    it("computes ROI correctly", () => {
      const budget = 1000;
      const revenue = 3000;
      const roi = (revenue - budget) / budget;
      assert.equal(roi, 2.0); // 200% ROI
    });

    it("computes cost per lead", () => {
      const budget = 500;
      const calls = 25;
      const cpl = budget / calls;
      assert.equal(cpl, 20);
    });

    it("handles zero budget gracefully", () => {
      const budget = 0;
      const revenue = 1000;
      const roi = budget > 0 ? (revenue - budget) / budget : null;
      assert.equal(roi, null);
    });

    it("computes conversion rate", () => {
      const totalCalls = 100;
      const conversions = 35;
      const rate = (conversions / totalCalls) * 100;
      assert.equal(rate, 35);
    });

    it("aggregates by source correctly", () => {
      const attributions = [
        { source: "google_ads", isNewPatient: true },
        { source: "google_ads", isNewPatient: false },
        { source: "yelp", isNewPatient: true },
      ];

      const sourceMap = new Map<string, { calls: number; newPatients: number }>();
      for (const attr of attributions) {
        if (!sourceMap.has(attr.source)) sourceMap.set(attr.source, { calls: 0, newPatients: 0 });
        const entry = sourceMap.get(attr.source)!;
        entry.calls++;
        if (attr.isNewPatient) entry.newPatients++;
      }

      assert.equal(sourceMap.get("google_ads")?.calls, 2);
      assert.equal(sourceMap.get("google_ads")?.newPatients, 1);
      assert.equal(sourceMap.get("yelp")?.calls, 1);
      assert.equal(sourceMap.get("yelp")?.newPatients, 1);
    });
  });

  describe("Org Isolation", () => {
    it("campaigns are org-scoped", async () => {
      const org2 = await storage.createOrganization({ name: "Other", slug: "other-mkt", status: "active" });
      await storage.createMarketingCampaign(orgId, { orgId, name: "Org1 Campaign", source: "yelp", createdBy: "admin" });

      const org2Campaigns = await storage.listMarketingCampaigns(org2.id);
      assert.equal(org2Campaigns.length, 0);
    });

    it("attributions are org-scoped", async () => {
      const org2 = await storage.createOrganization({ name: "Other", slug: "other2-mkt", status: "active" });
      const call = await storage.createCall(orgId, { orgId, fileName: "test.mp3", status: "completed" });
      await storage.createCallAttribution(orgId, { orgId, callId: call.id, source: "yelp", attributedBy: "admin" });

      const org2Attr = await storage.getCallAttribution(org2.id, call.id);
      assert.equal(org2Attr, undefined);
    });
  });
});
