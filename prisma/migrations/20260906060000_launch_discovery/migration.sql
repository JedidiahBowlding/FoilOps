CREATE TABLE "LaunchIngestionCheckpoint" (
    "source" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchIngestionCheckpoint_pkey" PRIMARY KEY ("source")
);

CREATE TABLE "LaunchCandidate" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "creatorWallet" TEXT,
    "source" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LaunchCandidate_chain_tokenMint_key" ON "LaunchCandidate"("chain", "tokenMint");
CREATE UNIQUE INDEX "LaunchCandidate_source_signature_key" ON "LaunchCandidate"("source", "signature");
CREATE INDEX "LaunchCandidate_detectedAt_idx" ON "LaunchCandidate"("detectedAt");
CREATE INDEX "LaunchCandidate_opportunityScore_idx" ON "LaunchCandidate"("opportunityScore");
CREATE INDEX "LaunchCandidate_riskScore_idx" ON "LaunchCandidate"("riskScore");
CREATE INDEX "LaunchCandidate_status_idx" ON "LaunchCandidate"("status");

CREATE TABLE "LaunchCandidateObservation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaunchCandidateObservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LaunchCandidateObservation_candidateId_idx" ON "LaunchCandidateObservation"("candidateId");
CREATE INDEX "LaunchCandidateObservation_observedAt_idx" ON "LaunchCandidateObservation"("observedAt");
ALTER TABLE "LaunchCandidateObservation" ADD CONSTRAINT "LaunchCandidateObservation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LaunchCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
