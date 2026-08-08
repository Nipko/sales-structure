import {
    runVerticalContractMatrix,
    summarizeVerticalContractMatrix,
    VERTICAL_CONTRACT_LAYER,
} from '../src/modules/vertical-contract-matrix/vertical-contract-matrix';

try {
    const report = runVerticalContractMatrix();
    const summary = summarizeVerticalContractMatrix(report);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (report.summary.failed > 0) process.exitCode = 1;
} catch (error: any) {
    process.stderr.write(`${JSON.stringify({
        layer: VERTICAL_CONTRACT_LAYER,
        bootstrapCertified: false,
        fatal: true,
        message: error?.message || String(error),
    }, null, 2)}\n`);
    process.exitCode = 2;
}
