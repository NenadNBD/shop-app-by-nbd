const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/fetch-update-subscription', async (req, res) => {
    const { portalId, subscriptionId, customerId, newSelectedPlan, prorationType } = req.query;
    if (!portalId || !subscriptionId || !customerId || !newSelectedPlan || !prorationType) {
        return res.status(400).json({ error: "Missing required parameters" });
    }
    console.log('[setSubscriptionupdate] Proration Type: ' + prorationType);
    const getPortalId = portalId;
    try {
        // Get PriceID from ProductID
        let getPriceId;
        let getNewProductName;
        const product = await stripe.products.retrieve(newSelectedPlan);
        getPriceId = product.default_price;
        getNewProductName = product.name;
        if(getPriceId){
            try {
                // Fetch the current subscription
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                
                // Get the first subscription item ID (assuming a single-item subscription)
                const subscriptionItemId = subscription.items.data[0].id;
                
                // Update subscription with the new price
                /*
                const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
                    items: [
                        {
                            id: subscriptionItemId,
                            price: getPriceId, // Now using the selected plan's price ID
                        },
                    ],
                    proration_behavior: prorationType, // Adjusts billing appropriately
                });
                */
                const getHubDbRowUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows?limit=1&customer_id=' + customerId + '&subscription_id=' + subscriptionId;
                const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';
                const tokenInfoTr1 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_TR1 = tokenInfoTr1.access_token;
                const getHubDbRowOptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_TR1}`}};
                try {
                    const getHubDbRowResponse = await fetch(getHubDbRowUrl, getHubDbRowOptions);
                    const getHubDbRowData = await getHubDbRowResponse.json();
                    console.log(getHubDbRowData);
                } catch (error) {
                console.error(error);
                }
                res.json({ success: true, updatedSubscription });
            } catch (error) {
                console.error("❌ Error updating subscription:", error.message);
                res.status(500).json({ error: "Failed to update subscription" });
            }
        }
    } catch (error) {
        console.error("Error finding new subscription price:", error.message);
        res.status(500).json({ error: "Failed to find new subscription price" });
    }
});
module.exports = router;