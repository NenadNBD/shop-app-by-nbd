const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helper: pick an active one-time price for a product, prefer matching currency
async function getOneTimePriceForProduct(productId, desiredCurrency) {
  const list = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'one_time',
    limit: 10,
  });
  if (!list.data.length) {
    const err = new Error('No active one-time Price for product');
    err.status = 400;
    throw err;
  }
  // try to match currency first
  const match = list.data.find(p => p.currency === (desiredCurrency || '').toLowerCase());
  return match || list.data[0];
}

router.post('/one-time-payment-intent', express.json(), async (req, res) => {
  try {
    const { currency = 'usd', product, email, firstName, lastName, fullName, payerType, companyName, streetAddress, city, zip, country, state, hsPortalId, metadata = {} } = req.body || {};
    if (!product || typeof product !== 'string') {
      return res.status(400).json({ error: 'product (Stripe Product ID) is required' });
    }

    const price = await getOneTimePriceForProduct(product, currency);
    if (!Number.isFinite(price.unit_amount)) {
      return res.status(400).json({ error: 'Resolved price has no unit_amount' });
    }

    // Fetch the product to get its name
    const prod = await stripe.products.retrieve(product);

    const intent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency, // use the price currency
      automatic_payment_methods: { enabled: true }, // lets the Element offer multiple PMs
      description: prod.name,
      metadata: {
        productId: product,
        priceId: price.id,
        hsPortalId: hsPortalId,
        ...metadata, // your order/customer fields
      },
      // OPTIONAL: if you want a receipt, you can set receipt_email here instead of metadata
      // receipt_email: metadata.customer_email,
    });

    return res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('[create-payment-intent] ', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to create PaymentIntent' });
  }
});

module.exports = router;