-- Backfill the two org composite indexes that exist on production but were
-- never created by a migration (Agent, Template). schema.prisma declares both
-- via @@index([organizationId, id]); this closes the gap on fresh replays.
-- Idempotent: no-op on production where the indexes already exist.
CREATE INDEX IF NOT EXISTS "Agent_organizationId_id_idx" ON "Agent"("organizationId", "id");
CREATE INDEX IF NOT EXISTS "Template_organizationId_id_idx" ON "Template"("organizationId", "id");
