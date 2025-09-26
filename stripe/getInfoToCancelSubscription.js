const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.get('/get-info-cancel-subscription', async (req, res) => {
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
        const productId = subscription.items.data[0].plan.product;
        const product = await stripe.products.retrieve(productId);
        res.json({
            planName: product.name || "N/A",
            planAmount: (subscription.items.data[0].plan.amount / 100).toFixed(2),
            currentPeriodEnd: new Date(subscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null,
        });

    } catch (error) {
        console.error("❌ Error fetching subscription details:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});
module.exports = router;