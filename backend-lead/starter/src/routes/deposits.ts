import { Router } from 'express';
import { z } from 'zod';
import { createDeposit } from '../services/depositService';
import { isPositiveDecimal } from '../lib/money';

export const depositsRouter = Router();

const positiveDecimal = z.string().refine(isPositiveDecimal, 'amount must be a positive decimal');

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveDecimal,
  turnoverMultiplier: z.number().int().min(0).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const deposit = await createDeposit(body.memberId, body.amount, body.turnoverMultiplier);
    res.status(201).json(deposit);
  } catch (err) {
    next(err);
  }
});
