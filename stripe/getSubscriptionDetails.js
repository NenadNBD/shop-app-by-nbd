const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.get('/fetch-stripe-portal', async (req, res) => {
    const { subscriptionId, customerId } = req.query;

    if (!subscriptionId) {
        return res.status(400).json({ error: "Subscription ID is required" });
    }
    if (!customerId) {
        return res.status(400).json({ error: "Customer ID is required" });
    }

    try {
        // 🔍 Fetch subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log('Whole Subscription');
        console.log(subscription);
        const customer = await stripe.customers.retrieve(customerId);
        const invoices = await stripe.invoices.list({
            customer: customerId,
            limit: 10, // Fetch last 10 invoices
        });
        console.log('log for 10 INVOICES???');
        console.log(invoices);
        const productId = subscription.items.data[0].plan.product;

        // Step 1: Get all payment methods for the customer
        const paymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        });
        let defaultPaymentMethodId;
        // Step 2: Get the default payment method (first check subscription, then customer settings)
        defaultPaymentMethodId = subscription.default_payment_method;
        // 🔹 If `default_payment_method` is null, check customer settings
        if (!defaultPaymentMethodId) {
            defaultPaymentMethodId = customer.invoice_settings.default_payment_method;
        }
        const product = await stripe.products.retrieve(productId);
        // Step 3: Format Payment Methods & Mark Default
        const formattedPaymentMethods = paymentMethods.data.map(pm => ({
            cardId: pm.id,
            cardBrand: pm.card.brand,
            cardLastFour: pm.card.last4,
            cardExpMonth: pm.card.exp_month,
            cardExpYear: pm.card.exp_year,
            cardIsDefault: pm.id === defaultPaymentMethodId
        }));
        // 1 Collect unique product IDs across these invoices (basil + legacy fallback)
        const productIds = new Set();
        for (const inv of invoices.data) {
        for (const li of (inv.lines?.data || [])) {
            // basil path
            const pidBasil = li.pricing?.price_details?.product;
            if (pidBasil) productIds.add(pidBasil);

            // legacy fallback if some lines still have price.product
            const priceProduct = li.price?.product;
            if (typeof priceProduct === 'string') productIds.add(priceProduct);
        }
        }

        // 2 Fetch product names once, build a cache
        const productNameById = new Map();
        await Promise.all([...productIds].map(async (pid) => {
        try {
            const p = await stripe.products.retrieve(pid);
            productNameById.set(pid, p?.name || 'Unknown Product');
        } catch {
            productNameById.set(pid, 'Unknown Product');
        }
        }));

        // 3 Format Invoices (now using cached product names)
        const formattedInvoices = await Promise.all(
            invoices.data.map(async (invoice) => {
                // Product names from invoice lines (basil first, legacy fallback)
                const productNames = (invoice.lines?.data || [])
                .map(li => {
                    const pid = li.pricing?.price_details?.product
                    ?? (typeof li.price?.product === 'string' ? li.price.product : null);
                    return pid ? productNameById.get(pid) : null;
                })
                .filter(Boolean);

                // Find payments for this invoice (supports multiple/partial)
                const inpayments = await stripe.invoicePayments.list({
                    invoice: invoice.id,
                    expand: ['data.payment.payment_intent.latest_charge'],
                });

                // Most recent payment (or null)
                const lastPayment = inpayments.data?.[0] || null;

                // Resolve charge + card fields whether payment is via PI or direct Charge
                let receiptUrl = null;
                let cardBrand = null;
                let last4 = null;

                if (lastPayment?.payment?.payment_intent) {
                    const pi = lastPayment.payment.payment_intent;
                    const ch = typeof pi.latest_charge === 'string' ? null : pi.latest_charge;
                    if (ch) {
                        receiptUrl = ch.receipt_url || null;
                        const pmd = ch.payment_method_details?.card;
                        if (pmd) {
                            cardBrand = pmd.brand || null;
                            last4 = pmd.last4 || null;
                        }
                    }
                } else if (lastPayment?.payment?.charge) {
                    const ch = lastPayment.payment.charge;
                    const charge = typeof ch === 'string'
                    ? await stripe.charges.retrieve(ch)
                    : ch;
                    receiptUrl = charge.receipt_url || null;
                    const pmd = charge.payment_method_details?.card;
                    if (pmd) {
                        cardBrand = pmd.brand || null;
                        last4 = pmd.last4 || null;
                    }
                }

                return {
                    id: invoice.id,
                    amount_due: (invoice.amount_due / 100).toFixed(2),
                    currency: invoice.currency?.toUpperCase(),
                    status: invoice.status,
                    invoice_url: invoice.invoice_pdf,              // Stripe PDF (if finalized)
                    receipt_url: receiptUrl,                       // Charge receipt
                    created: invoice.created
                        ? new Date(invoice.created * 1000).toISOString().split('T')[0]
                        : null,
                    invoiceProducts: productNames.join(', ') || '—',
                    invoiceNumber: invoice.number || null,
                    invoiceCardBrand: cardBrand,
                    invoiceCardLastFour: last4,
                };
            })
        );

        console.log('Invoices');
        console.log(formattedInvoices);

        res.json({
            status: subscription.status,
            willBeCanceled: subscription.cancel_at_period_end,
            planName: product.name || "N/A",
            productId: productId,
            planAmount: (subscription.items.data[0].plan.amount / 100).toFixed(2),
            currentPeriodEnd: new Date(subscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null, // When next payment is due
            allPaymentMethods: formattedPaymentMethods,
            customerName: customer.name,
            customerAddress: customer.address,
            customerPhone: customer.phone,
            allInvoices: formattedInvoices,
        });

    } catch (error) {
        console.error("❌ Error fetching subscription details:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});
module.exports = router;