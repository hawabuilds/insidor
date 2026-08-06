#!/usr/bin/env node
'use strict';

/** Fill author_followers on backtest-merged-enriched.csv. Run: npm run backtest:fill-followers-merged */

const path = require('path');
const { loadEnvLocal } = require('../lib/env');

loadEnvLocal();

process.argv.push(`--input=${path.join(__dirname, '..', '..', 'backtest', 'backtest-merged-enriched.csv')}`);
require('./fill-author-followers.js');
