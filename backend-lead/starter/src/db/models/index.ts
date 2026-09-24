import { sequelize } from '../sequelize';
import { FundingTransaction, initFundingTransaction } from './fundingTransaction';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';

initMember(sequelize);
initWallet(sequelize);
initFundingTransaction(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Member.hasMany(FundingTransaction, { foreignKey: 'memberId', as: 'fundingTransactions' });
FundingTransaction.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

export { FundingTransaction, Member, Wallet };
