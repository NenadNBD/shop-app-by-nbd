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
router.post('/create-setup-intent', express.json(), async (req, res) => {
  const si = await stripe.setupIntents.create({
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
  });
  res.json({ clientSecret: si.client_secret });
});

// ========== 2) Finalize: create Customer, attach PM, create Subscription ==========
router.post('/submit-simple-subscription', express.json(), async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      fullName,
      stripeProductId,
      paymentMethodId,
      currency = 'usd',
      metadata = {},
    } = req.body || {};

    if (!email)           return res.status(400).json({ error: 'email is required' });
    if (!stripeProductId) return res.status(400).json({ error: 'stripeProductId is required' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });

    // Create a fresh Customer (your preference from earlier)
    const customer = await stripe.customers.create({
      email,
      name: fullName,
      // Optional: name/address can be added if you collect them
      metadata: {
        first_name: firstName || "",
        last_name: lastName || "",
        full_name: firstName + ' ' +  lastName,
      },
    });

    console.log('Do we have customer:', customer);
    console.log('Do we have customer ID:', customer.id);

    // Attach the saved PaymentMethod (from confirmed SetupIntent) to this Customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

    // Make it the default for invoices
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Resolve the recurring Price for the given Product
    const price = await getRecurringPriceForProduct(stripeProductId, currency);

    console.log('Do we have price:', price);
    console.log('Do we have price ID:', price.id);

    // (Optional) fetch product for description/metadata
    const prod = await stripe.products.retrieve(stripeProductId);

    // Create the subscription. With a default PM on the customer, Stripe will attempt to pay
    // the first invoice automatically. We keep this simple and do not bounce a client_secret
    // back to the browser for confirmation.
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      collection_method: 'charge_automatically',
      payment_behavior: 'allow_incomplete',
      default_payment_method: paymentMethodId,
      description: prod?.name,
      metadata: {
        productId: stripeProductId,
        priceId: price.id,
        product_name: prod?.name,
        ...metadata,
      },
      // You can expand invoice → payment_intent if you want to inspect status here:
      expand: ['latest_invoice'],
    });

    const invoiceId = subscription.latest_invoice?.id;
    if (!invoiceId) {
      return res.status(500).json({ error: 'Subscription created but no latest_invoice present' });
    }

    // 4 Poll for the PaymentIntent (or fall back to Charge → PI)
    const { paymentIntent, via, attempt, invoice } =
      await findPaymentIntentForInvoice(invoiceId, { maxAttempts: 5, delayMs: 450 });

    // 5 If we managed to find/attach a PaymentIntent, enrich it (e.g., set description)
    if (paymentIntent?.id && prod?.name) {
      try {
        await stripe.paymentIntents.update(paymentIntent.id, { description: prod.name });
      } catch (e) {
        // non-fatal: log and continue
        console.warn('Could not update PaymentIntent description:', e?.message || e);
      }
    }

    // 6 Respond (minimal fields needed by your frontend, plus a few diagnostics)
    return res.json({
      subscriptionId: subscription.id,
      customerId: customer.id,
      latestInvoiceId: invoiceId,
      paymentIntentId: paymentIntent?.id || null,
      paymentIntentStatus: paymentIntent?.status || null,
      amount: invoice?.amount_paid ?? invoice?.amount_due ?? null,
      currency: invoice?.currency ?? price.currency,
      obtainedVia: via,
      attempts: attempt,
    });

  } catch (err) {
    console.error('[submit-simple-subscription]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to submit subscription' });
  }
});

module.exports = router;