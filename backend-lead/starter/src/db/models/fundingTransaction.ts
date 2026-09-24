import { DataTypes, Model, Sequelize } from 'sequelize';

export class FundingTransaction extends Model {
  declare id: string;
  declare memberId: string;
  declare kind: 'deposit' | 'withdrawal';
  declare status: 'pending' | 'completed' | 'failed';
  declare amount: string;
  declare turnoverMultiplier: number | null;
  declare pspRef: string | null;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      kind: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.TEXT, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: true },
      pspRef: { type: DataTypes.UUID, allowNull: true, unique: true },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}
