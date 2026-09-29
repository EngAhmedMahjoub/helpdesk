-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "ReplyDraft" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplyDraft_ticketId_idx" ON "ReplyDraft"("ticketId");

-- CreateIndex
CREATE INDEX "ReplyDraft_reviewedById_idx" ON "ReplyDraft"("reviewedById");

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
