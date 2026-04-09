-- CreateEnum
CREATE TYPE "ScamSource" AS ENUM ('CURATED_DB', 'MANUAL', 'DETECTED');

-- CreateEnum
CREATE TYPE "ScamEventType" AS ENUM ('SUSPICIOUS_TOKEN_LAUNCH', 'MANUAL_FLAG', 'MANUAL_UNFLAG');

-- CreateTable
CREATE TABLE "ScamWallet" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isFlagged" BOOLEAN NOT NULL DEFAULT true,
    "source" "ScamSource" NOT NULL DEFAULT 'CURATED_DB',
    "reason" TEXT NOT NULL,
    "priorTokenMints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "baseRiskScore" INTEGER NOT NULL DEFAULT 50,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScamWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScamWalletEvent" (
    "id" TEXT NOT NULL,
    "scamWalletId" TEXT NOT NULL,
    "eventType" "ScamEventType" NOT NULL,
    "txSignature" TEXT,
    "tokenMint" TEXT,
    "platform" TEXT,
    "riskScoreSnapshot" INTEGER NOT NULL,
    "details" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScamWalletEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScamWallet_walletId_key" ON "ScamWallet"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "ScamWallet_address_key" ON "ScamWallet"("address");

-- CreateIndex
CREATE INDEX "ScamWallet_isFlagged_idx" ON "ScamWallet"("isFlagged");

-- CreateIndex
CREATE INDEX "ScamWallet_baseRiskScore_idx" ON "ScamWallet"("baseRiskScore");

-- CreateIndex
CREATE INDEX "ScamWalletEvent_scamWalletId_idx" ON "ScamWalletEvent"("scamWalletId");

-- CreateIndex
CREATE INDEX "ScamWalletEvent_eventType_idx" ON "ScamWalletEvent"("eventType");

-- CreateIndex
CREATE INDEX "ScamWalletEvent_createdAt_idx" ON "ScamWalletEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScamWalletEvent_scamWalletId_txSignature_eventType_key" ON "ScamWalletEvent"("scamWalletId", "txSignature", "eventType");

-- AddForeignKey
ALTER TABLE "ScamWallet" ADD CONSTRAINT "ScamWallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScamWalletEvent" ADD CONSTRAINT "ScamWalletEvent_scamWalletId_fkey" FOREIGN KEY ("scamWalletId") REFERENCES "ScamWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
