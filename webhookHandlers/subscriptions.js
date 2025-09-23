// handlers/subscriptions.js
const axios = require('axios');
const setHubSpotToken = require('../database/getTokens');

const searchContactByEmail = async (accessToken, email) => {
  try {
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }
          ]
        }
      ],
      limit: 1,
      properties: ['hs_object_id', 'email', 'firstname', 'lastname', 'phone', 'company', 'address', 'gender']
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.data.results.length > 0) {
      return response.data.results[0].properties; // Returns the contact ID
    } else {
      return null; // No contact found
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
};
function dollars(amount, currency) {
    const d = (currency || 'usd').toLowerCase() === 'jpy' ? 0 : 2;
    return (amount / Math.pow(10, d)).toFixed(d);
  }
  
  module.exports = {
    // Lifecycle updates: trialing -> active -> past_due -> canceled …
    async onSubscriptionEvent(event) {
        let getContactId;
        let getPortalId;
      const sub = event.data.object;
      // sub.status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid | paused
      // sub.metadata.flow: 'trial' | 'pay_now' (if you set this on create)
      console.log('Monitor Subscription Creation');
      switch (event.type) {
        case 'customer.subscription.created':
          if (sub.status === 'trialing') {
            console.log('TRIAL SUBSCRIPTION CREATED');
          } else if (sub.status === 'active') {
            console.log('ACTIVE SUBSCRIPTION CREATED WITH ID:', sub.id);
            console.log('ACTIVE SUBSCRIPTION CREATED FOR CUSTOMER ID:', sub.customer);
            console.log(sub.metadata.email);
            console.log(sub.metadata.full_name);
            console.log(sub.metadata.product_name);
            getPortalId = String(sub.metadata.hsPortalId).trim();
            const tokenInfo = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN = tokenInfo.access_token;
            const contact = await searchContactByEmail(ACCESS_TOKEN, String(sub.metadata.email).trim());
            if (contact) {
                getContactId = contact.hs_object_id;
                console.log('Contact Name found:', contact.firstname);
            }
            const hubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows';
            const tokenInfo02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_02 = tokenInfo.access_token;
            const hubDbOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_02}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  values: {
                    contact_email: String(sub.metadata.email).trim(),
                    contact_id: getContactId,
                    customer_id: String(sub.customer).trim(),
                    subscription_id: String(sub.id).trim(),
                    subscription_name: String(sub.metadata.product_name).trim(),
                    subscription_status: String(sub.status).trim(),
                    current_period_end: new Date(sub.current_period_end * 1000)
                  }
                })
            };

            try {
            const hubDbResponse = await fetch(hubDbUrl, hubDbOptions);
            const hubDbData = await hubDbResponse.json();
            if(hubDbData){
                console.log(hubDbData);
                const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';
                const tokenInfo03 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_03 = tokenInfo.access_token;
                const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_03}`}};
                try {
                    const publishHubDbResponse = await fetch(publishHubDbUrl, publishHubDboptions);
                    const publishHubDbData = await publishHubDbResponse.json();
                    if(publishHubDbData){
                        console.log('Subscription inserted and published in HubDB')
                    }
                } catch (error) {
                console.error(error);
                }
        }
            } catch (error) {
            console.error(error);
            }
          } else if (sub.status === 'incomplete') {
            console.log('SUBSCRIPTION IS INCOMPLETE. WILL BE PAYED?');
          }
          break;
  
        case 'customer.subscription.updated':
          // react to status changes (trial -> active; past_due; paused/resumed, etc.)
          break;
  
        case 'customer.subscription.deleted':
          // canceled by you or customer
          break;
  
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          // optional pause/resume logic
          break;
      }
    },
  
    // Invoices: both first invoice (subscription_create) and renewals (subscription_cycle)
    async onInvoiceEvent(event) {
      const invoice = event.data.object;
  
      // Keys you’ll often use:
      // invoice.billing_reason: 'subscription_create' | 'subscription_cycle' | 'subscription_threshold' | 'manual'
      // invoice.subscription: sub ID
      // invoice.amount_paid / amount_due (minor units)
      // const firstLine = invoice.lines?.data?.[0];
      // const priceId = firstLine?.price?.id;
      // const productId = firstLine?.price?.product;
      console.log('Monitor Subscription Invoices');
  
      if (event.type === 'invoice.payment_succeeded') {
        if (invoice.billing_reason === 'subscription_create') {
          // First charge for a non-trial sub (pay-first flow)
          // Or $0 invoice for trial start (rare; usually no invoice is generated at trial start)
          // Mark subscription as active/paid in your system
          console.log('Subscription is PAYED!')
        } else if (invoice.billing_reason === 'subscription_cycle') {
          // Renewal succeeded
        }
        // Optionally push to HubSpot or your DB
        // amount = dollars(invoice.amount_paid, invoice.currency)
      }
  
      if (event.type === 'invoice.payment_failed') {
        if (invoice.billing_reason === 'subscription_cycle') {
          // Renewal failed -> mark past_due, email user
        } else if (invoice.billing_reason === 'subscription_create') {
            console.log('Subscription PAYMENT FAILED!')
          // First payment failed -> subscription likely stays 'incomplete'
        }
      }
  
      if (event.type === 'invoice.payment_action_required') {
        // Requires SCA action; prompt user on client if you’re in-session
      }
    },
  
    async onTrialWillEnd(event) {
      const sub = event.data.object;
      // Notify user that trial ends on sub.trial_end (unix timestamp)
    },
  };  