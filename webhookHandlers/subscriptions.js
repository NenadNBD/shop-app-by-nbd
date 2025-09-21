// handlers/subscriptions.js
const axios = require('axios');
const axios = require('axios');

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
      properties: ['id', 'email']
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.data.results.length > 0) {
      return response.data.results[0].id; // Returns the contact ID
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
            searchContactByEmail('your_actual_access_token', 'example@email.com').then(contactId => {
                getContactId = contactId;
            });
            console.log('Contact ID:', getContactId);
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