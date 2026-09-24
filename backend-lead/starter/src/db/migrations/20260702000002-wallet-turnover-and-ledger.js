'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('wallets', 'required_turnover', {
      type: Sequelize.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: '0',
    });
    await queryInterface.addColumn('wallets', 'accrued_turnover', {
      type: Sequelize.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: '0',
    });

    await queryInterface.createTable('wallet_txs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      type: { type: Sequelize.TEXT, allowNull: false },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      funding_tx_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'funding_transactions', key: 'id' },
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX wallet_txs_one_deposit
      ON wallet_txs (funding_tx_id)
      WHERE type = 'deposit'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS wallet_txs_one_deposit');
    await queryInterface.dropTable('wallet_txs');
    await queryInterface.removeColumn('wallets', 'accrued_turnover');
    await queryInterface.removeColumn('wallets', 'required_turnover');
  },
};
