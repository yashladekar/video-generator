-- Cost-effectiveness defaults: a Rs.2000/month envelope with a Rs.70 (about
-- $0.80) per-video ceiling, so 30+ reels stay inside the budget.
ALTER TABLE "UserSettings" ALTER COLUMN "monthlyBudgetInrPaise" SET DEFAULT 200000;
ALTER TABLE "UserSettings" ALTER COLUMN "maxCostPerVideoInrPaise" SET DEFAULT 7000;
ALTER TABLE "UserSettings" ALTER COLUMN "dailyLimit" SET DEFAULT 2;

-- Existing rows keep their budget intent only when they were left at the old
-- scaffolded defaults; anything the user tuned is preserved.
UPDATE "UserSettings"
SET "monthlyBudgetInrPaise" = 200000
WHERE "monthlyBudgetInrPaise" = 50000;

UPDATE "UserSettings"
SET "maxCostPerVideoInrPaise" = 7000
WHERE "maxCostPerVideoInrPaise" = 5000;
