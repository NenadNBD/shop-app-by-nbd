const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-cancel-subscription', async (req, res) => {
    const { subscriptionId } = req.body;
    try {
        const cancelSubscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true // Keeps the subscription active until the billing cycle ends
        });
        res.json({ success: true, subscription: cancelSubscription });
    } catch (error) {
        console.error("Error canceling subscription:", error);
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;