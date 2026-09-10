/**
 * Numbers for the load and chaos suites.
 *
 * An assertion says the invariant held; it says nothing about whether the path
 * is usable, and an SLO written without a measurement behind it is a guess with
 * a threshold attached. So every scenario here records what it observed and
 * prints it, and the runbook quotes those numbers with the conditions that
 * produced them.
 *
 * Percentiles are nearest-rank over the sorted samples, deliberately without
 * interpolation: a printed p95 is then always a latency the run actually saw,
 * which is what an operator can be held to.
 */

export class Timings {
    private readonly values: number[] = [];

    add(milliseconds: number): void {
        this.values.push(milliseconds);
    }

    get count(): number {
        return this.values.length;
    }

    percentile(p: number): number {
        if (!this.values.length) return 0;
        const sorted = [...this.values].sort((left, right) => left - right);
        const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
        return sorted[Math.min(rank, sorted.length) - 1];
    }

    get max(): number {
        return this.values.length ? Math.max(...this.values) : 0;
    }

    get mean(): number {
        if (!this.values.length) return 0;
        return this.values.reduce((total, value) => total + value, 0) / this.values.length;
    }
}

const round = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

/**
 * One scenario's measurements, accumulated across its cases and printed once.
 *
 * Kept per suite rather than global: two Jest workers run at the same time and
 * a shared sink would interleave two unrelated runs into one table nobody can
 * read back.
 */
export class LoadMetrics {
    private readonly series = new Map<string, Timings>();
    private readonly counters = new Map<string, number>();
    private readonly notes: string[] = [];

    constructor(private readonly title: string) {}

    samples(name: string): Timings {
        const existing = this.series.get(name);
        if (existing) return existing;
        const created = new Timings();
        this.series.set(name, created);
        return created;
    }

    /** Times the call even when it throws: a refused admission is a sample too. */
    async time<T>(name: string, work: () => Promise<T>): Promise<T> {
        const started = Date.now();
        try {
            return await work();
        } finally {
            this.samples(name).add(Date.now() - started);
        }
    }

    count(name: string, by = 1): void {
        this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    }

    note(text: string): void {
        this.notes.push(text);
    }

    render(): string {
        const lines = [`\n── ${this.title} ${'─'.repeat(Math.max(4, 64 - this.title.length))}`];
        for (const [name, timings] of [...this.series.entries()].sort()) {
            lines.push(`  ${name.padEnd(30)} n=${String(timings.count).padStart(5)}`
                + `  p50=${round(timings.percentile(50)).padStart(8)}ms`
                + `  p95=${round(timings.percentile(95)).padStart(8)}ms`
                // p99 as well as p95, because the two answer different
                // questions: p95 is the experience of a bad moment, p99 is the
                // one a customer waits through before deciding nobody is there.
                // With nearest rank both are latencies the run actually saw, so
                // a small n simply makes them equal rather than invented.
                + `  p99=${round(timings.percentile(99)).padStart(8)}ms`
                + `  max=${round(timings.max).padStart(8)}ms`);
        }
        if (this.counters.size) {
            lines.push('  counters:');
            for (const [name, value] of [...this.counters.entries()].sort()) {
                lines.push(`    ${name.padEnd(38)} ${value}`);
            }
        }
        for (const note of this.notes) lines.push(`  · ${note}`);
        return lines.join('\n');
    }

    print(): void {
        // Jest buffers per file and prints on completion, so this lands as one
        // block instead of interleaving with the other worker's output.
        // eslint-disable-next-line no-console
        console.log(this.render());
    }
}
