// routes/simpleSubscription.js
const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helper: pick an active RECURRING Price for a product, prefer requested currency
async function getRecurringPriceForProduct(productId, desiredCurrency) {
  const list = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'recurring',
    limit: 10,
  });
  if (!list.data.length) {
    const err = new Error('No active recurring Price for product');
    err.status = 400;
    throw err;
  }
  const desired = (desiredCurrency || '').toLowerCase();
  return list.data.find(p => p.currency === desired) || list.data[0];
}

// ========== 1) Create a SetupIntent (no customer yet) ==========
router.post('/create-setup-intent', async (req, res) => {
  try {
    // Create a SetupIntent on Stripe. This sets up a payment method for future charges (like subscriptions)
    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
    });

    // Return the client secret to the client
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Error creating SetupIntent:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== 2) Finalize: create Customer, attach PM, create Subscription ==========
router.post('/submit-simple-subscription', express.json(), async (req, res) => {
  try {
    const {
      email,
      stripeProductId,
      paymentMethodId,
      currency = 'usd',
      metadata = {},
      // optionally let caller choose thank-you
      successRedirect = 'https://nbd-shop.nenad-code.dev/thank-you',
    } = req.body || {};

    if (!email)           return res.status(400).json({ error: 'email is required' });
    if (!stripeProductId) return res.status(400).json({ error: 'stripeProductId is required' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });

    // Create a fresh Customer (your preference from earlier)
    const customer = await stripe.customers.create({
      email,
      // Optional: name/address can be added if you collect them
      metadata,
    });

    // Attach the saved PaymentMethod (from confirmed SetupIntent) to this Customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

    // Make it the default for invoices
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Resolve the recurring Price for the given Product
    const price = await getRecurringPriceForProduct(stripeProductId, currency);

    // (Optional) fetch product for description/metadata
    const prod = await stripe.products.retrieve(stripeProductId);

    // Create the subscription. With a default PM on the customer, Stripe will attempt to pay
    // the first invoice automatically. We keep this simple and do not bounce a client_secret
    // back to the browser for confirmation.
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id, quantity: 1 }],
      collection_method: 'charge_automatically',
      payment_behavior: 'allow_incomplete', // keep simple; Stripe will try the first charge
      description: prod?.name,
      metadata: {
        productId: stripeProductId,
        priceId: price.id,
        product_name: prod?.name,
        ...metadata,
      },
      // You can expand invoice → payment_intent if you want to inspect status here:
      expand: ['latest_invoice.payment_intent'],
    });

    // 5. Update the PaymentIntent description.
    const paymentIntentId = subscription.latest_invoice.payment_intent.id;
    await stripe.paymentIntents.update(paymentIntentId, {
      description: prod.name,
  });

    // If you want to branch on status, you can inspect:
    // const pi = subscription.latest_invoice?.payment_intent;
    // e.g., if (pi?.status === 'requires_action') … (out of scope for this flow)

    return subscription;
  } catch (err) {
    console.error('[submit-simple-subscription]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to submit subscription' });
  }
});

module.exports = router;