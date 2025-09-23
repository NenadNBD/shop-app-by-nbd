const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-make-default-payment-method', async (req, res) => {
    const { customerId, subscriptionId, paymentMethodId, makeDefaultFor } = req.body;

    if (!customerId || !paymentMethodId || !makeDefaultFor || !subscriptionId) {
        return res.status(400).json({ error: "Missing required parameters." });
    }
    
    try {
        if (makeDefaultFor === "both") {
            // Make this the default payment method for the customer and current subscription
            await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: paymentMethodId },
            });
            await stripe.subscriptions.update(subscriptionId, {
                default_payment_method: paymentMethodId,
            });
        }else if (makeDefaultFor === "subscription") {
            // Make this the default payment method for a current subscription only
            await stripe.subscriptions.update(subscriptionId, {
                default_payment_method: paymentMethodId,
            });
        }else if(!makeDefaultFor){
            console.log('No Make Default Options')
        }
        
        res.json({ success: true, message: "Default payment method updated successfully." });
    } catch (error) {
        console.error("❌ Error updating default payment method:", error.message);
        res.status(500).json({ error: "Failed to update default payment method." });
    }
});

module.exports = router;