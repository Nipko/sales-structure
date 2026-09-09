const { createHash } = require('crypto');
const Sequencer = require('@jest/test-sequencer').default;

/**
 * Run the test FILES in a different order on demand, deterministically.
 *
 * The interference this repository actually suffered from was between suites,
 * not inside them: two files running at the same time against the same database.
 * The variable is therefore the order of the files, and the way to prove it is
 * gone is to change that order and get the same result.
 *
 * Jest's own `--randomize` is the wrong instrument for it. It shuffles the tests
 * INSIDE a file, and several suites here are deliberately sequential — the
 * end-to-end turn harness closes a worker in one case and restarts it in the
 * next, the load harness builds its backlog case by case. Shuffling those breaks
 * them by design and says nothing about cross-suite isolation.
 *
 * With no `JEST_SEQUENCE_SEED` this is exactly Jest's default sequencer, so the
 * ordinary run keeps its failure-first, slowest-first behaviour.
 */
module.exports = class SeededSequencer extends Sequencer {
    sort(tests) {
        const seed = process.env.JEST_SEQUENCE_SEED;
        if (!seed) return super.sort(tests);
        const key = (test) => createHash('sha256').update(`${seed}:${test.path}`).digest('hex');
        return [...tests].sort((a, b) => key(a).localeCompare(key(b)));
    }
};
