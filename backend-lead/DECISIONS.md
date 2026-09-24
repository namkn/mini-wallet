# Decisions

## Callback amount differs from the deposit

A `completed` callback is compared to the amount stored on the pending deposit with decimal equality, so `100.50` and `100.5` are the same value. When they differ, the handler returns 409 with `amount_mismatch`, the deposit amount, and the callback amount. It does not claim the row and does not write a ledger row, so the deposit stays `pending`.

A later callback whose amount matches can still complete that deposit. Marking the row `failed` on the first mismatch would let a bad delivery win the claim, and the matching retry could never credit. Crediting either amount while they disagree would book money the deposit did not authorize, or money the provider did not confirm.

## Unknown pspRef

An unknown `pspRef` returns 404 with `unknown_psp_ref` and inserts nothing. A callback can arrive before the deposit commit is visible to that connection. A 404 lets the provider retry and then match. Treating it as handled would drop a payment that never got a funding row.

## pspRef is its own column

`pspRef` is a random UUID in its own unique column on the funding row. The 201 returns that value beside the funding id. The callback looks up the unique column.

The funding id would also be unique and opaque. The separate column keeps the provider contract off the primary key, so a later provider-issued id can be stored beside it. Idempotency does not depend on which of the two ids the callback sends, as long as the lookup hits one unique column.

## Locking

Postgres stays on read committed.

The completed callback claims the funding row with one conditional update, `status = completed` where `status = pending`. Only the transaction whose update changes a row credits. In that same transaction it inserts the deposit ledger row and runs `balance = balance + amount` and `required_turnover = required_turnover + amount * multiplier`. The increment waits for any concurrent update of the wallet row and then applies to the committed balance, so the credit does not read the balance into the application and write it back.

A wager and a withdrawal take `SELECT … FOR UPDATE` on the wallet row, then decide in the service, then write the cache and the ledger row before commit. Two debits that both fit both commit. The second decides against the balance the first left. A debit that does not fit rolls back and releases the lock.

The callback locks the funding row first, then updates the wallet. A debit locks the wallet and does not lock an existing funding row first. Those two orders do not form a cycle.

A partial unique index on deposit ledger rows, one per funding id, is a second guard so two credits for the same deposit cannot both insert.

## Schema

`funding_transactions` is one row per deposit or withdrawal. It holds kind, status (`pending`, `completed`, `failed`), amount, the turnover multiplier for a deposit, and a nullable unique `psp_ref`. Withdrawals leave `psp_ref` empty. A deposit starts `pending` and moves once. A withdrawal is inserted `pending` when the debit commits. Approval of that payout is not built.

`wallets.balance` is a cache. `required_turnover` is a cache of completed deposit amount times multiplier, added in the credit transaction. `accrued_turnover` is a cache of wager amounts, added in the wager transaction. A withdrawal changes neither total. Outstanding turnover is `required_turnover - accrued_turnover`, computed for the response and not stored.

`wallet_txs` is append-only. Each row is a signed amount and a type of `deposit`, `wager`, or `withdrawal`. Deposit and withdrawal rows point at their funding record. Wager rows do not. After every commit, `sum(amount)` for a wallet equals `wallets.balance`. Rows are not updated or deleted.

## What I would do with more time

Wire the adapter from `DESIGN-PSP.md` in front of the callback, with the mock body behind one adapter, and keep the credit transaction free of provider vocabulary.

Add the human decision on a pending withdrawal. A rejection would append a compensating credit in a new ledger row. The payout debit would stay in the books.

After a deposit is stored as pending, call the provider to start the payment. That call sits outside the database transaction, so it needs a recovery point the local callback path does not.

Alert when a deposit stays pending because completed callbacks keep arriving with a different amount.

## AI tools

I defined all the standards and the contracts: the money rules, the HTTP behavior, the locks, the schema. An AI coding agent in Cursor then generated the tests one at a time, and after each failing test generated only the feature that made that test pass, following that plan. The agent also reviewed the diff before I reviewed the code myself.
