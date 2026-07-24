function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function okJson(res, body) {
  cors(res);
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(body);
}

module.exports = { cors, okJson };
