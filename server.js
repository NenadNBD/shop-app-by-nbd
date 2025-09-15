const express = require('express');
const session = require('express-session');
const path = require('path');
const appInstalation  = require('./installation/app-installation');

const app = express();
app.get('/oauth-callback', appInstalation);

const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));


app.post('/webhook', (req, res) => {
  const events = req.body;

  if (!Array.isArray(events) || events.length === 0) {
      console.error("Webhook Error: Empty or invalid payload");
      return res.status(400).send('Bad Request');
  }
  console.log(events);
  res.status(200).send('Webhook processed');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on this port ${PORT}`);
});