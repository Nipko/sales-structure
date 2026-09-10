import { BenchmarkError, benchmarkStatement, freezeBenchmarkCorpus, summariseBenchmark,
    type BenchmarkAttempt, type BenchmarkSubject, type BenchmarkTask } from './agent-benchmark';

/**
 * What a comparison has to be before anything may be said about it.
 *
 * "Best on the market" is a claim about other people's products, and passing our
 * own tests says only what our own tests ask. These cases are almost all about
 * the refusal: the harness must decline to summarise a run that is not
 * comparable, because remembering to be careful is not a control.
 */
describe('comparing this agent with an alternative', () => {
    const task = (key: string): BenchmarkTask => ({
        key, profileId: 'salud/dental', language: 'es', channel: 'web_widget',
        messages: ['Quiero una cita el martes a las diez', 'Sí, confirmo'],
        confirms: [{ table: 'appointments', where: { status: 'confirmed' } }],
        grants: ['check_availability', 'create_appointment'],
    });
    const corpus = freezeBenchmarkCorpus('dental-booking-v1', [task('book'), task('cancel')]);

    const us: BenchmarkSubject = { id: 'parallly', kind: 'self', label: 'Parallly', blindLabel: 'A', setupMinutes: 12 };
    const them: BenchmarkSubject = { id: 'other', kind: 'alternative', label: 'Otro', blindLabel: 'B', setupMinutes: 40 };

    const attempt = (over: Partial<BenchmarkAttempt> & { subjectId: string; taskKey: string }): BenchmarkAttempt => ({
        corpusHash: corpus.contentHash, confirmed: true, costUsdCents: 3, latencyMs: 1200,
        transcript: [{ role: 'user', content: 'hola' }], ...over,
    });
    const fullRun = (subjectId: string, confirmed: boolean[] = [true, true]) =>
        corpus.tasks.map((entry, index) => attempt({ subjectId, taskKey: entry.key, confirmed: confirmed[index] }));

    it('gives a corpus an identity so two runs can be known to be the same test', () => {
        const same = freezeBenchmarkCorpus('dental-booking-v1', [task('cancel'), task('book')]);
        // Order is not part of the identity; content is.
        expect(same.contentHash).toBe(corpus.contentHash);
        const different = freezeBenchmarkCorpus('dental-booking-v1', [task('book')]);
        expect(different.contentHash).not.toBe(corpus.contentHash);
    });

    it('refuses a task nobody can confirm, because that measures how a transcript reads', () => {
        expect(() => freezeBenchmarkCorpus('x', [{ ...task('book'), confirms: [] }]))
            .toThrow(BenchmarkError);
        expect(() => freezeBenchmarkCorpus('x', [{ ...task('book'), messages: [] }]))
            .toThrow(BenchmarkError);
        expect(() => freezeBenchmarkCorpus('x', [])).toThrow(BenchmarkError);
    });

    it('refuses to summarise a run with only ourselves in it', () => {
        const report = summariseBenchmark({ corpus, subjects: [us], attempts: fullRun('parallly') });
        expect(report.comparable).toBe(false);
        expect(report.blockers).toEqual(expect.arrayContaining(['single_subject', 'no_alternative_subject']));
        expect(benchmarkStatement(report)).toContain('No comparison can be stated');
    });

    it('refuses attempts recorded against a different corpus', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly'), ...fullRun('other').map(entry => ({ ...entry, corpusHash: 'other-hash' }))],
        });
        expect(report.blockers).toContain('attempts_from_another_corpus');
        expect(report.comparable).toBe(false);
    });

    it('refuses a subject that did not answer the whole corpus', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly'), attempt({ subjectId: 'other', taskKey: 'book' })],
        });
        expect(report.blockers).toContain('incomplete_corpus:other');
    });

    it('refuses a result nobody verified', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly'),
                ...corpus.tasks.map(entry => attempt({ subjectId: 'other', taskKey: entry.key, confirmed: null }))],
        });
        expect(report.blockers).toContain('unconfirmed_result:other');
        expect(report.subjects.find(subject => subject.subjectId === 'other')!.unconfirmed).toBe(2);
    });

    it('refuses a rubric a reviewer could decode', () => {
        const revealing = { ...them, blindLabel: 'Otro (competidor)' };
        const report = summariseBenchmark({
            corpus, subjects: [us, revealing],
            attempts: [...fullRun('parallly'), ...fullRun('other')],
        });
        expect(report.blockers).toContain('blind_label_reveals_subject');
    });

    it('refuses two subjects wearing the same blind label', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, { ...them, blindLabel: 'A' }],
            attempts: [...fullRun('parallly'), ...fullRun('other')],
        });
        expect(report.blockers).toContain('blind_labels_not_unique');
    });

    it('refuses a review whose label belongs to no subject in the run', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly'), ...fullRun('other')],
            reviews: [{ taskKey: 'book', blindLabel: 'Z', reviewerId: 'r1', score: 9 }],
        });
        expect(report.blockers).toContain('review_without_known_label');
    });

    it('summarises a comparison that really is one, and says only what it measured', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly', [true, true]), ...fullRun('other', [true, false])],
            reviews: [
                { taskKey: 'book', blindLabel: 'A', reviewerId: 'r1', score: 9 },
                { taskKey: 'book', blindLabel: 'B', reviewerId: 'r1', score: 7 },
            ],
        });
        expect(report.comparable).toBe(true);
        expect(report.blockers).toEqual([]);
        const mine = report.subjects.find(subject => subject.subjectId === 'parallly')!;
        expect(mine).toMatchObject({ confirmedSuccesses: 2, failures: 0, setupMinutes: 12, blindScore: 9 });
        expect(mine.medianLatencyMs).toBe(1200);
        expect(mine.totalCostUsdCents).toBe(6);
        // A verifiable sentence with the numbers in it, never a superlative.
        const statement = benchmarkStatement(report);
        expect(statement).toContain('parallly confirmed 2 of 2 attempts against other');
        expect(statement.toLowerCase()).not.toContain('best');
        expect(statement.toLowerCase()).not.toContain('mejor');
    });

    it('declines to name a winner when nobody confirmed more than anyone else', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, them],
            attempts: [...fullRun('parallly', [true, false]), ...fullRun('other', [true, false])],
        });
        expect(report.comparable).toBe(true);
        expect(benchmarkStatement(report)).toContain('No subject confirmed more results');
    });

    it('measures whether a subject agrees with itself when a task is repeated', () => {
        const repeated = [
            ...fullRun('parallly'),
            attempt({ subjectId: 'parallly', taskKey: 'book', confirmed: false }),
            ...fullRun('other'),
            attempt({ subjectId: 'other', taskKey: 'book', confirmed: true }),
        ];
        const report = summariseBenchmark({ corpus, subjects: [us, them], attempts: repeated });
        expect(report.subjects.find(subject => subject.subjectId === 'parallly')!.reliability).toBe(0);
        expect(report.subjects.find(subject => subject.subjectId === 'other')!.reliability).toBe(1);
    });

    it('reports nothing for an axis nobody measured instead of a zero', () => {
        const report = summariseBenchmark({
            corpus, subjects: [us, { ...them, setupMinutes: null }],
            attempts: [...fullRun('parallly'),
                ...corpus.tasks.map(entry => attempt({ subjectId: 'other', taskKey: entry.key, costUsdCents: null, latencyMs: null }))],
        });
        const other = report.subjects.find(subject => subject.subjectId === 'other')!;
        expect(other.totalCostUsdCents).toBeNull();
        expect(other.medianLatencyMs).toBeNull();
        expect(other.setupMinutes).toBeNull();
        expect(other.blindScore).toBeNull();
    });
});
