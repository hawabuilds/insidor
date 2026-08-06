'use strict';

const { runCronStage } = require('./_lib/run-stage');
const { runCycle } = require('../../worker/snapshot/snapshotter');

module.exports = async function handler(req, res) {
  return runCronStage(req, res, 'snapshot', runCycle);
};
