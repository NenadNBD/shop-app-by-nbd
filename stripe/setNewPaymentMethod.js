const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-set-new-payment-method', async (req, res) => {
    try{
        const { customerId, subscriptionId, paymentMethodId, makeDefault } = req.body;
        if (!customerId || !subscriptionId || !paymentMethodId) {
            return res.status(400).json({ error: "Missing required parameters" });
        }

        // Attach Payment Method to Customer
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

        // Set as default payment method if requested
        if (makeDefault === 'add-now') {
            await stripe.subscriptions.update(subscriptionId, {
                default_payment_method: paymentMethodId
            });
            // Immediately charge an already-open invoice with the new PM:
            const openInvoices = await stripe.invoices.list({
                customer: customerId,
                subscription: subscriptionId,
                limit: 1
            });
            if (openInvoices.data[0]?.status === 'open') {
                await stripe.invoices.pay(openInvoices.data[0].id, {
                payment_method: paymentMethodId,
                });
            }
        }else if(makeDefault === 'just-add'){
            console.log('Customer selected: Just add for now');
        }else if(!makeDefault){
            console.log('No value for Make Default');
        }
        res.json({ success: true, message: "Payment method added successfully." });
    } catch (error) {
        console.error("❌ Error setting payment method:", error.message);
        res.status(500).json({ error: "Failed to set payment method." });
    }
});
module.exports = router;