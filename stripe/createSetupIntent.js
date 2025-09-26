const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-create-setup-intent', async (req, res) => {
    const { customerId, subscriptionId } = req.query;
    if (!customerId) {
        return res.status(400).json({ error: "Customer ID is required" });
    }
    if (!subscriptionId) {
        return res.status(400).json({ error: "Subscription ID is required" });
    }

    try {
        // Create a SetupIntent to attach a new card
        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            automatic_payment_methods: {
                enabled: true,
            },
        });

        res.json({
            clientSecret: setupIntent.client_secret,
            message: "SetupIntent created successfully."
        });
    } catch (error) {
        console.error("Error creating SetupIntent:", error.message);
        res.status(500).json({ error: "Failed to create SetupIntent." });
    }
});
module.exports = router;