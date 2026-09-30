-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EscalationReason" ADD VALUE 'unverified_sender';
ALTER TYPE "EscalationReason" ADD VALUE 'auto_reply_limit';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "senderVerified" BOOLEAN NOT NULL DEFAULT false;
