// Vercel serverless function entry point
const app = require('../server');

// Export handler function
module.exports = async (req, res) => {
  return app(req, res);
};

