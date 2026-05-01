-- Add weighted allocation support for multi-active personal trading wallets
ALTER TABLE "PersonalTradingWallet"
ADD COLUMN IF NOT EXISTS "allocationWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
