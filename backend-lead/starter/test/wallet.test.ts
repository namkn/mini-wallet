import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { dec } from '../src/lib/money';
import '../src/db/models';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function createMember(username: string): Promise<{ memberId: string; walletId: string }> {
  const res = await request(app).post('/members').send({ username });
  expect(res.status).toBe(201);
  return { memberId: res.body.member.id, walletId: res.body.wallet.id };
}

async function walletBalance(memberId: string): Promise<string> {
  const res = await request(app).get(`/members/${memberId}/wallet`);
  expect(res.status).toBe(200);
  return res.body.balance;
}

async function ledgerSum(walletId: string): Promise<string> {
  const rows = await sequelize.query<{ sum: string }>(
    `SELECT coalesce(sum(amount), 0)::text AS sum FROM wallet_txs WHERE wallet_id = :walletId`,
    { replacements: { walletId }, type: QueryTypes.SELECT },
  );
  return rows[0].sum;
}

async function depositRowCount(walletId: string): Promise<number> {
  const rows = await sequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM wallet_txs WHERE wallet_id = :walletId AND type = 'deposit'`,
    { replacements: { walletId }, type: QueryTypes.SELECT },
  );
  return Number(rows[0].count);
}

describe('POST /deposits', () => {
  it('opens a pending deposit and does not move money', async () => {
    const { memberId } = await createMember('alice01');

    const res = await request(app).post('/deposits').send({
      memberId,
      amount: '100.50',
      turnoverMultiplier: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.pspRef).toEqual(expect.any(String));
    expect(res.body.pspRef).not.toBe(res.body.id);
    expect(dec(await walletBalance(memberId)).eq('0')).toBe(true);
  });

  it('accepts an omitted multiplier', async () => {
    const { memberId } = await createMember('bob02');

    const res = await request(app).post('/deposits').send({ memberId, amount: '10.00' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    const rows = await sequelize.query<{ turnover_multiplier: number }>(
      `SELECT turnover_multiplier FROM funding_transactions WHERE id = :id`,
      { replacements: { id: res.body.id }, type: QueryTypes.SELECT },
    );
    expect(rows[0].turnover_multiplier).toBe(1);
  });

  it('rejects a non-positive amount, a bad multiplier, and an unknown member', async () => {
    const { memberId } = await createMember('cara03');

    const zero = await request(app).post('/deposits').send({ memberId, amount: '0', turnoverMultiplier: 1 });
    const negative = await request(app).post('/deposits').send({ memberId, amount: '-5', turnoverMultiplier: 1 });
    const fractional = await request(app)
      .post('/deposits')
      .send({ memberId, amount: '10', turnoverMultiplier: 1.5 });
    const belowZero = await request(app)
      .post('/deposits')
      .send({ memberId, amount: '10', turnoverMultiplier: -1 });
    const missing = await request(app)
      .post('/deposits')
      .send({ memberId: '00000000-0000-4000-8000-000000000001', amount: '10', turnoverMultiplier: 1 });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
    expect(fractional.status).toBe(400);
    expect(belowZero.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(dec(await walletBalance(memberId)).eq('0')).toBe(true);
  });

  it('gives each deposit its own pspRef', async () => {
    const { memberId } = await createMember('dina04');

    const first = await request(app).post('/deposits').send({ memberId, amount: '1', turnoverMultiplier: 1 });
    const second = await request(app).post('/deposits').send({ memberId, amount: '2', turnoverMultiplier: 0 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.pspRef).not.toBe(second.body.pspRef);
  });
});
