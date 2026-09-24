import { Router } from 'express';
import { z } from 'zod';
import { requestWithdrawal } from '../services/withdrawalService';
import { isPositiveDecimal } from '../lib/money';

export const withdrawalsRouter = Router();

const positiveDecimal = z.string().refine(isPositiveDecimal, 'amount must be a positive decimal');

const withdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: positiveDecimal,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = withdrawalBody.parse(req.body);
    const result = await requestWithdrawal(body.memberId, body.amount);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
