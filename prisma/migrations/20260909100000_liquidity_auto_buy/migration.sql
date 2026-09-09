CREATE TYPE "LiquidityAutoBuyState" AS ENUM ('DRAFT', 'ARMED', 'MONITORING', 'LIQUIDITY_DETECTED', 'VALIDATING', 'EXECUTING', 'CONFIRMED', 'FAILED', 'CANCELLED');

CREATE TABLE "LiquidityAutoBuyOrder" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL DEFAULT 8453,
  "tokenAddress" TEXT NOT NULL,
  "sellToken" TEXT NOT NULL,
  "spendAmount" TEXT NOT NULL,
  "maxSlippageBps" INTEGER NOT NULL,
  "maxPriceImpactBps" INTEGER NOT NULL,
  "maxGasCostWei" TEXT NOT NULL,
  "minPoolLiquidityUsd" DOUBLE PRECISION NOT NULL,
  "transactionDeadlineSecs" INTEGER NOT NULL,
  "retryLimit" INTEGER NOT NULL,
  "permittedRouters" TEXT[],
  "autoBuyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "state" "LiquidityAutoBuyState" NOT NULL DEFAULT 'DRAFT',
  "idempotencyKey" TEXT NOT NULL,
  "armedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "monitorAttempts" INTEGER NOT NULL DEFAULT 0,
  "executionAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastReason" TEXT,
  "poolAddress" TEXT,
  "poolRouter" TEXT,
  "currentLiquidityUsd" DOUBLE PRECISION,
  "expectedOutput" TEXT,
  "estimatedPriceImpactBps" INTEGER,
  "transactionHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiquidityAutoBuyOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiquidityAutoBuyAudit" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidityAutoBuyAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiquidityAutoBuyOrder_idempotencyKey_key" ON "LiquidityAutoBuyOrder"("idempotencyKey");
CREATE UNIQUE INDEX "LiquidityAutoBuyOrder_transactionHash_key" ON "LiquidityAutoBuyOrder"("transactionHash");
CREATE INDEX "LiquidityAutoBuyOrder_state_idx" ON "LiquidityAutoBuyOrder"("state");
CREATE INDEX "LiquidityAutoBuyOrder_tokenAddress_idx" ON "LiquidityAutoBuyOrder"("tokenAddress");
CREATE INDEX "LiquidityAutoBuyOrder_createdAt_idx" ON "LiquidityAutoBuyOrder"("createdAt");
CREATE INDEX "LiquidityAutoBuyAudit_orderId_createdAt_idx" ON "LiquidityAutoBuyAudit"("orderId", "createdAt");
ALTER TABLE "LiquidityAutoBuyAudit" ADD CONSTRAINT "LiquidityAutoBuyAudit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LiquidityAutoBuyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
