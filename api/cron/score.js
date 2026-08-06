'use strict';

const { runCronStage } = require('./_lib/run-stage');
const { runCycle } = require('../../worker/score/score');

module.exports = async function handler(req, res) {
  return runCronStage(req, res, 'score', runCycle);
};
