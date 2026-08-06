'use strict';

const { runCronStage } = require('./_lib/run-stage');
const { runCycle } = require('../../worker/ingest/ingest');

module.exports = async function handler(req, res) {
  return runCronStage(req, res, 'ingest', runCycle);
};
