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
// ---- HS interval → Stripe recurring mapping ----
function mapHsIntervalToStripe(hsValue) {
    const v = String(hsValue || '').trim().toLowerCase();
    switch (v) {
      case 'weekly': 
        return { interval: 'week', interval_count: 1 };
      case 'biweekly': 
        return { interval: 'week', interval_count: 2 };
      case 'monthly': 
        return { interval: 'month', interval_count: 1 };
      case 'quarterly': 
        return { interval: 'month', interval_count: 3 };
      case 'per_six_months': 
        return { interval: 'month', interval_count: 6 };
      case 'annually':
        return { interval: 'year', interval_count: 1 };
      case 'per_two_years':
        return { interval: 'year', interval_count: 2 };
      case 'per_three_years': 
        return { interval: 'year', interval_count: 3 };
      default:
        throw new Error(`Unsupported interval: ${hsValue}`);
    }
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
                    default_price_data: {
                        currency: 'USD',
                        unit_amount_decimal: toUnitAmountDecimalUSD(hsData.properties.price),
                    },
                    metadata: {
                        sku: String(hsData.properties.hs_sku || ''),
                        hsId: String(hsData.properties.hs_object_id || ''),
                      },
                }
            }else{
                const { interval, interval_count } = mapHsIntervalToStripe(hsProduct.properties.recurringbillingfrequency);
                productParams = {
                    name: String(hsData.properties.name || ''),
                    description: String(hsData.properties.description || ''),
                    active: true,
                    default_price_data: {
                        currency: 'USD',
                        unit_amount_decimal: toUnitAmountDecimalUSD(hsData.properties.price),
                        recurring: {
                            interval,
                            interval_count,
                          },
                    },
                    metadata: {
                        sku: String(hsData.properties.hs_sku || ''),
                        hsId: String(hsData.properties.hs_object_id || ''),
                      },
                }
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            let getStripeProductId;
            try {
                const product = await stripe.products.create(productParams);
                getStripeProductId = product.id;
            } catch (err) {
                console.error('Stripe Create Product error:', err.message);
                throw err;
            }
            console.log('Stripe Product ID: ' + getStripeProductId + ' is created');
        } catch (error) {
            console.error(error);
        }
    }
};