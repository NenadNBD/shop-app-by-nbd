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

router.post('/create-simple-subscription', express.json(), async (req, res) => {
  try {
    const { currency = 'usd', product, metadata = {} } = req.body || {};
    if (!product || typeof product !== 'string') {
      return res.status(400).json({ error: 'product (Stripe Product ID) is required' });
    }

    // Resolve recurring price
    const price = await getRecurringPriceForProduct(product, currency);
    if (!Number.isFinite(price.unit_amount)) {
      return res.status(400).json({ error: 'Resolved price has no unit_amount' });
    }

    // Fetch product for description/metadata
    const prod = await stripe.products.retrieve(product);

    // Safe full name
    let fullName = metadata.customer_full_name;
    if (!fullName) {
      fullName = `${metadata.customer_first_name || ''} ${metadata.customer_last_name || ''}`.trim() || undefined;
    }

    // Always create a brand-new Customer
    const cust = await stripe.customers.create({
      email: metadata.customer_email || undefined,
      name: fullName,
      metadata: {
        productId: product,
        priceId: price.id,
        product_name: prod.name,
        ...metadata,
      },
    });

    // Create Subscription (no trial), Flexible billing, confirm on client
    const sub = await stripe.subscriptions.create({
      customer: cust.id,
      items: [{ price: price.id, quantity: 1 }],
      payment_behavior: 'default_incomplete',
      collection_method: 'charge_automatically',
      billing_mode: { type: 'flexible' },
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        // payment_method_types: ['card'], // uncomment to force card-only
      },
      metadata: {
        productId: product,
        priceId: price.id,
        product_name: prod.name,
        ...metadata,
      },
      // Expand the invoice confirmation secret; also expand PI if present so we can set description
      expand: ['latest_invoice.confirmation_secret', 'latest_invoice.payment_intent', 'pending_setup_intent'],
    });

    // Preferred path (Flexible): use invoice confirmation secret
    const confirmationSecret = sub.latest_invoice?.confirmation_secret?.client_secret;

    // If a PaymentIntent exists, update its description (optional)
    const pi = sub.latest_invoice?.payment_intent;
    if (pi && typeof pi === 'object' && pi.id) {
      await stripe.paymentIntents.update(pi.id, { description: prod.name });
    }

    if (confirmationSecret) {
      return res.json({ clientSecret: confirmationSecret, intentType: 'payment' });
    }

    // Fallback: if first invoice is $0/trial/etc., confirm a SetupIntent on client
    const si = sub.pending_setup_intent;
    if (si?.client_secret) {
      return res.json({ clientSecret: si.client_secret, intentType: 'setup' });
    }

    // Diagnostics before error
    console.error('No client secret — diag:', {
      usageType: price.recurring?.usage_type,
      amountDue: sub.latest_invoice?.amount_due,
      collectionMethod: sub.latest_invoice?.collection_method,
      hasConfirmationSecret: !!sub.latest_invoice?.confirmation_secret,
      hasPI: !!sub.latest_invoice?.payment_intent,
      hasSI: !!sub.pending_setup_intent,
    });
    throw new Error('No client secret available for confirmation');
  } catch (err) {
    console.error('[create-simple-subscription] ', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to create subscription' });
  }
});

module.exports = router;