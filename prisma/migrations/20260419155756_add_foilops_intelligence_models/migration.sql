-- CreateEnum
CREATE TYPE "AlertEventType" AS ENUM ('SUSPICIOUS_TOKEN_LAUNCH', 'SUSPICIOUS_PRELAUNCH_SIGNAL', 'ANOMALY_DETECTED', 'PLATFORM_INTERACTION', 'FLOW_TO_NEW_LAUNCH', 'TOKEN_INVESTIGATION', 'CLUSTER_ALERT');

-- CreateEnum
CREATE TYPE "WalletClassification" AS ENUM ('EARLY_ENTRANT', 'MOMENTUM_WALLET', 'HIGH_RISK', 'WATCHLIST', 'IGNORE');

-- CreateEnum
CREATE TYPE "TokenClassification" AS ENUM ('SAFER_SPECULATIVE', 'WATCHLIST', 'HIGH_RISK', 'EXTREME_RISK');

-- CreateEnum
CREATE TYPE "ClusterLinkType" AS ENUM ('SHARED_FUNDER', 'CO_LAUNCH', 'SHARED_COUNTERPARTY', 'SIMILAR_EXIT_PATTERN', 'DOWNSTREAM_CONSOLIDATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScamEventType" ADD VALUE 'SUSPICIOUS_PRELAUNCH_SIGNAL';
ALTER TYPE "ScamEventType" ADD VALUE 'ANOMALY_DETECTED';
ALTER TYPE "ScamEventType" ADD VALUE 'CLUSTER_ALERT';

-- CreateTable
CREATE TABLE "WalletCluster" (
    "id" TEXT NOT NULL,
    "clusterScore" DOUBLE PRECISION NOT NULL,
    "wallets" TEXT[],
    "riskScore" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minRiskScore" INTEGER NOT NULL DEFAULT 70,
    "minTransactionSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eventTypes" "AlertEventType"[] DEFAULT ARRAY['SUSPICIOUS_TOKEN_LAUNCH', 'ANOMALY_DETECTED', 'SUSPICIOUS_PRELAUNCH_SIGNAL']::"AlertEventType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletProfileSnapshot" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "overallOpportunityScore" INTEGER NOT NULL,
    "overallRiskScore" INTEGER NOT NULL,
    "classification" "WalletClassification" NOT NULL,
    "earlyEntryScore" INTEGER NOT NULL,
    "launchParticipationScore" INTEGER NOT NULL,
    "momentumParticipationScore" INTEGER NOT NULL,
    "repeatSuccessScore" INTEGER NOT NULL,
    "exitTimingScore" INTEGER NOT NULL,
    "rugRiskScore" INTEGER NOT NULL,
    "dumpSeverityScore" INTEGER NOT NULL,
    "clusterSuspicionScore" INTEGER NOT NULL,
    "liquidityPullScore" INTEGER NOT NULL,
    "suspiciousFundingScore" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchParticipationRecord" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT,
    "entryTimestamp" BIGINT NOT NULL,
    "entryDelaySeconds" INTEGER NOT NULL,
    "exitTimestamp" BIGINT,
    "exitDelaySeconds" INTEGER,
    "gainLossPct" DOUBLE PRECISION,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchParticipationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRiskSnapshot" (
    "id" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "overallTokenRiskScore" INTEGER NOT NULL,
    "tokenClassification" "TokenClassification" NOT NULL,
    "creatorHoldPercent" DOUBLE PRECISION NOT NULL,
    "top10HolderPercent" DOUBLE PRECISION NOT NULL,
    "liquidityUsd" DOUBLE PRECISION NOT NULL,
    "liquidityRemovalPercent" DOUBLE PRECISION NOT NULL,
    "suspiciousWalletLinks" INTEGER NOT NULL,
    "walletConcentrationScore" INTEGER NOT NULL,
    "dumpPressureScore" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuspiciousEvent" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventTimestamp" BIGINT NOT NULL,
    "walletAddress" TEXT,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuspiciousEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletClusterEdge" (
    "id" TEXT NOT NULL,
    "sourceWallet" TEXT NOT NULL,
    "targetWallet" TEXT NOT NULL,
    "linkType" "ClusterLinkType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletClusterEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletCluster_riskScore_idx" ON "WalletCluster"("riskScore");

-- CreateIndex
CREATE INDEX "WalletCluster_createdAt_idx" ON "WalletCluster"("createdAt");

-- CreateIndex
CREATE INDEX "UserAlertRule_userId_idx" ON "UserAlertRule"("userId");

-- CreateIndex
CREATE INDEX "WalletProfileSnapshot_wallet_idx" ON "WalletProfileSnapshot"("wallet");

-- CreateIndex
CREATE INDEX "WalletProfileSnapshot_classification_idx" ON "WalletProfileSnapshot"("classification");

-- CreateIndex
CREATE INDEX "WalletProfileSnapshot_overallOpportunityScore_idx" ON "WalletProfileSnapshot"("overallOpportunityScore");

-- CreateIndex
CREATE INDEX "WalletProfileSnapshot_overallRiskScore_idx" ON "WalletProfileSnapshot"("overallRiskScore");

-- CreateIndex
CREATE INDEX "WalletProfileSnapshot_computedAt_idx" ON "WalletProfileSnapshot"("computedAt");

-- CreateIndex
CREATE INDEX "LaunchParticipationRecord_snapshotId_idx" ON "LaunchParticipationRecord"("snapshotId");

-- CreateIndex
CREATE INDEX "LaunchParticipationRecord_wallet_idx" ON "LaunchParticipationRecord"("wallet");

-- CreateIndex
CREATE INDEX "LaunchParticipationRecord_tokenAddress_idx" ON "LaunchParticipationRecord"("tokenAddress");

-- CreateIndex
CREATE INDEX "LaunchParticipationRecord_entryTimestamp_idx" ON "LaunchParticipationRecord"("entryTimestamp");

-- CreateIndex
CREATE INDEX "TokenRiskSnapshot_tokenAddress_idx" ON "TokenRiskSnapshot"("tokenAddress");

-- CreateIndex
CREATE INDEX "TokenRiskSnapshot_tokenClassification_idx" ON "TokenRiskSnapshot"("tokenClassification");

-- CreateIndex
CREATE INDEX "TokenRiskSnapshot_overallTokenRiskScore_idx" ON "TokenRiskSnapshot"("overallTokenRiskScore");

-- CreateIndex
CREATE INDEX "TokenRiskSnapshot_computedAt_idx" ON "TokenRiskSnapshot"("computedAt");

-- CreateIndex
CREATE INDEX "SuspiciousEvent_snapshotId_idx" ON "SuspiciousEvent"("snapshotId");

-- CreateIndex
CREATE INDEX "SuspiciousEvent_eventType_idx" ON "SuspiciousEvent"("eventType");

-- CreateIndex
CREATE INDEX "SuspiciousEvent_eventTimestamp_idx" ON "SuspiciousEvent"("eventTimestamp");

-- CreateIndex
CREATE INDEX "WalletClusterEdge_sourceWallet_idx" ON "WalletClusterEdge"("sourceWallet");

-- CreateIndex
CREATE INDEX "WalletClusterEdge_targetWallet_idx" ON "WalletClusterEdge"("targetWallet");

-- CreateIndex
CREATE INDEX "WalletClusterEdge_linkType_idx" ON "WalletClusterEdge"("linkType");

-- CreateIndex
CREATE INDEX "WalletClusterEdge_confidence_idx" ON "WalletClusterEdge"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "WalletClusterEdge_sourceWallet_targetWallet_linkType_key" ON "WalletClusterEdge"("sourceWallet", "targetWallet", "linkType");

-- AddForeignKey
ALTER TABLE "UserAlertRule" ADD CONSTRAINT "UserAlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchParticipationRecord" ADD CONSTRAINT "LaunchParticipationRecord_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WalletProfileSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspiciousEvent" ADD CONSTRAINT "SuspiciousEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TokenRiskSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
