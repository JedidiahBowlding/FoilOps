-- CreateTable
CREATE TABLE "PersonalTradingWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTradingWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalTradingWallet_userId_idx" ON "PersonalTradingWallet"("userId");

-- CreateIndex
CREATE INDEX "PersonalTradingWallet_userId_isActive_idx" ON "PersonalTradingWallet"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalTradingWallet_userId_publicKey_key" ON "PersonalTradingWallet"("userId", "publicKey");

-- AddForeignKey
ALTER TABLE "PersonalTradingWallet" ADD CONSTRAINT "PersonalTradingWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
