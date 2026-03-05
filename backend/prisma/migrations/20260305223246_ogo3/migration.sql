-- CreateIndex
CREATE INDEX "User_isBanned_bestScore_updatedAt_idx" ON "User"("isBanned", "bestScore", "updatedAt");
