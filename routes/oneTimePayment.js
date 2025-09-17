const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* Resolve an active Price for a given Product (Stripe Product ID). */
async function getActivePriceForProduct(productId) {
    const list = await stripe.prices.list({
        product: productId,
      active: true,
      limit: 1,
    });
    
    if (!list.data.length) {
        const err = new Error('No active Price found for product.');
        err.status = 400;
        throw err;
    }
    return list.data[0];
}

/**
 * POST /one-time-payment-intent
 * Body: { productId: string, receiptEmail?: string, metadata?: object }
 *
 * Creates a PaymentIntent using the Price resolved from the Stripe Product ID.
 * Returns: { client_secret }
 */
router.post(
    '/one-time-payment-intent',
    express.json(),
    async (req, res) => {
      try {
        const { productId, receiptEmail, metadata } = req.body || {};
  
        if (!productId || typeof productId !== 'string') {
          return res.status(400).json({ message: 'productId (Stripe Product ID) is required.' });
        }
  
        // 1 Resolve Price from Product
        const price = await getActivePriceForProduct(productId);
        if (price.type !== 'one_time') {
          // If you later support recurring, branch here; for now we enforce one-time.
          return res.status(400).json({ message: 'The resolved price is not a one-time price.' });
        }
        if (!Number.isFinite(price.unit_amount)) {
          return res.status(400).json({ message: 'Resolved price has no unit_amount.' });
        }
  
        // 2 Create PaymentIntent (server is the source of truth)
        const intent = await stripe.paymentIntents.create({
          amount: price.unit_amount,
          currency: price.currency,
          automatic_payment_methods: { enabled: true },
          // Optional: If you already collected email on the client at this moment, you can include it:
          ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
          metadata: {
            priceId: price.id,
            productId,
            ...(metadata && typeof metadata === 'object' ? metadata : {}),
          },
        });
  
        return res.json({ client_secret: intent.client_secret });
      } catch (err) {
        console.error('[one-time-payment-intent] Error:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Failed to create PaymentIntent.' });
      }
    }
  );

  module.exports = router;