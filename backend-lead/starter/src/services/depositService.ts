import { randomUUID } from 'crypto';
import { Member, Wallet } from '../db/models';
import { FundingTransaction } from '../db/models/fundingTransaction';
import { HttpError } from '../lib/httpError';
import { dec } from '../lib/money';

export async function createDeposit(
  memberId: string,
  amount: string,
  turnoverMultiplier: number,
): Promise<{ id: string; pspRef: string; status: 'pending' }> {
  const member = await Member.findByPk(memberId);
  const wallet = member ? await Wallet.findOne({ where: { memberId } }) : null;
  if (!member || !wallet) {
    throw new HttpError(404, { error: 'member_not_found' });
  }

  const funding = await FundingTransaction.create({
    memberId,
    kind: 'deposit',
    status: 'pending',
    amount: dec(amount).toFixed(18),
    turnoverMultiplier,
    pspRef: randomUUID(),
  });

  return { id: funding.id, pspRef: funding.pspRef as string, status: 'pending' };
}
