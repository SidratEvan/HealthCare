import { benchmark } from '../shared/domain/src/gov/benchmark.ts';
const result = benchmark([{kind: 'hospital', avgWaitMinutes: 12, waitsMeasured: 5, medianTurnaroundHours: null, turnaroundsMeasured: 0, waitScore: null, doctorScore: null, cleanlinessScore: null, billingScore: null, responses: 0}]);
console.log(JSON.stringify(result.find(x => x.measure === 'wait'), null, 2));
