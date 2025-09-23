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
router.post('/create-trial-setup-intent', express.json(), async (req, res) => {
  const si = await stripe.setupIntents.create({
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
  });
  res.json({ clientSecret: si.client_secret });
});

// ========== 2) Finalize: create Customer, attach PM, create Subscription ==========
router.post('/submit-trial-subscription', express.json(), async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      fullName,
      stripeProductId,
      paymentMethodId,
      currency = 'usd',
      stripeTrialPeriod,
      metadata = {},
    } = req.body || {};

    if (!email){
        return res.status(400).json({ error: 'email is required' });
    }
    if (!stripeProductId){
        return res.status(400).json({ error: 'stripeProductId is required' });
    }
    if (!paymentMethodId){
        return res.status(400).json({ error: 'paymentMethodId is required' });
    }
    if (!stripeTrialPeriod){
        return res.status(400).json({ error: 'trailPeriod is required' });
    }

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
      default_payment_method: paymentMethodId,
      collection_method: 'charge_automatically',
      trial_period_days: stripeTrialPeriod,
      description: prod?.name,
      metadata: {
        productId: stripeProductId,
        priceId: price.id,
        product_name: prod?.name,
        full_name: firstName + ' ' +  lastName,
        email: email,
        hsPortalId: hsPortalId,
        ...metadata,
      },
      // You can expand invoice → payment_intent if you want to inspect status here:
      expand: ['latest_invoice'],
    });

    // Create a $0 invoice for "paper trail" right after the trial starts ----
    let hostedInvoiceUrl = null;
    try {
    // 0-amount line item
    await stripe.invoiceItems.create({
        customer: customer.id,
        currency: price.currency, // same currency as your price
        amount: 0, // <- zero-dollar
        description: `Trial started for ${prod?.name || 'subscription'} — no charge today`,
        metadata: {
        subscription_id: subscription.id,
        trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : '',
        },
    });

    // create a draft invoice (send_invoice gives you a hosted URL)
    const draftInv = await stripe.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice', // ensures hosted_invoice_url is available
        metadata: {
        subscription_id: subscription.id,
        purpose: 'trial_receipt',
        },
    });

    // finalize so the hosted URL is generated
    const finalized = await stripe.invoices.finalizeInvoice(draftInv.id);
    hostedInvoiceUrl = finalized.hosted_invoice_url || null;
    } catch (e) {
    console.warn('[trial $0 invoice] skipped:', e?.message || e);
    }

    // Build response for trial flow (no payment/PI expected now)
    const trialEndISO = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;

    const latestInvoiceId = subscription.latest_invoice
    ? (typeof subscription.latest_invoice === 'string'
        ? subscription.latest_invoice
        : subscription.latest_invoice.id)
    : null;

    return res.json({
    ok: true,
    status: subscription.status, // 'trialing'
    subscriptionId: subscription.id,
    customerId: customer.id,
    latestInvoiceId,
    trialEnd: trialEndISO,
    trialInvoiceUrl: hostedInvoiceUrl, // <- shareable $0 invoice
    });
  } catch (err) {
    console.error('[submit-trial-subscription]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to submit subscription' });
  }
});

module.exports = router;