// routes/stripe-webhook.js
const express = require('express');
const Stripe = require('stripe');
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const oneTimeHandlers = require('../webhookHandlers/oneTime');
const donationOneTimeHandlers = require('../webhookHandlers/donationsOneTime');
const subsHandlers = require('../webhookHandlers/subscriptions');

// RAW body only here
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Ack fast (Stripe will retry if non-2xx)
  res.status(200).send('ok');

  setImmediate(async () => {
    try {
      console.log('→ Incoming Stripe event:', event.type);
      switch (event.type) {
        // ONE-TIME + DONATIONS (PaymentIntent based)
        case 'payment_intent.succeeded': {
          const pi = event.data.object;
          const category = (pi.metadata?.category || '').toLowerCase();
          if (category === 'donation') {
            await donationOneTimeHandlers.onSucceeded(pi);
          } else if(category === 'purchase') {
            await oneTimeHandlers.onSucceeded(pi);
          }
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object;
          const category = (pi.metadata?.category || '').toLowerCase();
          if (category === 'donation') {
            await donationOneTimeHandlers.onFailed(pi);
          } else if(category === 'purchase') {
            await oneTimeHandlers.onFailed(pi);
          }
          break;
        }

        // SUBSCRIPTIONS (Invoice/Subscription based)
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          await subsHandlers.onSubscriptionEvent(event);
          break;

        case 'invoice.payment_succeeded':
        case 'invoice.payment_failed':
        case 'invoice.payment_action_required':
          await subsHandlers.onInvoiceEvent(event);
          break;

        case 'customer.subscription.trial_will_end':
          await subsHandlers.onTrialWillEnd(event);
          break;

        default:
          // ignore others for now
          break;
      }
    } catch (err) {
      console.error('Webhook handler error:', err);
      // You already returned 200, so just log/alert here
    }
  });
});

module.exports = router;