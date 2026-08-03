const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Dummy Login Endpoint
router.post('/login', (req, res) => {
  const { username, role } = req.body;
  // Generate JWT Token valid for 8 hours
  const token = jwt.sign({ username, role }, 'secret_key_123', { expiresIn: '8h' });
  res.json({ token, message: "Authenticated successfully" });
});

module.exports = router;