-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('general', 'technical', 'refund');

-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('refund_approval', 'ai_failed');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" SERIAL NOT NULL,
    "subject" TEXT NOT NULL,
    "studentEmail" TEXT NOT NULL,
    "studentName" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "category" "TicketCategory",
    "summary" TEXT,
    "needsAgent" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" "EscalationReason",
    "autoCloseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);
