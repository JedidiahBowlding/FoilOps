CREATE TABLE "LiquidityAutoBuyControl" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "changedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiquidityAutoBuyControl_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LiquidityAutoBuyControl" ("id", "enabled", "changedBy", "updatedAt")
VALUES ('global', false, 'migration-safe-default', CURRENT_TIMESTAMP);
