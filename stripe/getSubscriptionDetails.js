const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// helpers up top
const toYmdFromUnix = (sec) => {
    if (!Number.isFinite(sec)) return null;
    const d = new Date(sec * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  };
  
  const safe = (v, fallback = null) => (v == null ? fallback : v);
  
  // router.get('/fetch-stripe-portal', express.json(), async (req, res) => {
  router.get('/fetch-stripe-portal', async (req, res) => {
    const { subscriptionId, customerId } = req.query;
    if (!subscriptionId) return res.status(400).json({ error: "Subscription ID is required" });
    if (!customerId) return res.status(400).json({ error: "Customer ID is required" });
  
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] });
      const customer     = await stripe.customers.retrieve(customerId);
      const invoices     = await stripe.invoices.list({ customer: customerId, subscription: subscriptionId, limit: 10 });
  
      // 🛡️ guard: some APIs/versions return price instead of plan on lines
      const productId = subscription.items?.data?.[0]?.price?.product
                     ?? subscription.items?.data?.[0]?.plan?.product
                     ?? null;
  
      // payment methods
      const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
      let defaultPaymentMethodId = subscription.default_payment_method
        || customer.invoice_settings?.default_payment_method
        || null;
  
      const product = productId ? await stripe.products.retrieve(productId) : { name: 'N/A' };
  
      const formattedPaymentMethods = paymentMethods.data.map(pm => ({
        cardId: pm.id,
        cardBrand: pm.card?.brand ?? 'unknown',
        cardLastFour: pm.card?.last4 ?? '',
        cardExpMonth: pm.card?.exp_month ?? '',
        cardExpYear: pm.card?.exp_year ?? '',
        cardIsDefault: pm.id === defaultPaymentMethodId
      }));
  
      const formattedInvoices = await Promise.all(
        invoices.data.map(async (invoice) => {
          // Collect product names from lines (price.product preferred)
          const lineProducts = (invoice.lines?.data ?? [])
            .map(line => line.price?.product ?? line.plan?.product)
            .filter(Boolean);
  
          const invoiceProductNames = await Promise.all(lineProducts.map(async (pid) => {
            try {
              const p = await stripe.products.retrieve(pid);
              return p?.name ?? 'Unknown Product';
            } catch { return 'Unknown Product'; }
          }));
  
          // ✅ receipt handling — guard against nulls
          let receiptUrl = null, brand = null, last4 = null;
          if (invoice.charge) {
            try {
              const ch = await stripe.charges.retrieve(invoice.charge);
              if (ch?.receipt_url) {
                // keep raw receipt URL; don’t transform it if missing
                receiptUrl = ch.receipt_url;
              }
              brand = ch?.payment_method_details?.card?.brand ?? null;
              last4 = ch?.payment_method_details?.card?.last4 ?? null;
            } catch { /* ignore */ }
          }
  
          // 🛡️ date guards
          const createdYmd = toYmdFromUnix(
            Number.isFinite(invoice.created) ? invoice.created : Number(invoice.created)
          );
  
          return {
            amount_due: ((invoice.amount_due ?? 0) / 100).toFixed(2),
            currency: String(invoice.currency || '').toUpperCase(),
            status: invoice.status ?? 'unknown',
            invoice_url: invoice.invoice_pdf ?? invoice.hosted_invoice_url ?? null,
            receipt_url: receiptUrl,
            created: createdYmd,                          // 'YYYY-MM-DD' or null
            invoiceProducts: invoiceProductNames.join(', '),
            invoiceNumber: invoice.number ?? null,
            invoiceCardBrand: brand,
            invoiceCardLastFour: last4
          };
        })
      );
  
      // 🛡️ subscription period end guard
      const currentPeriodEnd = toYmdFromUnix(
        Number.isFinite(subscription.current_period_end)
          ? subscription.current_period_end
          : Number(subscription.current_period_end)
      );
  
      console.log('Invoices', formattedInvoices);
  
      return res.json({
        status: subscription.status,
        willBeCanceled: !!subscription.cancel_at_period_end,
        planName: product.name || "N/A",
        planAmount: ((subscription.items?.data?.[0]?.price?.unit_amount
                   ?? subscription.items?.data?.[0]?.plan?.amount
                   ?? 0) / 100).toFixed(2),
        currentPeriodEnd,                                // string or null
        allPaymentMethods: formattedPaymentMethods,
        customerName: customer.name ?? '',
        customerAddress: safe(customer.address, null),
        customerPhone: customer.phone ?? '',
        allInvoices: formattedInvoices,
      });
  
    } catch (error) {
      console.error("❌ Error fetching subscription details:", error);
      // If it's a date fail, call it out explicitly for logs
      const hint = /Invalid time value|Invalid Date/i.test(String(error?.message)) ? 
        'One of the date fields was invalid. Check invoice.created and subscription.current_period_end.' : undefined;
      return res.status(500).json({ error: "Internal server error", hint });
    }
  });
  module.exports = router;  