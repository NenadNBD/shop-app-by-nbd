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
  for (const event of events) {
    console.log(`Webhook Event: ${event.subscriptionType} → objectType: ${event.objectTypeId} → ${event.propertyName}`);
    if (event.subscriptionType === 'object.creation') {
        switch (event.objectTypeId) {
            case '0-7': //Product
            if (event.propertyName === 'hs_timestamp' && event.propertyValue) {
                emailWebhookHandlers.handleEmail(event);
              } else {
                console.warn(`No handler for contact property: ${event.propertyName}`);
              }
            break;
            default:
                console.warn(`Unknown objectTypeId: ${event.objectTypeId}`);
        }
    } else {
        console.log(`Unhandled subscriptionType: ${event.subscriptionType}`);
    }
}
  res.status(200).send('Webhook processed');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on this port ${PORT}`);
});