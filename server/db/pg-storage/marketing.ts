/**
 * PostgresStorage marketing domain: campaigns and call attributions.
 * Extracted from pg-storage-features.ts.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "../schema";
import { toISOString, QUERY_HARD_CAP } from "../pg-storage";
import { P, db } from "./_shared";
import type {
  MarketingCampaign,
  InsertMarketingCampaign,
  CallAttribution,
  InsertCallAttribution,
} from "@shared/schema";

type MarketingCampaignRow = typeof tables.marketingCampaigns.$inferSelect;
type CallAttributionRow = typeof tables.callAttributions.$inferSelect;

// --- Marketing Campaigns ---
P.createMarketingCampaign = async function (
  orgId: string,
  campaign: InsertMarketingCampaign,
): Promise<MarketingCampaign> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.marketingCampaigns)
    .values({
      id,
      orgId,
      name: campaign.name,
      source: campaign.source,
      medium: campaign.medium || null,
      startDate: campaign.startDate ? new Date(campaign.startDate) : null,
      endDate: campaign.endDate ? new Date(campaign.endDate) : null,
      budget: campaign.budget || null,
      trackingCode: campaign.trackingCode || null,
      isActive: campaign.isActive ?? true,
      notes: campaign.notes || null,
      createdBy: campaign.createdBy,
    })
    .returning();
  return mapCampaign(row);
};

P.getMarketingCampaign = async function (orgId: string, id: string): Promise<MarketingCampaign | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.marketingCampaigns)
    .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
  return rows[0] ? mapCampaign(rows[0]) : undefined;
};

P.listMarketingCampaigns = async function (
  orgId: string,
  filters?: { source?: string; isActive?: boolean },
): Promise<MarketingCampaign[]> {
  const conditions = [eq(tables.marketingCampaigns.orgId, orgId)];
  if (filters?.source) conditions.push(eq(tables.marketingCampaigns.source, filters.source));
  if (filters?.isActive !== undefined) conditions.push(eq(tables.marketingCampaigns.isActive, filters.isActive));
  const rows = await db(this)
    .select()
    .from(tables.marketingCampaigns)
    .where(and(...conditions));
  return rows.map((r) => mapCampaign(r));
};

P.updateMarketingCampaign = async function (
  orgId: string,
  id: string,
  updates: Partial<MarketingCampaign>,
): Promise<MarketingCampaign | undefined> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setClause.name = updates.name;
  if (updates.source !== undefined) setClause.source = updates.source;
  if (updates.medium !== undefined) setClause.medium = updates.medium;
  if (updates.budget !== undefined) setClause.budget = updates.budget;
  if (updates.isActive !== undefined) setClause.isActive = updates.isActive;
  if (updates.notes !== undefined) setClause.notes = updates.notes;
  if (updates.trackingCode !== undefined) setClause.trackingCode = updates.trackingCode;
  const rows = await db(this)
    .update(tables.marketingCampaigns)
    .set(setClause)
    .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)))
    .returning();
  return rows[0] ? mapCampaign(rows[0]) : undefined;
};

P.deleteMarketingCampaign = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.marketingCampaigns)
    .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
};

// --- Call Attribution ---
P.createCallAttribution = async function (orgId: string, attr: InsertCallAttribution): Promise<CallAttribution> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.callAttributions)
    .values({
      id,
      orgId,
      callId: attr.callId,
      source: attr.source,
      campaignId: attr.campaignId || null,
      medium: attr.medium || null,
      isNewPatient: attr.isNewPatient || null,
      referrerName: attr.referrerName || null,
      detectionMethod: attr.detectionMethod || null,
      confidence: attr.confidence || null,
      notes: attr.notes || null,
      attributedBy: attr.attributedBy || null,
    })
    .returning();
  return mapAttribution(row);
};

P.getCallAttribution = async function (orgId: string, callId: string): Promise<CallAttribution | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.callAttributions)
    .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
  return rows[0] ? mapAttribution(rows[0]) : undefined;
};

P.listCallAttributions = async function (
  orgId: string,
  filters?: { source?: string; campaignId?: string },
): Promise<CallAttribution[]> {
  const conditions = [eq(tables.callAttributions.orgId, orgId)];
  if (filters?.source) conditions.push(eq(tables.callAttributions.source, filters.source));
  if (filters?.campaignId) conditions.push(eq(tables.callAttributions.campaignId, filters.campaignId));
  const rows = await db(this)
    .select()
    .from(tables.callAttributions)
    .where(and(...conditions));
  return rows.map((r) => mapAttribution(r));
};

P.updateCallAttribution = async function (
  orgId: string,
  callId: string,
  updates: Partial<CallAttribution>,
): Promise<CallAttribution | undefined> {
  const setClause: Record<string, unknown> = {};
  if (updates.source !== undefined) setClause.source = updates.source;
  if (updates.campaignId !== undefined) setClause.campaignId = updates.campaignId;
  if (updates.isNewPatient !== undefined) setClause.isNewPatient = updates.isNewPatient;
  if (updates.referrerName !== undefined) setClause.referrerName = updates.referrerName;
  if (updates.notes !== undefined) setClause.notes = updates.notes;
  if (updates.detectionMethod !== undefined) setClause.detectionMethod = updates.detectionMethod;
  if (updates.confidence !== undefined) setClause.confidence = updates.confidence;
  if (updates.attributedBy !== undefined) setClause.attributedBy = updates.attributedBy;
  if (updates.utmSource !== undefined) setClause.utmSource = updates.utmSource;
  if (updates.utmMedium !== undefined) setClause.utmMedium = updates.utmMedium;
  if (updates.utmCampaign !== undefined) setClause.utmCampaign = updates.utmCampaign;
  if (updates.utmContent !== undefined) setClause.utmContent = updates.utmContent;
  if (updates.utmTerm !== undefined) setClause.utmTerm = updates.utmTerm;
  const rows = await db(this)
    .update(tables.callAttributions)
    .set(setClause)
    .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)))
    .returning();
  return rows[0] ? mapAttribution(rows[0]) : undefined;
};

P.deleteCallAttribution = async function (orgId: string, callId: string): Promise<void> {
  await db(this)
    .delete(tables.callAttributions)
    .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
};

function mapCampaign(r: MarketingCampaignRow): MarketingCampaign {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    source: r.source,
    medium: r.medium || undefined,
    startDate: toISOString(r.startDate),
    endDate: toISOString(r.endDate),
    budget: r.budget || undefined,
    trackingCode: r.trackingCode || undefined,
    isActive: r.isActive,
    notes: r.notes || undefined,
    createdBy: r.createdBy,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
  };
}

function mapAttribution(r: CallAttributionRow): CallAttribution {
  return {
    id: r.id,
    orgId: r.orgId,
    callId: r.callId,
    source: r.source,
    campaignId: r.campaignId || undefined,
    medium: r.medium || undefined,
    isNewPatient: r.isNewPatient || undefined,
    referrerName: r.referrerName || undefined,
    detectionMethod: (r.detectionMethod || undefined) as CallAttribution["detectionMethod"],
    confidence: r.confidence || undefined,
    notes: r.notes || undefined,
    attributedBy: r.attributedBy || undefined,
    utmSource: r.utmSource || undefined,
    utmMedium: r.utmMedium || undefined,
    utmCampaign: r.utmCampaign || undefined,
    utmContent: r.utmContent || undefined,
    utmTerm: r.utmTerm || undefined,
    createdAt: toISOString(r.createdAt),
  };
}
