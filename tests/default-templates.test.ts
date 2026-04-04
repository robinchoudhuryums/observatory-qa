/**
 * Default industry template seeding tests ��� verifies that prompt templates
 * are correctly loaded from JSON files and seeded for each industry type.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import { join } from "path";

const INDUSTRIES = ["general", "medical", "dental", "behavioral_health", "veterinary"];

describe("Default industry templates", () => {
  for (const industry of INDUSTRIES) {
    describe(`${industry} templates`, () => {
      let templates: Array<{
        callCategory: string;
        name: string;
        evaluationCriteria: string;
        requiredPhrases?: Array<{ phrase: string; label: string; severity: string }>;
        scoringWeights?: { compliance: number; customerExperience: number; communication: number; resolution: number };
        additionalInstructions?: string;
      }>;

      it(`loads ${industry}/default-prompt-templates.json successfully`, async () => {
        const templatesPath = join(process.cwd(), "data", industry, "default-prompt-templates.json");
        const raw = await readFile(templatesPath, "utf-8");
        templates = JSON.parse(raw);
        assert.ok(Array.isArray(templates), "Templates should be an array");
        assert.ok(templates.length >= 1, `${industry} should have at least 1 template`);
      });

      it("each template has required fields", async () => {
        const templatesPath = join(process.cwd(), "data", industry, "default-prompt-templates.json");
        const raw = await readFile(templatesPath, "utf-8");
        templates = JSON.parse(raw);

        for (const tmpl of templates) {
          assert.ok(tmpl.callCategory, `Template missing callCategory: ${JSON.stringify(tmpl).slice(0, 100)}`);
          assert.ok(tmpl.name, `Template missing name: ${tmpl.callCategory}`);
          assert.ok(
            tmpl.evaluationCriteria && tmpl.evaluationCriteria.length >= 50,
            `Template ${tmpl.callCategory} has insufficient evaluationCriteria (${tmpl.evaluationCriteria?.length || 0} chars)`,
          );
        }
      });

      it("each template has valid scoring weights summing to 100", async () => {
        const templatesPath = join(process.cwd(), "data", industry, "default-prompt-templates.json");
        const raw = await readFile(templatesPath, "utf-8");
        templates = JSON.parse(raw);

        for (const tmpl of templates) {
          if (tmpl.scoringWeights) {
            const { compliance, customerExperience, communication, resolution } = tmpl.scoringWeights;
            const total = compliance + customerExperience + communication + resolution;
            assert.equal(total, 100, `${tmpl.callCategory} scoring weights sum to ${total}, expected 100`);
            assert.ok(compliance >= 0 && compliance <= 100, `${tmpl.callCategory} compliance weight out of range`);
            assert.ok(customerExperience >= 0 && customerExperience <= 100, `${tmpl.callCategory} customerExperience weight out of range`);
            assert.ok(communication >= 0 && communication <= 100, `${tmpl.callCategory} communication weight out of range`);
            assert.ok(resolution >= 0 && resolution <= 100, `${tmpl.callCategory} resolution weight out of range`);
          }
        }
      });

      it("required phrases have valid severity values", async () => {
        const templatesPath = join(process.cwd(), "data", industry, "default-prompt-templates.json");
        const raw = await readFile(templatesPath, "utf-8");
        templates = JSON.parse(raw);

        for (const tmpl of templates) {
          if (tmpl.requiredPhrases) {
            for (const phrase of tmpl.requiredPhrases) {
              assert.ok(phrase.phrase, `Empty phrase in ${tmpl.callCategory}`);
              assert.ok(phrase.label, `Empty label in ${tmpl.callCategory}`);
              assert.ok(
                ["required", "recommended"].includes(phrase.severity),
                `Invalid severity "${phrase.severity}" in ${tmpl.callCategory}`,
              );
            }
          }
        }
      });

      it("has no duplicate call categories", async () => {
        const templatesPath = join(process.cwd(), "data", industry, "default-prompt-templates.json");
        const raw = await readFile(templatesPath, "utf-8");
        templates = JSON.parse(raw);

        const categories = templates.map((t) => t.callCategory);
        const uniqueCategories = new Set(categories);
        assert.equal(categories.length, uniqueCategories.size, `${industry} has duplicate call categories: ${categories.join(", ")}`);
      });
    });
  }

  describe("Template seeding in MemStorage", () => {
    it("creates templates with isDefault=true", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "trial" });

      const templatesPath = join(process.cwd(), "data", "general", "default-prompt-templates.json");
      const raw = await readFile(templatesPath, "utf-8");
      const templates = JSON.parse(raw);

      for (const tmpl of templates) {
        await storage.createPromptTemplate(org.id, {
          orgId: org.id,
          callCategory: tmpl.callCategory,
          name: tmpl.name,
          evaluationCriteria: tmpl.evaluationCriteria,
          requiredPhrases: tmpl.requiredPhrases,
          scoringWeights: tmpl.scoringWeights,
          additionalInstructions: tmpl.additionalInstructions || undefined,
          isActive: true,
          isDefault: true,
        });
      }

      const allTemplates = await storage.getAllPromptTemplates(org.id);
      assert.equal(allTemplates.length, templates.length, "Should have seeded all templates");
      for (const t of allTemplates) {
        assert.equal(t.isDefault, true, `Template ${t.callCategory} should have isDefault=true`);
        assert.equal(t.isActive, true, `Template ${t.callCategory} should be active`);
      }
    });

    it("templates are org-isolated", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org1 = await storage.createOrganization({ name: "Org1", slug: "org1", status: "trial" });
      const org2 = await storage.createOrganization({ name: "Org2", slug: "org2", status: "trial" });

      await storage.createPromptTemplate(org1.id, {
        orgId: org1.id,
        callCategory: "inbound",
        name: "Org1 Template",
        evaluationCriteria: "Test criteria for org 1 that is sufficiently long to pass validation",
        isActive: true,
        isDefault: true,
      });

      const org1Templates = await storage.getAllPromptTemplates(org1.id);
      const org2Templates = await storage.getAllPromptTemplates(org2.id);

      assert.equal(org1Templates.length, 1, "Org1 should have 1 template");
      assert.equal(org2Templates.length, 0, "Org2 should have 0 templates");
    });

    it("getPromptTemplateByCategory returns active template", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "trial" });

      await storage.createPromptTemplate(org.id, {
        orgId: org.id,
        callCategory: "inbound",
        name: "Inbound Template",
        evaluationCriteria: "Test criteria for inbound calls with sufficient length to pass validation checks",
        isActive: true,
        isDefault: true,
      });

      const template = await storage.getPromptTemplateByCategory(org.id, "inbound");
      assert.ok(template, "Should find template by category");
      assert.equal(template!.callCategory, "inbound");
      assert.equal(template!.isDefault, true);
    });
  });

  describe("Template file counts by industry", () => {
    it("general has 4 templates (inbound, outbound, internal, vendor)", async () => {
      const raw = await readFile(join(process.cwd(), "data", "general", "default-prompt-templates.json"), "utf-8");
      const templates = JSON.parse(raw);
      assert.equal(templates.length, 4);
    });

    it("dental has 5 templates", async () => {
      const raw = await readFile(join(process.cwd(), "data", "dental", "default-prompt-templates.json"), "utf-8");
      const templates = JSON.parse(raw);
      assert.equal(templates.length, 5);
    });

    it("medical has 4 templates", async () => {
      const raw = await readFile(join(process.cwd(), "data", "medical", "default-prompt-templates.json"), "utf-8");
      const templates = JSON.parse(raw);
      assert.equal(templates.length, 4);
    });

    it("behavioral_health has 3 templates", async () => {
      const raw = await readFile(join(process.cwd(), "data", "behavioral_health", "default-prompt-templates.json"), "utf-8");
      const templates = JSON.parse(raw);
      assert.equal(templates.length, 3);
    });

    it("veterinary has 3 templates", async () => {
      const raw = await readFile(join(process.cwd(), "data", "veterinary", "default-prompt-templates.json"), "utf-8");
      const templates = JSON.parse(raw);
      assert.equal(templates.length, 3);
    });
  });
});
