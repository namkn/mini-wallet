import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { HttpError } from '../lib/httpError';
import { dec } from '../lib/money';

export async function requestWithdrawal(
  memberId: string,
  amount: string,
): Promise<{ id: string; status: 'pending' }> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findOne({
      where: { memberId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new HttpError(404, { error: 'member_not_found' });
    }

    const payout = dec(amount);
    const outstanding = dec(wallet.requiredTurnover).minus(wallet.accruedTurnover);
    if (outstanding.gt(0)) {
      throw new HttpError(422, {
        error: 'turnover_outstanding',
        outstanding: outstanding.toFixed(18),
      });
    }
    if (dec(wallet.balance).lt(payout)) {
      throw new HttpError(422, { error: 'insufficient_balance' });
    }

    const funding = await FundingTransaction.create(
      {
        memberId,
        kind: 'withdrawal',
        status: 'pending',
        amount: payout.toFixed(18),
        turnoverMultiplier: null,
        pspRef: null,
      },
      { transaction: t },
    );

    wallet.balance = dec(wallet.balance).minus(payout).toFixed(18);
    await wallet.save({ transaction: t });
    await WalletTx.create(
      {
        walletId: wallet.id,
        type: 'withdrawal',
        amount: payout.negated().toFixed(18),
        fundingTxId: funding.id,
      },
      { transaction: t },
    );

    return { id: funding.id, status: 'pending' };
  });
}
