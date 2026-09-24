import { Router } from 'express';
import { z } from 'zod';
import { applyCallback } from '../services/callbackService';
import { isFiniteDecimal } from '../lib/money';

export const callbacksRouter = Router();

const finiteDecimal = z.string().refine(isFiniteDecimal, 'amount must be a finite decimal');

const callbackBody = z.object({
  pspRef: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  amount: finiteDecimal,
});

callbacksRouter.post('/', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const result = await applyCallback(body.pspRef, body.status, body.amount);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
