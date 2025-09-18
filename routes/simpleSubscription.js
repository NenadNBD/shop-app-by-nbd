const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helper: pick an active one-time price for a product, prefer matching currency
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

    // Fetch product for a nice description/metadata
    const prod = await stripe.products.retrieve(product);

    // Always create a brand-new Customer (no lookup/reuse)
    const cust = await stripe.customers.create({
      email: metadata.customer_email || undefined,
      name: metadata.customer_full_name.trim() || undefined,
      metadata: {
        productId: product,
        priceId: price.id,
        product_name: prod.name,
        ...metadata, // keep your extra fields if any
      },
    });

    // Create Subscription (no trial). default_incomplete so client confirms via Payment Element.
    const sub = await stripe.subscriptions.create({
      customer: cust.id,
      items: [{ price: price.id, quantity: 1 }],
      payment_behavior: 'default_incomplete',
      collection_method: 'charge_automatically',
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
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    });

    // grab either PI or SI
const pi = sub.latest_invoice?.payment_intent;
const si = sub.pending_setup_intent;

// only update PI description if PI exists
if (pi?.id) {
  await stripe.paymentIntents.update(pi.id, { description: prod.name });
}

// return whichever client_secret exists (no more 500)
if (pi?.client_secret) {
  return res.json({ clientSecret: pi.client_secret, intentType: 'payment' });
}
if (si?.client_secret) {
  return res.json({ clientSecret: si.client_secret, intentType: 'setup' });
}

// extra diagnostics if neither exists
console.error('No client secret — diag:', {
  usageType: price.recurring?.usage_type,
  amountDue: sub.latest_invoice?.amount_due,
  collectionMethod: sub.latest_invoice?.collection_method,
});
throw new Error('No client secret available for confirmation');
  } catch (err) {
    console.error('[create-simple-subscription] ', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to create subscription' });
  }
});

module.exports = router;