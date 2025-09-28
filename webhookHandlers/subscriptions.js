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
      properties: ['hs_object_id', 'address', 'city', 'zip', 'state', 'country']
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

const searchCompanyByNameOrDomain = async (accessToken, { name, domain }) => {
  try {
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/companies/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'name',
              operator: 'EQ',
              value: name
            }
          ],
          filters: [
            {
              propertyName: 'domain',
              operator: 'EQ',
              value: domain
            }
          ]
        }
      ],
      limit: 1,
      properties: ['hs_object_id']
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
        let getContactAddress;
        let getContactCity;
        let getContactZip;
        let getContactState;
        let getContactCountry;
        let getCompanyId;
        let getPortalId;
      const sub = event.data.object;
      // sub.status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid | paused
      // sub.metadata.flow: 'trial' | 'pay_now' (if you set this on create)
      console.log('Monitor Subscription Creation');
      switch (event.type) {
        case 'customer.subscription.created':
          getPortalId = String(sub.metadata.hsPortalId).trim();
          const tokenInfo01 = await setHubSpotToken(getPortalId);
          const ACCESS_TOKEN01 = tokenInfo01.access_token;
          const contact = await searchContactByEmail(ACCESS_TOKEN01, String(sub.metadata.email).trim());
          if (contact) {
              getContactId = contact.hs_object_id;
              getContactAddress = contact.address;
              getContactCity = contact.city;
              getContactZip = contact.zip;
              getContactState = contact.state;
              getContactCountry = contact.country;
              console.log('Contact Name found:', contact.firstname);
          }
          // Search for Company if Payer Type is COMPANY
          if(String(sub.metadata.payer_type).trim() === 'company'){
            const companyName = String(sub.metadata.company || '').trim().toLowerCase();
            const emailForCompany = String(sub.metadata.email || '').trim();
            const domain = (emailForCompany.includes('@') ? emailForCompany.split('@')[1] : '').toLowerCase();
            const tokenInfo02 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN02 = tokenInfo02.access_token;
            const company = await searchCompanyByNameOrDomain(ACCESS_TOKEN02, { name: companyName, domain });
            if (company) {
              getCompanyId = company.hs_object_id;
              console.log('Company found:', company.name);
            }else{
              // Skip junk domains for company.domain
              const FREE_EMAIL_DOMAINS = new Set([
                'gmail.com','yahoo.com','outlook.com','hotmail.com','live.com','aol.com',
                'icloud.com','me.com','gmx.com','mail.com','proton.me','zoho.com','pm.me','yandex.com','yandex.ru'
              ]);
              const isFree = FREE_EMAIL_DOMAINS.has(domain);
              // Build properties (send at least name or a non-freemal domain)
              const properties = {};
              if (companyName){
                properties.name = companyName;
              }
              if (domain && !isFree){
                properties.domain = domain;
              }
              if (getContactAddress){
                properties.address = getContactAddress;
              }
              if (getContactCity){
                properties.city = getContactCity;
              }
              if (getContactZip){
                properties.zip = getContactZip;
              }
              if (getContactState){
                properties.state = getContactState;
              }
              if (getContactCountry){
                properties.country = getContactCountry;
              }
              const createCompanyUrl = 'https://api.hubapi.com/crm/v3/objects/companies';
              const createCompanyBody = {
                properties,
                associations: getContactId ? [{
                  to: { id: getContactId },
                  types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 5 }]
                }] : undefined
              };
              const tokenInfo03 = await setHubSpotToken(getPortalId);
              const ACCESS_TOKEN03 = tokenInfo03.access_token;
              const createCompanyOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN03}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(createCompanyBody)
              };
              try {
                const createCompanyResponse = await fetch(createCompanyUrl, createCompanyOptions);
                const createCompanyData = await createCompanyResponse.json();
                if (!createCompanyResponse.ok) {
                  console.error('Company create failed:', createCompanyResponse.status, createCompanyData);
                } else {
                  getCompanyId = createCompanyData.id
                  console.log('Company created');
                }
              } catch (error) {
                console.error(error);
              }
            }
          }

          // Prepare Deal
          const createDealUrl = 'https://api.hubapi.com/crm/v3/objects/0-3';
          let setDealStage;
          if (sub.status === 'trialing') {
            setDealStage = '3311151350';
          }else if(sub.status === 'active'){
            setDealStage = '3311151352';
          }
          let setDealName;
          if(String(sub.metadata.payer_type).trim() === 'company'){
            setDealName = sub.metadata.company + ' - ' + sub.metadata.product_name
          }else if(String(sub.metadata.payer_type).trim() === 'individual'){
            setDealName = sub.metadata.full_name + ' - ' + sub.metadata.product_name
          }
          const dealCloseDate = Date.now();
          const dealOwner = '44516880';
          const dealAmount = Number(((sub.items?.data?.[0]?.price?.unit_amount ?? sub.items?.data?.[0]?.plan?.amount ?? 0) / 100).toFixed(2));
          const dealBody = {
            properties: {
              amount: dealAmount,
              closedate: dealCloseDate,
              dealname: setDealName,
              pipeline: '2399805635',
              dealstage: setDealStage,
              hubspot_owner_id: dealOwner,
            },
            associations: []
          };
          const dealPayerType = String(sub.metadata.payer_type || '').trim().toLowerCase();
          if (getContactId) {
            dealBody.associations.push({
              to: { id: String(getContactId) },
              types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 3 }]
            });
          }
          if (dealPayerType === 'company' && getCompanyId) {
            dealBody.associations.push({
              to: { id: String(getCompanyId) },
              types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }]
            });
          }
          const hubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/rows';
          const publishHubDbUrl = 'https://api.hubapi.com/cms/v3/hubdb/tables/' + 725591276 + '/draft/publish';
          if (sub.status === 'trialing') {
            const tokenInfoDeal1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_DEAL1 = tokenInfoDeal1.access_token;
            const createTrialDealOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_DEAL1}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(dealBody)
            };
            try {
              const trialDealRes = await fetch(createDealUrl, createTrialDealOptions);
              const trialDealData = await trialDealRes.json();
              if (!trialDealRes.ok) {
                console.error('Deal create failed:', trialDealRes.status, trialDealData);
              } else {
                console.log('Trial Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }
            const tokenInfoTr1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_TR1 = tokenInfoTr1.access_token;
            const hubDbOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_TR1}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  values: {
                    contact_email: String(sub.metadata.email).trim(),
                    contact_id: getContactId,
                    customer_id: String(sub.customer).trim(),
                    subscription_id: String(sub.id).trim(),
                    subscription_name: String(sub.metadata.product_name).trim(),
                    subscription_status: { name: String(sub.status).trim(), type: 'option' },
                    current_period_end: sub.current_period_end * 1000
                  }
                })
            };

            try {
            const hubDbResponse = await fetch(hubDbUrl, hubDbOptions);
            const hubDbData = await hubDbResponse.json();
            if(hubDbData){
                console.log(hubDbData);
                const tokenInfoTr2 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_TR2 = tokenInfoTr2.access_token;
                const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_TR2}`}};
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
          } else if (sub.status === 'active') {
            console.log('ACTIVE SUBSCRIPTION CREATED WITH ID:', sub.id);
            console.log('ACTIVE SUBSCRIPTION CREATED FOR CUSTOMER ID:', sub.customer);
            console.log(sub.metadata.email);
            console.log(sub.metadata.full_name);
            console.log(sub.metadata.product_name);
            const tokenInfoDeal2 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_DEAL2 = tokenInfoDeal2.access_token;
            const createDealOptions = {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${ACCESS_TOKEN_DEAL2}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(dealBody)
            };
            try {
              const dealRes = await fetch(createDealUrl, createDealOptions);
              const dealData = await dealRes.json();
              if (!dealRes.ok) {
                console.error('Deal create failed:', dealRes.status, dealData);
              } else {
                console.log('Trial Deal created');
              }
            } catch (err) {
              console.error('Fetch error creating deal:', err);
            }
            const tokenInfoAct1 = await setHubSpotToken(getPortalId);
            const ACCESS_TOKEN_ACT1 = tokenInfoAct1.access_token;
            const hubDbOptions = {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ACCESS_TOKEN_ACT1}`, 
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  values: {
                    contact_email: String(sub.metadata.email).trim(),
                    contact_id: getContactId,
                    customer_id: String(sub.customer).trim(),
                    subscription_id: String(sub.id).trim(),
                    subscription_name: String(sub.metadata.product_name).trim(),
                    subscription_status: { name: String(sub.status).trim(), type: 'option' },
                    current_period_end: sub.current_period_end * 1000
                  }
                })
            };

            try {
            const hubDbResponse = await fetch(hubDbUrl, hubDbOptions);
            const hubDbData = await hubDbResponse.json();
            if(hubDbData){
                console.log(hubDbData);
                const tokenInfoAct2 = await setHubSpotToken(getPortalId);
                const ACCESS_TOKEN_ACT2 = tokenInfoAct2.access_token;
                const publishHubDboptions = {method: 'POST', headers: {Authorization: `Bearer ${ACCESS_TOKEN_ACT2}`}};
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