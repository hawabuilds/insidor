'use strict';

const { runCronStage } = require('./_lib/run-stage');
const { runCycle } = require('../../worker/cluster');

module.exports = async function handler(req, res) {
  return runCronStage(req, res, 'cluster', runCycle);
};
