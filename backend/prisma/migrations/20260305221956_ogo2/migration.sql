/*
  Warnings:

  - A unique constraint covering the columns `[userId,sessionId]` on the table `GameResult` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "GameResult_userId_sessionId_key" ON "GameResult"("userId", "sessionId");
