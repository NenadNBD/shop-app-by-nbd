const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-renew-subscription', async (req, res) => {
    const { subscriptionId, customerId } = req.body;
    if (!subscriptionId){
        return res.status(400).json({ error: 'Missing subscriptionId' });
    }
    try {
        // Fetch current subscription
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // Sanity check if it's the same customer who is expected
        if (customerId && (subscription.customer !== customerId)) {
            return res.status(403).json({ error: 'Subscription does not belong to customer' });
        }

        // If already fully canceled (after period end), it cannot be "renewed" — must create a new subscription
        if (subscription.status === 'canceled' || subscription.ended_at) {
            const items = subscription.items?.data?.map(i => ({ price: i.price.id, quantity: i.quantity })) ?? [];
            return res.status(409).json({
            error: 'subscription_already_canceled',
            message: 'The subscription is already canceled after the period end. Please, create a new subscription instead.',
            recreate_hint: { customer: subscription.customer, items }
            });
        }

        // If no cancel is scheduled, nothing to do
        if (!subscription.cancel_at_period_end || !subscription.cancel_at) {
            return res.json({
                ok: true,
                message: 'Subscription is already active with no scheduled cancellation.',
                subscription: {
                    id: subscription.id,
                    status: subscription.status,
                    current_period_end: new Date(subscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null,
                }
            });
        }

        // Finally, RENEW Subscription
        // If BOTH flags are set, do two calls (one param each)
        if (subscription.cancel_at && subscription.cancel_at_period_end) {
            await stripe.subscriptions.update(
                subscriptionId,
                { cancel_at: null }
            );
            const renewSubscription = await stripe.subscriptions.update(
                subscriptionId,
                { cancel_at_period_end: false }
            );
            return res.json({
                ok: true,
                subscription: {
                    id: renewSubscription.id,
                    status: renewSubscription.status,
                    current_period_end: new Date(renewSubscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null
                }
            });
        }else if(subscription.cancel_at){
            const renewSubscription = await stripe.subscriptions.update(
                subscriptionId,
                { cancel_at: null }
            );
            return res.json({
                ok: true,
                subscription: {
                    id: renewSubscription.id,
                    status: renewSubscription.status,
                    current_period_end: new Date(renewSubscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null
                }
            });
        }else if(subscription.cancel_at_period_end){
            const renewSubscription = await stripe.subscriptions.update(
                subscriptionId,
                { cancel_at_period_end: false }
            );
            return res.json({
                ok: true,
                subscription: {
                    id: renewSubscription.id,
                    status: renewSubscription.status,
                    current_period_end: new Date(renewSubscription.items?.data?.[0]?.current_period_end * 1000).toISOString().split("T")[0] ?? null
                }
            });
        }
    } catch (err) {
        console.error('renew-subscription failed:', err);
        return res.status(500).json({ error: 'server_error' });
    }
});
module.exports = router;