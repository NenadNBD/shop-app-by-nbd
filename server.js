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

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on this port ${PORT}`);
});