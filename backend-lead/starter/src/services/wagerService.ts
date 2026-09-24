import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { HttpError } from '../lib/httpError';
import { dec } from '../lib/money';

export async function placeWager(walletId: string, amount: string): Promise<{ balance: string }> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findByPk(walletId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!wallet) {
      throw new HttpError(404, { error: 'wallet_not_found' });
    }

    const stake = dec(amount);
    if (dec(wallet.balance).lt(stake)) {
      throw new HttpError(422, { error: 'insufficient_balance' });
    }

    wallet.balance = dec(wallet.balance).minus(stake).toFixed(18);
    wallet.accruedTurnover = dec(wallet.accruedTurnover).plus(stake).toFixed(18);
    await wallet.save({ transaction: t });
    await WalletTx.create(
      {
        walletId: wallet.id,
        type: 'wager',
        amount: stake.negated().toFixed(18),
        fundingTxId: null,
      },
      { transaction: t },
    );

    return { balance: wallet.balance };
  });
}
