const express = require('express');
const session = require('express-session');
const path = require('path');
const appInstalation  = require('./installation/app-installation');
const productHandlers = require('./webhookHandlers/productHandlers');

const app = express();
app.get('/oauth-callback', appInstalation);

const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));


app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events) || events.length === 0) {
    console.error('Webhook Error: Empty or invalid payload');
    return res.status(400).send('Bad Request');
  }

  // Handle all events; collect promises so we can catch errors
  const webhookJobs = events.map(async (event) => {
    console.log(
      `Webhook Event: ${event.subscriptionType} → objectType: ${event.objectTypeId} → ${event.propertyName || ''}`
    );

    // Products have objectTypeId '0-7'
    if (event.objectTypeId === '0-7') {
      if (event.subscriptionType === 'object.creation') {
        return productHandlers.productCreated(event);
      }
      if (event.subscriptionType === 'object.propertyChange') {
        return productHandlers.productUpdated(event);
      }
    }

    // Unknown/unhandled → no-op
    return;
  });

  // Let HubSpot retry on transient failures if any handler throws
  try {
    await Promise.all(webhookJobs);
    res.status(200).send('Webhook processed');
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send('retry');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on this port ${PORT}`);
});