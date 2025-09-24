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
        // Format Invoices
        const formattedInvoices = await Promise.all(
            invoices.data.map(async (invoice) => {
                // Extract product IDs from invoice line items
                const invoiceProductIds = invoice.lines?.data?.map(line => line.plan?.product).filter(Boolean) || [];
    
                // Fetch product names using Stripe API
                const invoiceProductNames = await Promise.all(
                    invoiceProductIds.map(async (invoiceProductId) => {
                        try {
                            if (!invoiceProductId) return "Unknown Product";
                            const invoiceProduct = await stripe.products.retrieve(invoiceProductId);
                            return invoiceProduct.name || "Unknown Product";
                        } catch (error) {
                            console.error(`Error fetching product ${invoiceProductId}:`, error.message);
                            return "Unknown Product";
                        }
                    })
                );

                // ✅ Fetch the correct receipt URL using the charge ID
                let receiptUrl = null;
                let getInvoiceCardBrand = null;
                let getInvoiceLastFour = null;
                if (invoice.charge) {
                    try {
                        const invoiceCharge = await stripe.charges.retrieve(invoice.charge);
                        receiptUrl = `${invoiceCharge.receipt_url.split('?')[0]}/pdf?s=ap`;
                        getInvoiceCardBrand = invoiceCharge.payment_method_details.card.brand;
                        getInvoiceLastFour = invoiceCharge.payment_method_details.card.last4;
                    } catch (error) {
                        console.error(`Error fetching receipt for charge ${invoice.charge}:`, error.message);
                    }
                }
    
                return {
                    amount_due: (invoice.amount_due / 100).toFixed(2),
                    currency: invoice.currency.toUpperCase(),
                    status: invoice.status,
                    invoice_url: invoice.invoice_pdf,
                    receipt_url: receiptUrl,
                    created: new Date(invoice.created * 1000).toISOString().split("T")[0] ?? null,
                    invoiceProducts: invoiceProductNames.join(", "), // If multiple products, separate by comma
                    invoiceNumber: invoice.number,
                    invoiceCardBrand: getInvoiceCardBrand,
                    invoiceCardLastFour: getInvoiceLastFour
                };
            })
        );

        console.log('Invoices');
        console.log(formattedInvoices);

        res.json({
            status: subscription.status,
            willBeCanceled: subscription.cancel_at_period_end,
            planName: product.name || "N/A",
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