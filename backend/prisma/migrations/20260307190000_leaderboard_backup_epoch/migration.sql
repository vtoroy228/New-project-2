-- CreateTable
CREATE TABLE "LeaderboardState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "epochStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latestBackupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardBackup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByTelegramId" BIGINT,
    "confirmationMaxScore" INTEGER,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "usersCount" INTEGER NOT NULL DEFAULT 0,
    "previousEpochStart" TIMESTAMP(3) NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "restoredByTelegramId" BIGINT,

    CONSTRAINT "LeaderboardBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardBackupEntry" (
    "id" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "bestScore" INTEGER NOT NULL,

    CONSTRAINT "LeaderboardBackupEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderboardBackup_createdAt_idx" ON "LeaderboardBackup"("createdAt");

-- CreateIndex
CREATE INDEX "LeaderboardBackupEntry_backupId_idx" ON "LeaderboardBackupEntry"("backupId");

-- CreateIndex
CREATE INDEX "LeaderboardBackupEntry_userId_idx" ON "LeaderboardBackupEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardBackupEntry_backupId_userId_key" ON "LeaderboardBackupEntry"("backupId", "userId");

-- AddForeignKey
ALTER TABLE "LeaderboardBackupEntry" ADD CONSTRAINT "LeaderboardBackupEntry_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "LeaderboardBackup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
