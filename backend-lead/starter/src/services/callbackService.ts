import type { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { HttpError } from '../lib/httpError';
import { dec } from '../lib/money';

type CallbackOutcome = 'completed' | 'failed';

export async function applyCallback(
  pspRef: string,
  outcome: CallbackOutcome,
  amount: string,
): Promise<{ id: string; status: CallbackOutcome }> {
  return sequelize.transaction(async (t) => {
    const funding = await FundingTransaction.findOne({ where: { pspRef }, transaction: t });
    if (!funding) {
      throw new HttpError(404, { error: 'unknown_psp_ref' });
    }

    if (funding.status === outcome) {
      return { id: funding.id, status: outcome };
    }

    if (funding.status !== 'pending') {
      throw new HttpError(409, { error: 'invalid_transition' });
    }

    if (outcome === 'completed' && !dec(amount).eq(funding.amount)) {
      throw new HttpError(409, {
        error: 'amount_mismatch',
        expected: funding.amount,
        received: dec(amount).toFixed(18),
      });
    }

    const [claimed] = await FundingTransaction.update(
      { status: outcome },
      { where: { id: funding.id, status: 'pending' }, transaction: t },
    );

    if (claimed !== 1) {
      await funding.reload({ transaction: t });
      const currentStatus: string = funding.getDataValue('status');
      if (currentStatus === outcome) {
        return { id: funding.id, status: outcome };
      }
      throw new HttpError(409, { error: 'invalid_transition' });
    }

    if (outcome === 'completed') {
      await creditDeposit(funding, t);
    }

    return { id: funding.id, status: outcome };
  });
}

async function creditDeposit(
  funding: FundingTransaction,
  t: Transaction,
): Promise<void> {
  const wallet = await Wallet.findOne({ where: { memberId: funding.memberId }, transaction: t });
  if (!wallet) {
    throw new HttpError(404, { error: 'member_not_found' });
  }

  const required = dec(funding.amount).times(funding.turnoverMultiplier ?? 0).toFixed(18);

  await WalletTx.create(
    {
      walletId: wallet.id,
      type: 'deposit',
      amount: dec(funding.amount).toFixed(18),
      fundingTxId: funding.id,
    },
    { transaction: t },
  );

  await sequelize.query(
    `UPDATE wallets
     SET balance = balance + CAST(:amount AS numeric),
         required_turnover = required_turnover + CAST(:required AS numeric),
         updated_at = now()
     WHERE id = :walletId`,
    {
      replacements: { amount: funding.amount, required, walletId: wallet.id },
      transaction: t,
    },
  );
}
