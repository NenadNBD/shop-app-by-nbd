const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-update-billing-info', async (req, res) => {
    const { updateCustomerId, payerType, name, email, firstName, lastName, fullName, address1, city, postalCode, state, country } = req.body;
    try {
        const updateData = {
            name: name || null,
            email: email || null,
            address: {
                line1: address1 || null,
                city: city || null,
                postal_code: postalCode || null,
                state: state || null,
                country: country || null,
            },
            metadata:{
                first_name: firstName || null,
                last_name: lastName || null,
                full_name: fullName || null,
                payer_type: payerType || null,
            }
        };
        const updatedCustomer = await stripe.customers.update(updateCustomerId, updateData);
        res.json({ success: true, customer: updatedCustomer });
    } catch (error) {
        console.error("Error updating Stripe customer:", error);
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;