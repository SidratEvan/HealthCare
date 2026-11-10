// Part A, assembled in reading order.
for (const m of ['./content-a-intro.cjs', './content-a-patient.cjs', './content-a-staff.cjs', './content-a-close.cjs']) delete require.cache[require.resolve(m)];
module.exports = [
  ...require('./content-a-intro.cjs'),
  ...require('./content-a-patient.cjs'),
  ...require('./content-a-staff.cjs'),
  ...require('./content-a-close.cjs'),
];
