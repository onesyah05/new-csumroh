-- AlterTable
ALTER TABLE `notification_preferences` ADD COLUMN `muted` BOOLEAN NOT NULL DEFAULT false;

-- "Lead tanpa PIC" and "belum dibalas 30 menit" are now one summary row per brand (current count).
-- Close the old per-prospect rows; they stay in history as resolved.
UPDATE `notifications`
SET `resolved_at` = CURRENT_TIMESTAMP(3), `active_key` = NULL
WHERE `type` IN ('lead.unassigned', 'reply.escalation')
  AND `entity_type` = 'prospect'
  AND `resolved_at` IS NULL;

-- Lead tanpa PIC is no longer urgent (catalog priority: action).
UPDATE `notifications` SET `priority` = 'action' WHERE `type` = 'lead.unassigned' AND `priority` = 'urgent';
