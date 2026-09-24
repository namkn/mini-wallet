import { Router } from 'express';
import { z } from 'zod';
import { placeWager } from '../services/wagerService';
import { isPositiveDecimal } from '../lib/money';

export const wagersRouter = Router();

const positiveDecimal = z.string().refine(isPositiveDecimal, 'amount must be a positive decimal');

const wagerBody = z.object({ amount: positiveDecimal });

wagersRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const walletId = z.string().uuid().parse(req.params.walletId);
    const body = wagerBody.parse(req.body);
    const result = await placeWager(walletId, body.amount);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
