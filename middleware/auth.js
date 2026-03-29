const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
