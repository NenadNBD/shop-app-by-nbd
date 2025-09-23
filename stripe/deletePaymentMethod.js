const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-delete-payment-method', async (req, res) => {
    try {
        const { deleteThisPaymentId } = req.body;

        if (!deleteThisPaymentId) {
            return res.status(400).json({ error: "Payment Method ID is required." });
        }

        // ✅ Detach the payment method from the customer
        const detachedPaymentMethod = await stripe.paymentMethods.detach(deleteThisPaymentId);

        res.json({ success: true, detachedPaymentMethod });

    } catch (error) {
        console.error("❌ Error deleting payment method:", error.message);
        res.status(500).json({ error: "Failed to delete payment method." });
    }
});
module.exports = router;