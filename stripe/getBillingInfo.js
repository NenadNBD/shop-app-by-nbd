const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.get('/fetch-get-billing-info', async (req, res) => {
    const { customerId } = req.query;
    try {
        const getCustomerData = await stripe.customers.retrieve(customerId);
        res.json(
            { 
                name: getCustomerData.name, 
                email: getCustomerData.email,
                country: getCustomerData.address.country,
                address1: getCustomerData.address.line1,
                postalCode: getCustomerData.address.postal_code,
                city: getCustomerData.address.city,
                state: getCustomerData.address.state,
                payerType: getCustomerData.metadata.payer_type,
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;