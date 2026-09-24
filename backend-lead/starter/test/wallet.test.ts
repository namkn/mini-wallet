import request from 'supertest';
import { QueryTypes } from 'sequelize';
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

async function openDeposit(
  memberId: string,
  amount: string,
  turnoverMultiplier?: number,
): Promise<{ id: string; pspRef: string }> {
  const body: { memberId: string; amount: string; turnoverMultiplier?: number } = { memberId, amount };
  if (turnoverMultiplier !== undefined) body.turnoverMultiplier = turnoverMultiplier;
  const res = await request(app).post('/deposits').send(body);
  expect(res.status).toBe(201);
  return { id: res.body.id, pspRef: res.body.pspRef };
}

async function requiredTurnover(memberId: string): Promise<string> {
  const rows = await sequelize.query<{ required_turnover: string }>(
    `SELECT required_turnover::text AS required_turnover
     FROM wallets WHERE member_id = :memberId`,
    { replacements: { memberId }, type: QueryTypes.SELECT },
  );
  return rows[0].required_turnover;
}

describe('POST /psp/callbacks completed', () => {
  it('credits a matching completed callback once and keeps the ledger equal to the balance', async () => {
    const { memberId, walletId } = await createMember('erin05');
    const deposit = await openDeposit(memberId, '100.50', 1);

    const res = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: '100.5',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: deposit.id, status: 'completed' });
    expect(dec(await walletBalance(memberId)).eq('100.50')).toBe(true);
    expect(dec(await requiredTurnover(memberId)).eq('100.50')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(1);
    expect(dec(await ledgerSum(walletId)).eq(await walletBalance(memberId))).toBe(true);
  });

  it('credits a multiplier of 0 without raising required turnover', async () => {
    const { memberId } = await createMember('fran06');
    const deposit = await openDeposit(memberId, '40.00', 0);

    const res = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: '40.00',
    });

    expect(res.status).toBe(200);
    expect(dec(await walletBalance(memberId)).eq('40')).toBe(true);
    expect(dec(await requiredTurnover(memberId)).eq('0')).toBe(true);
  });

  it('does not credit a sequential or differing replay of a completed callback', async () => {
    const { memberId, walletId } = await createMember('gina07');
    const deposit = await openDeposit(memberId, '80.00', 1);
    const body = { pspRef: deposit.pspRef, status: 'completed', amount: '80.00' };

    const first = await request(app).post('/psp/callbacks').send(body);
    const second = await request(app).post('/psp/callbacks').send(body);
    const different = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: deposit.pspRef, status: 'completed', amount: '1.00' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id: deposit.id, status: 'completed' });
    expect(different.status).toBe(200);
    expect(dec(await walletBalance(memberId)).eq('80')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(1);
    expect(dec(await ledgerSum(walletId)).eq('80')).toBe(true);
  });

  it('credits once when two completed callbacks are in flight', async () => {
    const { memberId, walletId } = await createMember('hana08');
    const deposit = await openDeposit(memberId, '100.00', 1);
    const body = { pspRef: deposit.pspRef, status: 'completed', amount: '100.00' };

    const [first, second] = await Promise.all([
      request(app).post('/psp/callbacks').send(body),
      request(app).post('/psp/callbacks').send(body),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(dec(await walletBalance(memberId)).eq('100')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(1);
    expect(dec(await ledgerSum(walletId)).eq('100')).toBe(true);
  });
});

describe('POST /psp/callbacks that must not pay', () => {
  it('leaves a mismatched completed callback pending so a later match can credit', async () => {
    const { memberId, walletId } = await createMember('iris09');
    const deposit = await openDeposit(memberId, '100.00', 1);

    const mismatch = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: '90.00',
    });

    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toBe('amount_mismatch');
    expect(dec(mismatch.body.expected).eq('100')).toBe(true);
    expect(dec(mismatch.body.received).eq('90')).toBe(true);
    expect(dec(await walletBalance(memberId)).eq('0')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(0);

    const match = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: '100.00',
    });
    expect(match.status).toBe(200);
    expect(dec(await walletBalance(memberId)).eq('100')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(1);
  });

  it('rejects an unknown pspRef and inserts nothing', async () => {
    const { walletId } = await createMember('jade10');

    const res = await request(app).post('/psp/callbacks').send({
      pspRef: '00000000-0000-4000-8000-000000000099',
      status: 'completed',
      amount: '10.00',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_psp_ref');
    expect(await depositRowCount(walletId)).toBe(0);
    const funding = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM funding_transactions WHERE psp_ref = :pspRef`,
      {
        replacements: { pspRef: '00000000-0000-4000-8000-000000000099' },
        type: QueryTypes.SELECT,
      },
    );
    expect(funding[0].count).toBe('0');
  });

  it('fails a pending deposit for any finite amount without crediting', async () => {
    const { memberId, walletId } = await createMember('kate11');
    const deposit = await openDeposit(memberId, '50.00', 1);

    const res = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'failed',
      amount: '-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: deposit.id, status: 'failed' });
    expect(dec(await walletBalance(memberId)).eq('0')).toBe(true);
    expect(dec(await requiredTurnover(memberId)).eq('0')).toBe(true);
    expect(await depositRowCount(walletId)).toBe(0);
  });

  it('rejects a non-numeric callback amount without changing the deposit', async () => {
    const { memberId } = await createMember('lena12');
    const deposit = await openDeposit(memberId, '50.00', 1);

    const res = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: 'nope',
    });

    expect(res.status).toBe(400);
    const again = await request(app).post('/psp/callbacks').send({
      pspRef: deposit.pspRef,
      status: 'completed',
      amount: '50.00',
    });
    expect(again.status).toBe(200);
    expect(dec(await walletBalance(memberId)).eq('50')).toBe(true);
  });

  it('rejects the opposite outcome after the deposit is already terminal', async () => {
    const { memberId } = await createMember('mira13');
    const completed = await openDeposit(memberId, '20.00', 1);
    await request(app).post('/psp/callbacks').send({
      pspRef: completed.pspRef,
      status: 'completed',
      amount: '20.00',
    });
    const lateFail = await request(app).post('/psp/callbacks').send({
      pspRef: completed.pspRef,
      status: 'failed',
      amount: '20.00',
    });
    expect(lateFail.status).toBe(409);
    expect(lateFail.body.error).toBe('invalid_transition');
    expect(dec(await walletBalance(memberId)).eq('20')).toBe(true);

    const failed = await openDeposit(memberId, '15.00', 1);
    await request(app).post('/psp/callbacks').send({
      pspRef: failed.pspRef,
      status: 'failed',
      amount: '0',
    });
    const lateComplete = await request(app).post('/psp/callbacks').send({
      pspRef: failed.pspRef,
      status: 'completed',
      amount: '15.00',
    });
    expect(lateComplete.status).toBe(409);
    expect(dec(await walletBalance(memberId)).eq('20')).toBe(true);
  });
});
