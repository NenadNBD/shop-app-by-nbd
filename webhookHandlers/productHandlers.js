const setHubSpotToken = require('../database/getTokens');

module.exports = {
    productCreated: async (event) => {
        const getPortalId = String(event.portalId || '');
        const getProductId = String(event.objectId || '');
        if (!getProductId || !getPortalId) {
            console.error('Missing or invalid identification!');
            return;
        }
        console.log('Portal ID:', getPortalId);
        console.log('Product ID:', getProductId);
        try {
            const tokenInfo = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN = tokenInfo.access_token;
            const response = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${getProductId}?properties=name&properties=price&properties=hs_object_id&properties=hs_product_type&properties=recurringbillingfrequency&properties=hs_sku&properties=description&properties=add_to_stripe_products`, {
                method: 'GET', 
                headers: {Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json'}
                }
            );
            const data = await response.json();
            console.log('Product Creation Data:');
            console.log(data);
        } catch (error) {
            console.error(error);
        }
    }
};