const express = require('express');
const session = require('express-session');
const path = require('path');
const appInstalation  = require('./installation/app-installation');

const app = express();
app.get('/oauth-callback', appInstalation);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Example route
app.get("/", (req, res) => {
  res.send("HubSpot middleware app is running 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on this port ${PORT}`);
});