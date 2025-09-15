const setHubSpotToken = require('../database/getTokens');
const Stripe = require('stripe');
// USD only → returns decimal string of cents for unit_amount_decimal
// "2366.85"  -> "236685"
// "2,366.85" -> "236685"
// "50"       -> "5000"
// "10.999"   -> "1100"  (rounded to 2 decimals)
function toUnitAmountDecimalUSD(input) {
    if (input == null || String(input).trim() === '') {
      throw new Error('Missing price');
    }
  
    // strip $, spaces, thousands commas
    let s = String(input).trim().replace(/[\s$,]/g, '').replace(/,/g, '');
    const neg = s.startsWith('-');
    if (neg) s = s.slice(1);
  
    const m = s.match(/^(\d+)(?:\.(\d+))?$/);
    if (!m) throw new Error(`Invalid USD price: ${input}`);
  
    const dollars = m[1];                // e.g., "2366"
    const frac = (m[2] || '');           // e.g., "85" or ""
    // ---- integer rounding to cents (avoid float errors) ----
    // compute: round( (dollars.frac) * 100 )
    // i.e., cents = dollars*100 + round(frac * 100 / 10^len(frac))
    const d100 = BigInt(dollars) * 100n;
    if (frac.length === 0) {
      return (neg ? '-' : '') + d100.toString();
    }
    const scale = 10n ** BigInt(frac.length);
    const fracInt = BigInt(frac);
    let centsFromFrac = (fracInt * 100n) / scale;
    const remainder = (fracInt * 100n) % scale;
    if (remainder * 2n >= scale) centsFromFrac += 1n; // half-up
  
    const total = d100 + centsFromFrac;
    return (neg ? '-' : '') + total.toString();
}

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
            const hsResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${getProductId}?properties=name&properties=price&properties=hs_object_id&properties=hs_product_type&properties=recurringbillingfrequency&properties=hs_sku&properties=description&properties=add_to_stripe_products`, {
                method: 'GET', 
                headers: {Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json'}
                }
            );
            const hsData = await hsResponse.json();
            console.log('Product Creation Data:');
            console.log(hsData);
            let setTypeOfProduct;
            if(hsData.properties.hs_product_type === 'service'){
                setTypeOfProduct = 'service'
            }else{
                setTypeOfProduct = 'good'
            }
            let productParams;
            if(!hsData.properties.recurringbillingfrequency){
                productParams = {
                    name: String(hsData.properties.name || ''),
                    description: String(hsData.properties.description || ''),
                    active: true,
                    type: setTypeOfProduct,
                    default_price_data: {
                        currency: 'USD',
                        unit_amount_decimal: toUnitAmountDecimalUSD(hsData.properties.price),
                    },
                    metadata: {
                        sku: String(hsData.properties.hs_sku || ''),
                        hsId: String(hsData.properties.hs_object_id || ''),
                      },
                }
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            let getProductId;
            try {
                const product = await stripe.products.create(productParams);
                getProductId = product.id;
            } catch (err) {
                console.error('Stripe Create Product error:', err.message);
                throw err;
            }
        } catch (error) {
            console.error(error);
        }
        console.log('Product ID: ' + getProductId + ' is created');
    }
};