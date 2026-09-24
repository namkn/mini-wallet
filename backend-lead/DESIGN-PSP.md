# Adding the fiftieth PSP

Part A never calls a provider. `POST /psp/callbacks` speaks the mock body and credits inside one database transaction. A new provider should not open that transaction. The junior adds an adapter. The core keeps applying a normalized callback.

An incoming callback goes to that provider's adapter. The adapter verifies the raw body and parses it into a `NormalizedCallback`. The funding core applies that value and runs the claim and credit. Each provider is its own folder. The core only sees the normalized callback.

```ts
type NormalizedCallback = {
  pspRef: string;
  outcome: 'completed' | 'failed' | 'ignored';
  amount: string; // major-unit decimal, e.g. "100.50"
};

interface PspAdapter {
  verify(rawBody: Buffer, headers: IncomingHttpHeaders): void;
  parse(rawBody: Buffer): NormalizedCallback;
}
```

`verify` runs on the raw bytes, the signature header, and the webhook secret closed over when the adapter is constructed. A mismatch throws. The handler does not parse first. `parse` then maps that provider's words: `success` to `completed`, minor units divided into a major-unit decimal string, and whatever field they use as `pspRef`. `ignored` is an early or unknown status. The core does not move money for it.

Amount mismatch stays in the core, next to the pending-to-completed claim. The adapter's job ends at the normalized callback.

Config is a map from provider id to an adapter instance. The route is `POST /psp/:pspId/callbacks`. The route looks up the adapter and never reads a secret itself. A missing id is 404. A junior's day is a new adapter folder, one config entry, the verify and parse functions. The credit transaction is not edited.
