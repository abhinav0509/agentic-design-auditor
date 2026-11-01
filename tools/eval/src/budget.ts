// Eval budget (NFR-05, addendum F.7): refuse a run whose estimate is over budget, and stop starting
// cases once the next one could cross it.
const dollars = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;

// shortcut: typical tokens per case from the fixer's prompt size; replace with the mean of the last
// real run once there is one.
export const estimateCaseMicros = (price: { inputPerMTok: number; outputPerMTok: number }) =>
  8000 * price.inputPerMTok + 1500 * price.outputPerMTok;

export function checkBudget(cases: number, perCaseMicros: number, budgetMicros: number): void {
  const estimate = cases * perCaseMicros;
  if (estimate > budgetMicros)
    throw new Error(
      `run is over budget: estimate ${dollars(estimate)} > budget ${dollars(budgetMicros)}`,
    );
}

export class Budget {
  spentMicros = 0;
  private readonly total: number;
  private readonly perCase: number;

  constructor(totalMicros: number, perCaseEstimateMicros: number) {
    this.total = totalMicros;
    this.perCase = perCaseEstimateMicros;
  }

  canStart(): boolean {
    return this.spentMicros + this.perCase <= this.total;
  }

  spend(micros: number): void {
    this.spentMicros += micros;
  }
}
