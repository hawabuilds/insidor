'use strict';

const { runCronStage } = require('./_lib/run-stage');
const { runCycle } = require('../../worker/snapshotter');

module.exports = async function handler(req, res) {
  return runCronStage(req, res, 'snapshot', runCycle);
};
