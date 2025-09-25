const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const setHubSpotToken = require('../database/getTokens');

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
                const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
                    items: [
                        {
                            id: subscriptionItemId,
                            price: getPriceId, // Now using the selected plan's price ID
                        },
                    ],
                    proration_behavior: prorationType, // Adjusts billing appropriately
                });



                const getHubDbRowUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows?limit=1&customer_id=' + customerId + '&subscription_id=' + subscriptionId;
                const token01 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_01 = token01.access_token;
                const getHubDbRowOptions = {method: 'GET', headers: {Authorization: `Bearer ${ACCESS_TOKEN_01}`}};
                let getHubDbRowId;
                try {
                    const getHubDbRowResponse = await fetch(getHubDbRowUrl, getHubDbRowOptions);
                    const getHubDbRowData = await getHubDbRowResponse.json();
                    getHubDbRowId = getHubDbRowData.results[0].id;
                    if(getHubDbRowId){
                        const updateHubDbRowUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows/' + getHubDbRowId + '/draft';
                        const token02 = await setHubSpotToken(getPortalId);
                        const ACCESS_TOKEN_02 = token02.access_token;
                        const updateHubDbRowOptions = {
                            method: 'PATCH', 
                            headers: {
                                Authorization: `Bearer ${ACCESS_TOKEN_02}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                values: {
                                  subscription_name: getNewProductName,
                                }
                              })
                        };
                        try {
                            const hubDbupdateResponse = await fetch(updateHubDbRowUrl, updateHubDbRowOptions);
                            const hubDbUpdateData = await hubDbupdateResponse.json();
                            if(hubDbUpdateData){
                                const publishUpdateHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';
                                const token03 = await setHubSpotToken(getPortalId);
                                const ACCESS_TOKEN_03 = token03.access_token;
                                const publishUpdateHubDbOptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_03}`}};
                                try {
                                    const publishHubDbResponse = await fetch(publishUpdateHubDbUrl, publishUpdateHubDbOptions);
                                    const publishHubDbData = await publishHubDbResponse.json();
                                    if(publishHubDbData){
                                        console.log('Subscription updated and published in HubDB')
                                    }
                                } catch (error) {
                                console.error(error);
                                }
                            }
                        } catch (error) {
                            console.error(error);
                        }
                    }
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